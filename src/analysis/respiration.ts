import { bandFraction, prepare, resample, spectrum, type Point } from './spectrum.ts';

// Frecuencia respiratoria a partir del pulso. Al respirar cambian dos cosas que
// se ven en cada latido: el intervalo entre latidos (se acorta al inhalar,
// arritmia sinusal respiratoria) y la amplitud del pulso. Se busca el ritmo
// común a las dos series entre 6 y 30 respiraciones por minuto.

const RATE_HZ = 4;
const WINDOW_S = 60;
const MIN_SPAN_S = 40;
const MIN_BEATS = 30;
const F_MIN = 0.1;
const F_MAX = 0.5;
const STEP = 0.005;
// Por debajo de esta concentración de potencia el ritmo no es claro.
const MIN_CONFIDENCE = 0.3;

export interface RespirationReading {
  breathsPerMin: number;
  confidence: number;
}

export interface BeatSample {
  timeS: number;
  rrMs: number | null;
  amplitude: number;
}

export function estimateRespiration(beats: readonly BeatSample[], nowS: number): RespirationReading | null {
  const recent = beats.filter((b) => b.timeS > nowS - WINDOW_S);
  if (recent.length < MIN_BEATS) return null;
  const from = recent[0].timeS;
  const to = recent[recent.length - 1].timeS;
  if (to - from < MIN_SPAN_S) return null;

  const rr: Point[] = recent.filter((b) => b.rrMs !== null).map((b) => ({ t: b.timeS, v: b.rrMs! }));
  const amp: Point[] = recent.map((b) => ({ t: b.timeS, v: b.amplitude }));
  if (rr.length < MIN_BEATS - 1) return null;

  const spectra = [rr, amp].map((series) => spectrum(prepare(resample(series, RATE_HZ, from, to)), RATE_HZ, F_MIN, F_MAX, STEP));
  // Cada espectro se normaliza para que las dos series pesen igual.
  const combined = spectra[0].freqs.map(() => 0);
  for (const s of spectra) {
    const total = s.power.reduce((a, v) => a + v, 0);
    if (total <= 0) continue;
    s.power.forEach((p, i) => (combined[i] += p / total));
  }
  let best = 0;
  for (let i = 1; i < combined.length; i++) if (combined[i] > combined[best]) best = i;
  const merged = { freqs: spectra[0].freqs, power: combined };
  const confidence = bandFraction(merged, merged.freqs[best], 0.03);
  if (confidence < MIN_CONFIDENCE) return null;
  return { breathsPerMin: merged.freqs[best] * 60, confidence };
}
