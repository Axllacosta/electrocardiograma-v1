import { Biquad } from './biquad.ts';

// Procesamiento de la señal de pulso óptica (fotopletismografía, PPG) del
// MAX30100 o MAX30102: componente pulsátil como porcentaje de la luz recibida y
// detección de latidos en el flanco de subida de cada pulso.

const BUTTERWORTH_Q = Math.SQRT1_2;
export const BAND_LOW_HZ = 0.5;
export const BAND_HIGH_HZ = 5;
// Constante de tiempo con la que se sigue el nivel medio de luz (componente continua).
const DC_TAU_S = 1.5;

export function describeProcessing(): string {
  return 'paso banda 0,5–5 Hz';
}

// Devuelve la componente pulsátil en % del nivel medio, con el signo cambiado
// para que cada latido sea una subida: cuando llega la onda de pulso hay más
// sangre en el dedo, se absorbe más luz y la lectura baja.
export class PpgFilter {
  private hp: Biquad;
  private lp: Biquad;
  private dc = 0;
  private readonly alpha: number;

  constructor(fs: number) {
    this.hp = new Biquad('highpass', fs, BAND_LOW_HZ, BUTTERWORTH_Q);
    this.lp = new Biquad('lowpass', fs, Math.min(BAND_HIGH_HZ, fs / 4), BUTTERWORTH_Q);
    this.alpha = 1 - Math.exp(-1 / (DC_TAU_S * fs));
  }

  // Coloca los filtros en régimen permanente para la lectura x, así al apoyar
  // el dedo no aparece un escalón enorme.
  settle(x: number) {
    this.hp.settle(x);
    this.lp.settle(0);
    this.dc = x;
  }

  process(x: number): number {
    this.dc += this.alpha * (x - this.dc);
    const ac = this.lp.process(this.hp.process(x));
    return this.dc > 0 ? (-100 * ac) / this.dc : 0;
  }
}

// Detector de pulso por función de suma de pendientes (Zong y otros, 2003):
// se suman los incrementos positivos de la señal en una ventana de 128 ms, que
// da un pico claro en cada flanco de subida. El instante del latido es el de
// máxima pendiente del flanco, interpolado entre muestras, que es el punto
// más estable de la onda para medir intervalos entre latidos.

const WINDOW_S = 0.128;
const LEARNING_S = 3;
const RELEARN_AFTER_S = 4;
const REFRACTORY_S = 0.27; // hasta unos 220 lpm
const MAX_RISE_S = 0.3;
// Un pulso más pequeño que esto (en % de la luz) se considera ruido.
export const MIN_PULSE_PCT = 0.1;

export class PulseDetector {
  private readonly fs: number;
  private readonly win: number;
  private readonly histSize: number;

  private hist: Float32Array;
  private derHist: Float32Array;
  private ring: Float32Array;
  private ringPos = 0;
  private ssfSum = 0;
  private prevY = 0;
  private started = false;

  private learning = true;
  private learnStart = 0;
  private learnMax = 0;
  private lastActivity = 0;

  private spk = 0;
  private rising = false;
  private riseStart = 0;
  private risePeak = 0;
  private lastBeat = -Infinity;
  private rrHistory: number[] = [];

  constructor(fs: number) {
    this.fs = fs;
    this.win = Math.max(2, Math.round(WINDOW_S * fs));
    this.histSize = Math.round(4 * fs);
    this.hist = new Float32Array(this.histSize);
    this.derHist = new Float32Array(this.histSize);
    this.ring = new Float32Array(this.win);
  }

  reset(n: number) {
    this.ring.fill(0);
    this.ringPos = 0;
    this.ssfSum = 0;
    this.started = false;
    this.rising = false;
    this.lastBeat = -Infinity;
    this.rrHistory = [];
    this.startLearning(n);
  }

  private startLearning(n: number) {
    this.learning = true;
    this.learnStart = n;
    this.learnMax = 0;
    this.lastActivity = n;
  }

  private at(buf: Float32Array, i: number) {
    return buf[((i % this.histSize) + this.histSize) % this.histSize];
  }

  // y: pulso en %, n: índice absoluto de la muestra. Devuelve el instante del
  // latido como índice de muestra con decimales, unos 150 ms después.
  push(y: number, n: number): number | null {
    const h = n % this.histSize;
    this.hist[h] = y;
    const d = this.started ? y - this.prevY : 0;
    this.started = true;
    this.prevY = y;
    this.derHist[h] = d;

    const up = Math.max(0, d);
    this.ssfSum += up - this.ring[this.ringPos];
    this.ring[this.ringPos] = up;
    this.ringPos = (this.ringPos + 1) % this.win;
    const ssf = Math.max(0, this.ssfSum);

    if (this.learning) {
      this.learnMax = Math.max(this.learnMax, ssf);
      if (n - this.learnStart >= LEARNING_S * this.fs) {
        this.spk = this.learnMax * 0.8;
        this.learning = false;
        this.lastActivity = n;
      }
      return null;
    }

    let beat: number | null = null;
    const threshold = 0.5 * this.spk;

    if (!this.rising) {
      if (ssf > threshold && n - this.lastBeat > REFRACTORY_S * this.fs) {
        this.rising = true;
        this.riseStart = n;
        this.risePeak = ssf;
      }
    } else {
      this.risePeak = Math.max(this.risePeak, ssf);
      if (ssf < 0.5 * this.risePeak || n - this.riseStart > MAX_RISE_S * this.fs) {
        this.rising = false;
        beat = this.classify(n);
      }
    }

    if (beat === null && n - this.lastActivity > RELEARN_AFTER_S * this.fs) this.startLearning(n);
    return beat;
  }

  private classify(n: number): number | null {
    const peak = this.risePeak;
    // La onda dícrota (el rebote tras el pulso) da un flanco más pequeño poco
    // después del latido; se descarta para no contar dos latidos.
    if (this.rrHistory.length > 0 && Number.isFinite(this.lastBeat)) {
      const rrMean = this.rrHistory.reduce((a, v) => a + v, 0) / this.rrHistory.length;
      if (this.riseStart - this.lastBeat < 0.6 * rrMean && peak < 0.7 * this.spk) return null;
    }

    // Máxima pendiente dentro del flanco.
    const from = this.riseStart - this.win;
    let best = from;
    for (let i = from + 1; i <= n; i++) if (this.at(this.derHist, i) > this.at(this.derHist, best)) best = i;

    // Amplitud del pulso: del pie (mínimo antes del flanco) a la cima.
    let foot = Infinity;
    for (let i = best - Math.round(0.3 * this.fs); i <= best; i++) foot = Math.min(foot, this.at(this.hist, i));
    let top = -Infinity;
    for (let i = best; i <= n; i++) top = Math.max(top, this.at(this.hist, i));
    if (top - foot < MIN_PULSE_PCT) return null;

    this.spk = 0.125 * peak + 0.875 * this.spk;
    this.lastActivity = n;

    // Interpolación parabólica del máximo de la derivada. La derivada en la
    // muestra i corresponde al instante i - 0,5.
    const a = this.at(this.derHist, best - 1);
    const b = this.at(this.derHist, best);
    const c = this.at(this.derHist, best + 1);
    const den = a - 2 * b + c;
    const offset = best < n && den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const t = best - 0.5 + offset;

    if (Number.isFinite(this.lastBeat)) {
      this.rrHistory.push(t - this.lastBeat);
      if (this.rrHistory.length > 8) this.rrHistory.shift();
    }
    this.lastBeat = t;
    return t;
  }
}
