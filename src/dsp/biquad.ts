// Filtros biquad (Robert Bristow-Johnson, "Audio EQ Cookbook"), forma directa I.

export type BiquadKind = 'highpass' | 'lowpass' | 'notch';

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(kind: BiquadKind, fs: number, f0: number, q: number) {
    const w0 = (2 * Math.PI * f0) / fs;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;

    let b0: number;
    let b1: number;
    let b2: number;
    if (kind === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else if (kind === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  // Coloca el filtro en régimen permanente para una entrada constante x,
  // así al volver a apoyar el dedo no se produce un escalón enorme.
  settle(x: number): number {
    const gainDc = (this.b0 + this.b1 + this.b2) / (1 + this.a1 + this.a2);
    const y = x * gainDc;
    this.x1 = this.x2 = x;
    this.y1 = this.y2 = y;
    return y;
  }
}
