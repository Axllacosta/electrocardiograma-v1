// Herramientas para analizar series que llegan una vez por latido (intervalos,
// amplitudes): se pasan a muestreo uniforme y se busca su ritmo dominante.

export interface Point {
  t: number; // segundos
  v: number;
}

// Interpolación lineal a `rate` muestras por segundo entre `from` y `to`.
export function resample(points: readonly Point[], rate: number, from: number, to: number): Float64Array {
  const n = Math.max(0, Math.floor((to - from) * rate));
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = from + i / rate;
    while (j < points.length - 2 && points[j + 1].t < t) j++;
    const a = points[j];
    const b = points[Math.min(j + 1, points.length - 1)];
    if (t <= a.t || b.t === a.t) out[i] = a.v;
    else if (t >= b.t) out[i] = b.v;
    else out[i] = a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return out;
}

// Quita la recta de mejor ajuste y aplica una ventana de Hann.
export function prepare(x: Float64Array): Float64Array {
  const n = x.length;
  if (n < 2) return x.slice();
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += x[i];
    sxx += i * i;
    sxy += i * x[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = (x[i] - intercept - slope * i) * w;
  }
  return out;
}

// Potencia en la frecuencia f (Hz) por transformada de Fourier directa.
export function powerAt(x: Float64Array, rate: number, f: number): number {
  const w = (2 * Math.PI * f) / rate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos(w * i);
    im -= x[i] * Math.sin(w * i);
  }
  return re * re + im * im;
}

export interface Spectrum {
  freqs: number[];
  power: number[];
}

export function spectrum(x: Float64Array, rate: number, fMin: number, fMax: number, step: number): Spectrum {
  const freqs: number[] = [];
  const power: number[] = [];
  for (let f = fMin; f <= fMax + 1e-9; f += step) {
    freqs.push(f);
    power.push(powerAt(x, rate, f));
  }
  return { freqs, power };
}

// Fracción de la potencia total que cae a menos de `halfWidth` Hz de f.
export function bandFraction(s: Spectrum, f: number, halfWidth: number): number {
  let inBand = 0;
  let total = 0;
  for (let i = 0; i < s.freqs.length; i++) {
    total += s.power[i];
    if (Math.abs(s.freqs[i] - f) <= halfWidth) inBand += s.power[i];
  }
  return total > 0 ? inBand / total : 0;
}
