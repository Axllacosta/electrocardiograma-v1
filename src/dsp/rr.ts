// Estadística de intervalos RR. Los intervalos fuera de 300-2000 ms y los que
// cambian más de un 20 % respecto del anterior se tratan como artefacto o
// latido ectópico y no entran en SDNN ni RMSSD.

export const MIN_RR_MS = 300;
export const MAX_RR_MS = 2000;
const MIN_INTERVALS = 10;

export function heartRate(rrMs: readonly number[], beats = 8): number | null {
  const recent = rrMs.slice(-beats).filter((rr) => rr >= MIN_RR_MS && rr <= MAX_RR_MS);
  if (recent.length === 0) return null;
  const mean = recent.reduce((a, v) => a + v, 0) / recent.length;
  return 60000 / mean;
}

function normalMask(rrMs: readonly number[]): boolean[] {
  return rrMs.map((rr, i) => {
    if (rr < MIN_RR_MS || rr > MAX_RR_MS) return false;
    if (i === 0) return true;
    const prev = rrMs[i - 1];
    return Math.abs(rr - prev) <= 0.2 * prev;
  });
}

export function sdnn(rrMs: readonly number[]): number | null {
  const mask = normalMask(rrMs);
  const nn = rrMs.filter((_, i) => mask[i]);
  if (nn.length < MIN_INTERVALS) return null;
  const mean = nn.reduce((a, v) => a + v, 0) / nn.length;
  const variance = nn.reduce((a, v) => a + (v - mean) ** 2, 0) / (nn.length - 1);
  return Math.sqrt(variance);
}

export function rmssd(rrMs: readonly number[]): number | null {
  const mask = normalMask(rrMs);
  let sum = 0;
  let count = 0;
  for (let i = 1; i < rrMs.length; i++) {
    if (!mask[i] || !mask[i - 1]) continue;
    sum += (rrMs[i] - rrMs[i - 1]) ** 2;
    count++;
  }
  if (count < MIN_INTERVALS - 1) return null;
  return Math.sqrt(sum / count);
}

// Gráfico de Poincaré: cada intervalo frente al siguiente. SD1 mide la
// variabilidad latido a latido (corto plazo) y SD2 la de largo plazo.
export function poincare(rrMs: readonly number[]): { sd1: number; sd2: number } | null {
  const mask = normalMask(rrMs);
  const nn = rrMs.filter((_, i) => mask[i]);
  const sd = sdnn(rrMs);
  const rm = rmssd(rrMs);
  if (sd === null || rm === null || nn.length < MIN_INTERVALS) return null;
  // Con la aproximación habitual: SD1² = RMSSD² / 2, SD2² = 2·SDNN² − SD1².
  const sd1Sq = (rm * rm) / 2;
  return { sd1: Math.sqrt(sd1Sq), sd2: Math.sqrt(Math.max(0, 2 * sd * sd - sd1Sq)) };
}
