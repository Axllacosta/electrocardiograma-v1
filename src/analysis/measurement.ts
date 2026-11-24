import { heartRate, rmssd, sdnn } from '../dsp/rr.ts';
import type { QualityLevel } from './quality.ts';
import { estimateRespiration } from './respiration.ts';

// Medición estándar en reposo: unos minutos sentado y quieto, con un resumen
// comparable de un día a otro. Los intervalos de latidos con mala calidad de
// señal no entran en la variabilidad.

export const MEASUREMENT_DURATIONS = [1, 2, 5] as const;

export interface BeatEvent {
  timeS: number;
  rrMs: number | null;
  amplitude: number;
  quality: QualityLevel;
}

export interface MeasurementResult {
  kind: 'measurement';
  id: string;
  startedAt: number;
  durationS: number;
  beats: number;
  hrMean: number | null;
  sdnn: number | null;
  rmssd: number | null;
  spo2Mean: number | null;
  breathsPerMin: number | null;
  goodPct: number;
}

export class MeasurementSession {
  readonly durationS: number;
  readonly startedAt = Date.now();
  readonly startS: number;
  private beats: BeatEvent[] = [];
  private spo2: number[] = [];

  constructor(durationS: number, startS: number) {
    this.durationS = durationS;
    this.startS = startS;
  }

  addBeat(beat: BeatEvent) {
    if (beat.timeS >= this.startS) this.beats.push(beat);
  }

  addSpo2(value: number) {
    this.spo2.push(value);
  }

  elapsed(nowS: number) {
    return Math.max(0, nowS - this.startS);
  }

  done(nowS: number) {
    return this.elapsed(nowS) >= this.durationS;
  }

  get beatCount() {
    return this.beats.length;
  }

  // Intervalos aptos: el latido y el anterior tienen calidad aceptable.
  private cleanIntervals(): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.beats.length; i++) {
      const b = this.beats[i];
      if (b.rrMs !== null && b.quality !== 'poor' && this.beats[i - 1].quality !== 'poor') out.push(b.rrMs);
    }
    return out;
  }

  result(id: string): MeasurementResult {
    const rr = this.cleanIntervals();
    const good = this.beats.filter((b) => b.quality === 'good').length;
    const resp = estimateRespiration(this.beats, this.startS + this.durationS);
    return {
      kind: 'measurement',
      id,
      startedAt: this.startedAt,
      durationS: this.durationS,
      beats: this.beats.length,
      hrMean: heartRate(rr, rr.length),
      sdnn: sdnn(rr),
      rmssd: rmssd(rr),
      spo2Mean: this.spo2.length > 0 ? this.spo2.reduce((a, v) => a + v, 0) / this.spo2.length : null,
      breathsPerMin: resp?.breathsPerMin ?? null,
      goodPct: this.beats.length > 0 ? (100 * good) / this.beats.length : 0,
    };
  }
}
