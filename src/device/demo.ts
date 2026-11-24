import type { DeviceInfo, Sample } from './protocol.ts';
import { irReading, pulseShape } from './pulseShape.ts';

// Señal simulada con el mismo formato que el firmware, para comprobar la
// aplicación sin placa. Los valores son inventados: no representan a nadie.
// Simula unos 70 lpm, 15 respiraciones por minuto (que modulan el ritmo y la
// amplitud del pulso, como en una persona real) y una SpO2 de alrededor de 98 %.

const INFO: DeviceInfo = { version: 3, sensor: 'max30102', fs: 100, bits: 18 };
const TICK_MS = 20;
const DC_IR = 120000;
const DC_RED = 90000;
const PI_IR = 1.6;
const RATIO = 0.52; // razón rojo/IR que corresponde a una SpO2 de ~98 %
const BREATH_HZ = 0.25;

interface Beat {
  at: number;
  rr: number;
}

export class DemoSource {
  private timer = 0;
  private n = 0;
  private startMs = 0;
  private beats: Beat[] = [];
  private nextBeatS = 0.3;
  private readonly onSample: (sample: Sample) => void;

  constructor(onSample: (sample: Sample) => void) {
    this.onSample = onSample;
  }

  start(): DeviceInfo {
    this.stop();
    this.n = 0;
    this.beats = [];
    this.nextBeatS = 0.3;
    this.startMs = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    return INFO;
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private tick() {
    const due = Math.floor(((performance.now() - this.startMs) / 1000) * INFO.fs);
    // Si la pestaña estuvo en segundo plano, no se recupera de golpe todo el atraso.
    if (due - this.n > INFO.fs * 2) this.n = due - INFO.fs * 2;
    while (this.n < due) {
      this.onSample({ seq: this.n & 0xff, ...this.sample(this.n / INFO.fs) });
      this.n++;
    }
  }

  private sample(t: number): { adc: number; red: number } {
    while (this.nextBeatS < t + 1) {
      // Arritmia sinusal respiratoria: el latido se adelanta al inhalar.
      const rr = 0.86 - 0.05 * Math.sin(2 * Math.PI * BREATH_HZ * this.nextBeatS) + 0.01 * (Math.random() - 0.5);
      this.beats.push({ at: this.nextBeatS, rr });
      this.nextBeatS += rr;
    }
    while (this.beats.length > 0 && this.beats[0].at < t - 2) this.beats.shift();

    let pulse = 0;
    for (const b of this.beats) {
      const dt = t - b.at;
      if (dt >= -0.2 && dt <= 1.2) pulse += pulseShape(dt, b.rr);
    }
    const breath = Math.sin(2 * Math.PI * BREATH_HZ * t);
    const pi = PI_IR * (1 + 0.12 * breath);
    const level = 1 + 0.004 * breath;
    const noise = () => 25 * (Math.random() * 2 - 1);
    const clamp = (v: number) => Math.max(0, Math.min(2 ** INFO.bits - 1, Math.round(v)));
    return {
      adc: clamp(irReading(pulse, DC_IR * level, pi) + noise()),
      red: clamp(irReading(pulse, DC_RED * level, pi * RATIO) + noise()),
    };
  }
}
