// Prueba de recuperación de la frecuencia cardiaca: cuánto baja la FC en el
// primer minuto después de un esfuerzo. Cuanto más baja, mejor se recupera el
// cuerpo. Con un sensor de dedo no se puede medir durante el ejercicio, así que
// el minuto empieza al volver a apoyar el dedo, y la FC máxima se toma en los
// primeros segundos tras el esfuerzo.

export const REST_S = 60;
export const RECOVERY_S = 65;
const PEAK_WINDOW_S = 20;
const AT_60_FROM = 55;
const AT_60_TO = 65;

export interface HeartPoint {
  timeS: number;
  hr: number;
}

export interface RecoveryResult {
  kind: 'recovery';
  id: string;
  startedAt: number;
  restHr: number | null;
  peakHr: number;
  hrAt60: number;
  drop: number;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, v) => a + v, 0) / values.length : null;
}

// FC en reposo: media de la segunda mitad del minuto de reposo.
export function restingRate(points: readonly HeartPoint[], startS: number): number | null {
  return mean(points.filter((p) => p.timeS >= startS + REST_S / 2 && p.timeS < startS + REST_S).map((p) => p.hr));
}

export function recoveryDrop(points: readonly HeartPoint[], startS: number): { peakHr: number; hrAt60: number } | null {
  const early = points.filter((p) => p.timeS >= startS && p.timeS < startS + PEAK_WINDOW_S);
  if (early.length < 3) return null;
  // Media móvil de 3 latidos para que un intervalo suelto no marque el máximo.
  let peakHr = 0;
  for (let i = 2; i < early.length; i++) peakHr = Math.max(peakHr, (early[i].hr + early[i - 1].hr + early[i - 2].hr) / 3);
  const hrAt60 = mean(points.filter((p) => p.timeS >= startS + AT_60_FROM && p.timeS <= startS + AT_60_TO).map((p) => p.hr));
  if (hrAt60 === null) return null;
  return { peakHr, hrAt60 };
}

export type RecoveryPhase = 'rest' | 'exercise' | 'recovery' | 'done';

export class RecoveryTest {
  phase: RecoveryPhase = 'rest';
  readonly startedAt = Date.now();
  readonly restStartS: number;
  recoveryStartS = 0;
  private points: HeartPoint[] = [];

  constructor(nowS: number) {
    this.restStartS = nowS;
  }

  addBeat(point: HeartPoint) {
    if (this.phase === 'rest' || this.phase === 'recovery') this.points.push(point);
  }

  update(nowS: number) {
    if (this.phase === 'rest' && nowS - this.restStartS >= REST_S) this.phase = 'exercise';
    if (this.phase === 'recovery' && nowS - this.recoveryStartS >= RECOVERY_S) this.phase = 'done';
  }

  // Al terminar el ejercicio, con el dedo ya sobre el sensor.
  startRecovery(nowS: number) {
    this.phase = 'recovery';
    this.recoveryStartS = nowS;
  }

  // Permite saltar el reposo si la persona ya estaba en reposo antes.
  skipRest() {
    if (this.phase === 'rest') this.phase = 'exercise';
  }

  remaining(nowS: number): number {
    if (this.phase === 'rest') return Math.max(0, REST_S - (nowS - this.restStartS));
    if (this.phase === 'recovery') return Math.max(0, RECOVERY_S - (nowS - this.recoveryStartS));
    return 0;
  }

  get heartPoints(): readonly HeartPoint[] {
    return this.points;
  }

  result(id: string): RecoveryResult | null {
    const drop = recoveryDrop(this.points, this.recoveryStartS);
    if (!drop) return null;
    return {
      kind: 'recovery',
      id,
      startedAt: this.startedAt,
      restHr: restingRate(this.points, this.restStartS),
      peakHr: drop.peakHr,
      hrAt60: drop.hrAt60,
      drop: drop.peakHr - drop.hrAt60,
    };
  }
}
