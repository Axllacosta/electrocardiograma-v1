// Calidad de la señal latido a latido. Cada pulso se compara con una plantilla
// (el promedio de los pulsos buenos recientes), con la amplitud típica y con
// el intervalo típico. Un dedo que se mueve deforma el pulso y lo delata.

export type QualityLevel = 'good' | 'fair' | 'poor';

const TEMPLATE_RATE = 0.1;
const HISTORY = 8;
const SUMMARY_BEATS = 6;

function normalize(x: ArrayLike<number>): Float64Array | null {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (x[i] - mean) ** 2;
  const sd = Math.sqrt(sq / n);
  if (!(sd > 0)) return null;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (x[i] - mean) / sd;
  return out;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export class QualityTracker {
  private template: Float64Array | null = null;
  private amplitudes: number[] = [];
  private intervals: number[] = [];
  private recent: QualityLevel[] = [];

  reset() {
    this.template = null;
    this.amplitudes = [];
    this.intervals = [];
    this.recent = [];
  }

  // segment: el pulso alrededor del latido, siempre con la misma longitud.
  assess(segment: ArrayLike<number>, amplitude: number, rrMs: number | null): QualityLevel {
    const shape = normalize(segment);
    let level: QualityLevel;
    if (!shape) {
      level = 'poor';
    } else if (!this.template || this.amplitudes.length < 3) {
      // Todavía se está aprendiendo cómo es el pulso de esta persona.
      level = 'fair';
      this.learn(shape, amplitude, rrMs);
    } else {
      let corr = 0;
      for (let i = 0; i < shape.length; i++) corr += shape[i] * this.template[i];
      corr /= shape.length;

      const ampRatio = amplitude / median(this.amplitudes);
      const ampOk = ampRatio > 0.5 && ampRatio < 2;
      const rrOk = rrMs === null || this.intervals.length < 3 || Math.abs(rrMs / median(this.intervals) - 1) < 0.25;

      if (corr >= 0.9 && ampOk && rrOk) level = 'good';
      else if (corr >= 0.75 && ampRatio > 0.3 && ampRatio < 3) level = 'fair';
      else level = 'poor';

      if (level !== 'poor') this.learn(shape, amplitude, rrMs);
    }

    this.recent.push(level);
    if (this.recent.length > SUMMARY_BEATS) this.recent.shift();
    return level;
  }

  private learn(shape: Float64Array, amplitude: number, rrMs: number | null) {
    if (!this.template || this.template.length !== shape.length) this.template = shape.slice();
    else {
      for (let i = 0; i < shape.length; i++) this.template[i] += TEMPLATE_RATE * (shape[i] - this.template[i]);
      const renorm = normalize(this.template);
      if (renorm) this.template = renorm;
    }
    this.amplitudes.push(amplitude);
    if (this.amplitudes.length > HISTORY) this.amplitudes.shift();
    if (rrMs !== null) {
      this.intervals.push(rrMs);
      if (this.intervals.length > HISTORY) this.intervals.shift();
    }
  }

  // Resumen de los últimos latidos, para el indicador de pantalla.
  level(): QualityLevel | null {
    if (this.recent.length < 3) return null;
    const good = this.recent.filter((q) => q === 'good').length;
    const poor = this.recent.filter((q) => q === 'poor').length;
    if (poor >= 2) return 'poor';
    if (good >= this.recent.length - 1) return 'good';
    return 'fair';
  }
}
