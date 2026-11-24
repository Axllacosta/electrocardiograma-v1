import { irReading, pulseShape } from '../src/device/pulseShape.ts';

// Señal de pulso sintética para las pruebas, tal como la entregaría el
// MAX30102: pulsos con onda dícrota sobre un nivel de luz que deriva con la
// respiración, más ruido del sensor.

export interface SyntheticOptions {
  fs: number;
  seconds: number;
  rrMs: (beat: number) => number;
  dc?: number;
  piPct?: number;
  wanderPct?: number;
  noise?: number;
  // Respiración: frecuencia en Hz y cuánto modula la amplitud del pulso (0-1).
  breathHz?: number;
  breathAm?: number;
  // Razón rojo/IR del tamaño relativo del pulso (para la SpO2).
  ratio?: number;
  dcRed?: number;
}

export function synthetic(o: SyntheticOptions) {
  const n = Math.round(o.seconds * o.fs);
  const dc = o.dc ?? 120000;
  const ir = new Float64Array(n);
  const red = new Float64Array(n);
  const dcRed = o.dcRed ?? 90000;
  const onsets: number[] = [];
  const rrs: number[] = [];
  let t = 0.5;
  let beat = 0;
  while (t < o.seconds + 1) {
    const rr = o.rrMs(beat++) / 1000;
    onsets.push(t);
    rrs.push(rr);
    t += rr;
  }
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n; i++) {
    const ti = i / o.fs;
    let pulse = 0;
    for (let b = 0; b < onsets.length; b++) {
      const dt = ti - onsets[b];
      if (dt >= -0.2 && dt <= 1.2) pulse += pulseShape(dt, rrs[b]);
    }
    const breath = Math.sin(2 * Math.PI * (o.breathHz ?? 0.25) * ti);
    const level = 1 + ((o.wanderPct ?? 0) / 100) * breath;
    const pi = (o.piPct ?? 1.5) * (1 + (o.breathAm ?? 0) * breath);
    ir[i] = irReading(pulse, dc * level, pi) + (o.noise ?? 0) * (rand() * 2 - 1);
    red[i] = irReading(pulse, dcRed * level, pi * (o.ratio ?? 0.5)) + (o.noise ?? 0) * (rand() * 2 - 1);
  }
  // Intervalos verdaderos entre latidos, en ms.
  const rrMs = rrs.slice(0, -1).map((rr) => rr * 1000);
  return { ir, red, onsets: onsets.filter((s) => s < o.seconds).map((s) => s * o.fs), rrMs };
}

export function toCounts(v: number): number {
  return Math.max(0, Math.min(262143, Math.round(v)));
}
