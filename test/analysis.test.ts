import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breathingMetrics, pacerLevel, pacerPhase, type HeartPoint } from '../src/analysis/breathing.ts';
import { MeasurementSession, type BeatEvent } from '../src/analysis/measurement.ts';
import { QualityTracker } from '../src/analysis/quality.ts';
import { RecoveryTest, recoveryDrop } from '../src/analysis/recovery.ts';
import { estimateRespiration, type BeatSample } from '../src/analysis/respiration.ts';
import { Spo2Estimator, spo2FromRatio } from '../src/analysis/spo2.ts';
import { poincare } from '../src/dsp/rr.ts';
import { synthetic } from './synthetic.ts';

const FS = 100;

function runSpo2(ratio: number) {
  const { ir, red } = synthetic({ fs: FS, seconds: 20, rrMs: () => 850, ratio, noise: 20 });
  const est = new Spo2Estimator(FS);
  for (let i = 0; i < ir.length; i++) est.push(ir[i], red[i]);
  return est.estimate();
}

test('SpO2: recupera la razón rojo/IR y la convierte con la curva de Maxim', () => {
  for (const ratio of [0.5, 0.7, 0.9]) {
    const r = runSpo2(ratio)!;
    assert.ok(Math.abs(r.ratio - ratio) < 0.03, `razón ${r.ratio} en vez de ${ratio}`);
    assert.ok(Math.abs(r.spo2 - spo2FromRatio(ratio)) < 1.5);
  }
  assert.ok(Math.abs(spo2FromRatio(0.5) - 98.8) < 0.1);
});

test('SpO2: no da valor sin señal suficiente ni con razones imposibles', () => {
  const est = new Spo2Estimator(FS);
  for (let i = 0; i < 3 * FS; i++) est.push(120000, 90000);
  assert.equal(est.estimate(), null);
  assert.equal(runSpo2(2.5), null);
});

function beatsFrom(rrMs: (t: number) => number, ampAt: (t: number) => number, seconds: number): BeatSample[] {
  const out: BeatSample[] = [];
  let t = 0;
  let prev: number | null = null;
  while (t < seconds) {
    const rr = rrMs(t);
    out.push({ timeS: t, rrMs: prev, amplitude: ampAt(t) });
    prev = rr;
    t += rr / 1000;
  }
  return out;
}

test('frecuencia respiratoria a partir del ritmo y la amplitud del pulso', () => {
  for (const bpm of [8, 12, 18, 24]) {
    const f = bpm / 60;
    const beats = beatsFrom(
      (t) => 850 + 40 * Math.sin(2 * Math.PI * f * t),
      (t) => 1.5 + 0.15 * Math.sin(2 * Math.PI * f * t + 1),
      70,
    );
    const r = estimateRespiration(beats, 70)!;
    assert.ok(r, `sin resultado a ${bpm} rpm`);
    assert.ok(Math.abs(r.breathsPerMin - bpm) < 1, `${r.breathsPerMin} en vez de ${bpm}`);
  }
});

test('frecuencia respiratoria: no inventa un valor sin modulación ni con pocos datos', () => {
  let seed = 3;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const noisy = beatsFrom(() => 850 + 30 * (rand() - 0.5), () => 1.5 + 0.2 * (rand() - 0.5), 70);
  assert.equal(estimateRespiration(noisy, 70), null);
  const short = beatsFrom((t) => 850 + 40 * Math.sin(t), () => 1.5, 20);
  assert.equal(estimateRespiration(short, 20), null);
});

function pulseSegment(phase = 0, noise = 0, seed = 1) {
  let s = seed;
  return Float64Array.from({ length: 70 }, (_, i) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const t = (i - 25) / FS + phase;
    return Math.exp(-((t - 0.05) ** 2) / (2 * 0.06 ** 2)) + 0.35 * Math.exp(-((t - 0.3) ** 2) / 0.02) + noise * ((s / 0x7fffffff) * 2 - 1);
  });
}

test('calidad: pulsos regulares son buenos y un artefacto es malo', () => {
  const q = new QualityTracker();
  for (let i = 0; i < 8; i++) q.assess(pulseSegment(0, 0.02, i + 1), 1.5, 850);
  assert.equal(q.assess(pulseSegment(0, 0.02, 99), 1.5, 860), 'good');
  assert.equal(q.level(), 'good');
  // Movimiento: forma muy distinta, amplitud enorme e intervalo corto.
  const artifact = Float64Array.from({ length: 70 }, (_, i) => Math.sin(i / 3) * 4);
  assert.equal(q.assess(artifact, 6, 400), 'poor');
  assert.equal(q.assess(artifact, 6, 300), 'poor');
  assert.equal(q.level(), 'poor');
});

test('respiración guiada: fases del marcapasos', () => {
  assert.equal(pacerPhase(0, 6), 0);
  assert.ok(Math.abs(pacerPhase(5, 6) - 0.5) < 1e-9);
  assert.equal(pacerLevel(0), 0);
  assert.ok(Math.abs(pacerLevel(0.4) - 1) < 1e-9);
  assert.ok(pacerLevel(0.99) < 0.01);
});

test('respiración guiada: oscilación y coherencia cuando la FC sigue al ritmo', () => {
  const f = 6 / 60;
  const synced: HeartPoint[] = [];
  const unsynced: HeartPoint[] = [];
  let seed = 5;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 90; t += 0.85) {
    synced.push({ timeS: t, hr: 70 + 6 * Math.sin(2 * Math.PI * f * t) });
    unsynced.push({ timeS: t, hr: 70 + 6 * (rand() - 0.5) });
  }
  const a = breathingMetrics(synced, 0, 90, 6);
  const b = breathingMetrics(unsynced, 0, 90, 6);
  assert.ok(a.oscillationBpm! > 10 && a.oscillationBpm! < 12.5, `oscilación ${a.oscillationBpm}`);
  assert.ok(a.coherence! > 0.8, `coherencia ${a.coherence}`);
  assert.ok(b.coherence! < 0.3, `coherencia sin sincronía ${b.coherence}`);
  assert.equal(a.cycles, 9);
});

test('medición estándar: resume y descarta intervalos de mala calidad', () => {
  const session = new MeasurementSession(60, 10);
  for (let i = 0; i < 70; i++) {
    const quality = i === 30 ? 'poor' : 'good';
    const rrMs = i === 0 ? null : i === 30 ? 400 : i % 2 ? 1000 : 1100;
    const beat: BeatEvent = { timeS: 10 + i * 1.05, rrMs, amplitude: 1.5, quality };
    session.addBeat(beat);
  }
  session.addSpo2(97);
  session.addSpo2(99);
  const r = session.result('x');
  assert.equal(r.beats, 70);
  assert.equal(Math.round(r.rmssd!), 100);
  assert.ok(Math.abs(r.hrMean! - 60000 / 1050) < 1);
  assert.equal(r.spo2Mean, 98);
  assert.ok(r.goodPct > 98);
});

test('recuperación: FC máxima al empezar y FC al minuto', () => {
  const points: HeartPoint[] = [];
  for (let t = 0; t <= 70; t += 0.5) points.push({ timeS: 100 + t, hr: 80 + 60 * Math.exp(-t / 40) });
  const r = recoveryDrop(points, 100)!;
  assert.ok(Math.abs(r.peakHr - 140) < 2);
  assert.ok(Math.abs(r.hrAt60 - (80 + 60 * Math.exp(-60 / 40))) < 1.5);

  const test = new RecoveryTest(0);
  for (let t = 0; t < 60; t += 1) test.addBeat({ timeS: t, hr: 70 });
  test.update(60);
  assert.equal(test.phase, 'exercise');
  test.startRecovery(200);
  for (const p of points) test.addBeat({ timeS: p.timeS + 100, hr: p.hr });
  test.update(266);
  assert.equal(test.phase, 'done');
  const result = test.result('y')!;
  assert.equal(result.restHr, 70);
  assert.ok(result.drop > 45 && result.drop < 50, `bajada ${result.drop}`);
});

test('Poincaré: SD1 y SD2', () => {
  const rr = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1000 : 1100));
  const p = poincare(rr)!;
  assert.ok(Math.abs(p.sd1 - 100 / Math.SQRT2) < 0.5);
  assert.equal(poincare(rr.slice(0, 4)), null);
});
