import { Biquad } from '../dsp/biquad.ts';

// Estimación de la saturación de oxígeno con el método de la «razón de
// razones»: la sangre oxigenada absorbe menos luz roja que la desoxigenada,
// así que el tamaño relativo del pulso en rojo frente al infrarrojo depende de
// la saturación. R = (AC rojo / DC rojo) / (AC IR / DC IR).
//
// La curva que pasa de R a SpO2 es la que publica Maxim para el MAX30102 en su
// código de referencia; con el MAX30100 se usa la misma, que ahí es aún más
// aproximada. Cada sensor y cada dedo son algo distintos y aquí no hay
// calibración contra un oxímetro clínico, así que el resultado es una
// estimación orientativa: el error típico ronda varios puntos.

const WINDOW_S = 4;
const SETTLE_S = 2;
const DC_TAU_S = 1.5;
const Q = Math.SQRT1_2;

export const MIN_R = 0.2;
export const MAX_R = 1.4;

export function spo2FromRatio(r: number): number {
  return -45.06 * r * r + 30.354 * r + 94.845;
}

class Channel {
  private hp: Biquad;
  private lp: Biquad;
  dc = 0;
  private readonly alpha: number;
  private ring: Float64Array;
  private pos = 0;
  sumSq = 0;

  constructor(fs: number, window: number) {
    this.hp = new Biquad('highpass', fs, 0.5, Q);
    this.lp = new Biquad('lowpass', fs, Math.min(5, fs / 4), Q);
    this.alpha = 1 - Math.exp(-1 / (DC_TAU_S * fs));
    this.ring = new Float64Array(window);
  }

  settle(x: number) {
    this.hp.settle(x);
    this.lp.settle(0);
    this.dc = x;
    this.ring.fill(0);
    this.sumSq = 0;
    this.pos = 0;
  }

  push(x: number, measuring: boolean) {
    this.dc += this.alpha * (x - this.dc);
    const ac = this.lp.process(this.hp.process(x));
    const sq = measuring ? ac * ac : 0;
    this.sumSq += sq - this.ring[this.pos];
    this.ring[this.pos] = sq;
    this.pos = (this.pos + 1) % this.ring.length;
  }

  rms() {
    return Math.sqrt(Math.max(0, this.sumSq) / this.ring.length);
  }
}

export interface Spo2Reading {
  spo2: number;
  ratio: number;
}

export class Spo2Estimator {
  private readonly fs: number;
  private readonly window: number;
  private ir: Channel;
  private red: Channel;
  private count = 0;
  private active = false;

  constructor(fs: number) {
    this.fs = fs;
    this.window = Math.round(WINDOW_S * fs);
    this.ir = new Channel(fs, this.window);
    this.red = new Channel(fs, this.window);
  }

  // Llamar cuando se interrumpe la señal (sin dedo, muestras perdidas).
  reset() {
    this.active = false;
  }

  push(ir: number, red: number) {
    if (!this.active) {
      this.ir.settle(ir);
      this.red.settle(red);
      this.count = 0;
      this.active = true;
    }
    const measuring = this.count >= SETTLE_S * this.fs;
    this.ir.push(ir, measuring);
    this.red.push(red, measuring);
    this.count++;
  }

  estimate(): Spo2Reading | null {
    if (!this.active || this.count < (SETTLE_S + WINDOW_S) * this.fs) return null;
    if (this.ir.dc <= 0 || this.red.dc <= 0) return null;
    const irRatio = this.ir.rms() / this.ir.dc;
    const redRatio = this.red.rms() / this.red.dc;
    if (irRatio <= 0) return null;
    const ratio = redRatio / irRatio;
    if (ratio < MIN_R || ratio > MAX_R) return null;
    const spo2 = Math.max(70, Math.min(100, spo2FromRatio(ratio)));
    return { spo2, ratio };
  }
}
