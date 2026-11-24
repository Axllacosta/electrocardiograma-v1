import type { BeatEvent } from './analysis/measurement.ts';
import { QualityTracker, type QualityLevel } from './analysis/quality.ts';
import { estimateRespiration } from './analysis/respiration.ts';
import { Spo2Estimator } from './analysis/spo2.ts';
import type { DeviceInfo, Sample } from './device/protocol.ts';
import { PpgFilter, PulseDetector } from './dsp/ppg.ts';
import { heartRate, rmssd, sdnn } from './dsp/rr.ts';

// Códigos que se guardan en lugar de la lectura del sensor.
export const NO_FINGER = -1;
export const DROPPED = -2;

const DISPLAY_SECONDS = 30;
const NO_PULSE_SECONDS = 5;
// Ventana para el índice de perfusión y tiempo que se deja asentar el filtro.
const PERFUSION_SECONDS = 3;
const SETTLE_SECONDS = 2;
// Tramo del pulso que se examina para la calidad: antes y después del latido.
const SEGMENT_BEFORE_S = 0.25;
const SEGMENT_AFTER_S = 0.45;
// Latidos que se conservan para la respiración y las gráficas de variabilidad.
const BEAT_LOG_SECONDS = 300;
const RESPIRATION_EVERY_S = 2;
const DROP_WARNING_MS = 10000;
const RATE_WINDOW_MS = 2000;

export interface Snapshot {
  heartRate: number | null;
  lastRrMs: number | null;
  sdnn: number | null;
  rmssd: number | null;
  beats: number;
  minHr: number | null;
  maxHr: number | null;
  perfusion: number | null;
  spo2: number | null;
  breathsPerMin: number | null;
  quality: QualityLevel | null;
  noFinger: boolean;
  noPulse: boolean;
  clipped: boolean;
  droppedTotal: number;
  droppedRecently: boolean;
  rateHz: number | null;
  recordingSeconds: number | null;
}

export interface RecordingStats {
  durationS: number;
  beats: number;
  hrMean: number | null;
  hrMin: number | null;
  hrMax: number | null;
  sdnn: number | null;
  rmssd: number | null;
  spo2Mean?: number | null;
  breathsPerMin?: number | null;
}

export interface RecordingData {
  startedAt: number;
  fs: number;
  bits: number;
  sensor: string;
  samples: Int32Array;
  red: Int32Array;
  beats: Uint32Array;
  rr: Float32Array;
  stats: RecordingStats;
}

export interface MonitorListener {
  onBeat?(beat: BeatEvent): void;
  onSpo2?(spo2: number): void;
}

const CHUNK = 8192;

class Channel {
  private chunks: Int32Array[] = [];
  private current = new Int32Array(CHUNK);
  private pos = 0;
  length = 0;

  push(value: number) {
    this.current[this.pos++] = value;
    this.length++;
    if (this.pos === CHUNK) {
      this.chunks.push(this.current);
      this.current = new Int32Array(CHUNK);
      this.pos = 0;
    }
  }

  toArray(): Int32Array {
    const out = new Int32Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    out.set(this.current.subarray(0, this.pos), offset);
    return out;
  }
}

class Recorder {
  readonly startedAt = Date.now();
  readonly startN: number;
  readonly ir = new Channel();
  readonly red = new Channel();
  readonly beats: number[] = [];
  readonly rr: number[] = [];
  readonly events: BeatEvent[] = [];
  readonly spo2: number[] = [];

  constructor(startN: number) {
    this.startN = startN;
  }

  get length() {
    return this.ir.length;
  }
}

interface PendingBeat {
  t: number;
  rrMs: number | null;
}

export class Monitor {
  readonly info: DeviceInfo;
  readonly display: Float32Array;
  n = 0;
  onBeat?: () => void;

  private filter: PpgFilter;
  private detector: PulseDetector;
  private spo2: Spo2Estimator;
  private quality = new QualityTracker();
  private maxAdc: number;
  private listeners = new Set<MonitorListener>();

  private lastSeq: number | null = null;
  private interrupted = true;
  private cleanSince = 0;
  private noFinger = false;
  private lastClipN = -Infinity;

  private lastBeatN: number | null = null;
  private rr: number[] = [];
  private beats = 0;
  private minHr: number | null = null;
  private maxHr: number | null = null;
  private pending: PendingBeat[] = [];
  private log: BeatEvent[] = [];

  private respiration: number | null = null;
  private respirationAtN = -Infinity;

  private droppedTotal = 0;
  private lastDropAt = -Infinity;
  private rateCount = 0;
  private rateStart = performance.now();
  private rateHz: number | null = null;

  private recorder: Recorder | null = null;

  constructor(info: DeviceInfo) {
    this.info = info;
    this.display = new Float32Array(info.fs * DISPLAY_SECONDS).fill(NaN);
    this.maxAdc = 2 ** info.bits - 1;
    this.filter = new PpgFilter(info.fs);
    this.detector = new PulseDetector(info.fs);
    this.spo2 = new Spo2Estimator(info.fs);
  }

  // Segundos desde que empezó a llegar señal, en el reloj de las muestras.
  get timeS() {
    return this.n / this.info.fs;
  }

  // Latidos recientes ya evaluados, del más antiguo al más nuevo.
  get beatLog(): readonly BeatEvent[] {
    return this.log;
  }

  subscribe(listener: MonitorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(sample: Sample) {
    if (this.lastSeq !== null) {
      const missing = (sample.seq - this.lastSeq - 1 + 256) & 255;
      if (missing > 0) {
        this.droppedTotal += missing;
        this.lastDropAt = performance.now();
        for (let i = 0; i < missing; i++) this.store(DROPPED);
      }
    }
    this.lastSeq = sample.seq;
    this.store(sample.adc === null ? NO_FINGER : sample.adc, sample.red);

    this.rateCount++;
    const now = performance.now();
    if (now - this.rateStart >= RATE_WINDOW_MS) {
      this.rateHz = (this.rateCount * 1000) / (now - this.rateStart);
      this.rateCount = 0;
      this.rateStart = now;
    }
  }

  private store(value: number, red?: number) {
    const n = this.n;
    if (this.recorder) {
      this.recorder.ir.push(value);
      this.recorder.red.push(value < 0 ? value : (red ?? 0));
    }
    this.noFinger = value === NO_FINGER;

    if (value < 0) {
      this.display[n % this.display.length] = NaN;
      if (!this.interrupted) {
        this.spo2.reset();
        this.quality.reset();
        this.pending = [];
      }
      this.interrupted = true;
      this.n++;
      return;
    }

    if (value >= this.maxAdc - 1 || (red !== undefined && red >= this.maxAdc - 1)) this.lastClipN = n;

    if (this.interrupted) {
      this.filter.settle(value);
      this.detector.reset(n);
      this.lastBeatN = null;
      this.cleanSince = n;
      this.interrupted = false;
    }

    const y = this.filter.process(value);
    this.display[n % this.display.length] = y;
    if (red !== undefined) this.spo2.push(value, red);

    const beat = this.detector.push(y, n);
    if (beat !== null) this.beat(beat);
    this.finalizeBeats(n);
    if (n % this.info.fs === 0) this.everySecond();
    this.n++;
  }

  // t: instante del latido en muestras, con decimales.
  private beat(t: number) {
    let rrMs: number | null = null;
    if (this.lastBeatN !== null) {
      rrMs = ((t - this.lastBeatN) * 1000) / this.info.fs;
      this.rr.push(rrMs);
      if (this.rr.length > 4096) this.rr.shift();
      if (this.rr.length >= 4) {
        const hr = heartRate(this.rr);
        if (hr !== null) {
          this.minHr = this.minHr === null ? hr : Math.min(this.minHr, hr);
          this.maxHr = this.maxHr === null ? hr : Math.max(this.maxHr, hr);
        }
      }
      if (this.recorder && this.lastBeatN >= this.recorder.startN) this.recorder.rr.push(rrMs);
    }
    this.lastBeatN = t;
    this.beats++;
    if (this.recorder && t >= this.recorder.startN) this.recorder.beats.push(Math.round(t - this.recorder.startN));
    this.pending.push({ t, rrMs });
    this.onBeat?.();
  }

  // La calidad y la amplitud de cada pulso se evalúan cuando ya llegó su
  // pulso completo, medio segundo después del latido.
  private finalizeBeats(n: number) {
    const fs = this.info.fs;
    const before = Math.round(SEGMENT_BEFORE_S * fs);
    const after = Math.round(SEGMENT_AFTER_S * fs);
    while (this.pending.length > 0 && n >= Math.round(this.pending[0].t) + after) {
      const { t, rrMs } = this.pending.shift()!;
      const center = Math.round(t);
      const segment = new Float32Array(before + after);
      let foot = Infinity;
      let top = -Infinity;
      let valid = true;
      for (let i = 0; i < segment.length; i++) {
        const k = center - before + i;
        const v = this.display[k % this.display.length];
        if (Number.isNaN(v) || k < 0) valid = false;
        segment[i] = v;
        if (i <= before) foot = Math.min(foot, v);
        if (i >= before && i < before + Math.round(0.4 * fs)) top = Math.max(top, v);
      }
      if (!valid) continue;
      const amplitude = top - foot;
      const quality = this.quality.assess(segment, amplitude, rrMs);
      const event: BeatEvent = { timeS: t / fs, rrMs, amplitude, quality };
      this.log.push(event);
      while (this.log.length > 0 && this.log[0].timeS < event.timeS - BEAT_LOG_SECONDS) this.log.shift();
      if (this.recorder && t >= this.recorder.startN) this.recorder.events.push(event);
      for (const l of this.listeners) l.onBeat?.(event);
    }
  }

  private currentSpo2(): number | null {
    if (this.noFinger || this.interrupted || this.quality.level() !== 'good') return null;
    return this.spo2.estimate()?.spo2 ?? null;
  }

  private everySecond() {
    const value = this.currentSpo2();
    if (value === null) return;
    this.recorder?.spo2.push(value);
    for (const l of this.listeners) l.onSpo2?.(value);
  }

  // Índice de perfusión: amplitud del pulso de pico a pico en % de la luz recibida.
  private perfusion(): number | null {
    const fs = this.info.fs;
    const span = PERFUSION_SECONDS * fs;
    if (this.interrupted || this.n - this.cleanSince < (SETTLE_SECONDS + PERFUSION_SECONDS) * fs) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = this.n - span; k < this.n; k++) {
      const v = this.display[k % this.display.length];
      if (Number.isNaN(v)) return null;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return hi - lo;
  }

  private breathing(): number | null {
    if (this.n - this.respirationAtN >= RESPIRATION_EVERY_S * this.info.fs) {
      this.respirationAtN = this.n;
      const clean = this.log.filter((b) => b.quality !== 'poor');
      this.respiration = estimateRespiration(clean, this.timeS)?.breathsPerMin ?? null;
    }
    return this.respiration;
  }

  snapshot(): Snapshot {
    const fs = this.info.fs;
    const reference = this.lastBeatN ?? this.cleanSince;
    const noPulse = !this.noFinger && !this.interrupted && this.n - reference > NO_PULSE_SECONDS * fs;
    const showRate = !this.noFinger && !noPulse && this.lastBeatN !== null;

    return {
      heartRate: showRate ? heartRate(this.rr) : null,
      lastRrMs: showRate && this.rr.length > 0 ? this.rr[this.rr.length - 1] : null,
      sdnn: sdnn(this.rr.slice(-300)),
      rmssd: rmssd(this.rr.slice(-300)),
      beats: this.beats,
      minHr: this.minHr,
      maxHr: this.maxHr,
      perfusion: this.noFinger ? null : this.perfusion(),
      spo2: showRate ? this.currentSpo2() : null,
      breathsPerMin: showRate ? this.breathing() : null,
      quality: this.noFinger || this.interrupted || noPulse ? null : this.quality.level(),
      noFinger: this.noFinger,
      noPulse,
      clipped: this.n - this.lastClipN < fs,
      droppedTotal: this.droppedTotal,
      droppedRecently: performance.now() - this.lastDropAt < DROP_WARNING_MS,
      rateHz: this.rateHz,
      recordingSeconds: this.recorder ? this.recorder.length / fs : null,
    };
  }

  resetStats() {
    this.rr = [];
    this.beats = 0;
    this.minHr = null;
    this.maxHr = null;
    this.droppedTotal = 0;
    this.log = [];
  }

  startRecording() {
    this.recorder = new Recorder(this.n);
  }

  stopRecording(): RecordingData | null {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec || rec.length === 0) return null;
    const durationS = rec.length / this.info.fs;
    const stats = recordingStats(rec.rr, rec.beats.length, durationS);
    stats.spo2Mean = rec.spo2.length > 0 ? rec.spo2.reduce((a, v) => a + v, 0) / rec.spo2.length : null;
    const resp = estimateRespiration(
      rec.events.filter((b) => b.quality !== 'poor'),
      (rec.startN + rec.length) / this.info.fs,
    );
    stats.breathsPerMin = resp?.breathsPerMin ?? null;
    return {
      startedAt: rec.startedAt,
      fs: this.info.fs,
      bits: this.info.bits,
      sensor: this.info.sensor,
      samples: rec.ir.toArray(),
      red: rec.red.toArray(),
      beats: Uint32Array.from(rec.beats),
      rr: Float32Array.from(rec.rr),
      stats,
    };
  }
}

export function recordingStats(rr: number[], beats: number, durationS: number): RecordingStats {
  let hrMin: number | null = null;
  let hrMax: number | null = null;
  for (let i = 3; i < rr.length; i++) {
    const hr = heartRate(rr.slice(i - 7 < 0 ? 0 : i - 7, i + 1));
    if (hr === null) continue;
    hrMin = hrMin === null ? hr : Math.min(hrMin, hr);
    hrMax = hrMax === null ? hr : Math.max(hrMax, hr);
  }
  return {
    durationS,
    beats,
    hrMean: heartRate(rr, rr.length),
    hrMin,
    hrMax,
    sdnn: sdnn(rr),
    rmssd: rmssd(rr),
  };
}
