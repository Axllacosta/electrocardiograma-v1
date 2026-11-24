import { bandFraction, prepare, resample, spectrum, type Point } from './spectrum.ts';

// Respiración guiada (biofeedback de variabilidad). Al respirar despacio y a
// ritmo constante, la frecuencia cardiaca sube al inhalar y baja al exhalar de
// forma amplia y regular. Se miden dos cosas:
//  - oscilación: diferencia media entre la FC máxima y mínima de cada ciclo;
//  - coherencia: qué parte de la variación de la FC sigue el ritmo marcado.

export const PACER_RATES = [4.5, 5, 5.5, 6, 6.5, 7] as const;
export const INHALE_FRACTION = 0.4;

const RATE_HZ = 4;
const WINDOW_S = 64;
const MIN_SPAN_S = 30;

export interface HeartPoint {
  timeS: number;
  hr: number;
}

// Fase del marcapasos respiratorio en [0, 1): de 0 a INHALE_FRACTION se inhala.
export function pacerPhase(elapsedS: number, breathsPerMin: number): number {
  const period = 60 / breathsPerMin;
  return (elapsedS % period) / period;
}

// Tamaño del círculo guía (0 = vacío, 1 = pulmones llenos), con aceleración suave.
export function pacerLevel(phase: number): number {
  if (phase < INHALE_FRACTION) return 0.5 - 0.5 * Math.cos((Math.PI * phase) / INHALE_FRACTION);
  return 0.5 + 0.5 * Math.cos((Math.PI * (phase - INHALE_FRACTION)) / (1 - INHALE_FRACTION));
}

export interface BreathingMetrics {
  oscillationBpm: number | null;
  coherence: number | null;
  cycles: number;
}

export function breathingMetrics(points: readonly HeartPoint[], startS: number, nowS: number, breathsPerMin: number): BreathingMetrics {
  const period = 60 / breathsPerMin;
  const cycles = Math.floor((nowS - startS) / period);

  // Oscilación en los últimos 3 ciclos completos.
  const swings: number[] = [];
  for (let c = Math.max(0, cycles - 3); c < cycles; c++) {
    const from = startS + c * period;
    const inCycle = points.filter((p) => p.timeS >= from && p.timeS < from + period).map((p) => p.hr);
    if (inCycle.length >= 3) swings.push(Math.max(...inCycle) - Math.min(...inCycle));
  }
  const oscillationBpm = swings.length > 0 ? swings.reduce((a, v) => a + v, 0) / swings.length : null;

  let coherence: number | null = null;
  const recent = points.filter((p) => p.timeS >= Math.max(startS, nowS - WINDOW_S));
  if (recent.length > 10 && recent[recent.length - 1].timeS - recent[0].timeS >= MIN_SPAN_S) {
    const series: Point[] = recent.map((p) => ({ t: p.timeS, v: p.hr }));
    const x = prepare(resample(series, RATE_HZ, recent[0].timeS, recent[recent.length - 1].timeS));
    const s = spectrum(x, RATE_HZ, 0.04, 0.4, 0.005);
    coherence = bandFraction(s, breathsPerMin / 60, 0.015);
  }
  return { oscillationBpm, coherence, cycles };
}
