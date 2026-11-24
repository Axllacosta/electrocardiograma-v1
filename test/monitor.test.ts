import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeader, parseSample } from '../src/device/protocol.ts';
import { DROPPED, Monitor, NO_FINGER } from '../src/monitor.ts';
import { synthetic, toCounts } from './synthetic.ts';
import type { BeatEvent } from '../src/analysis/measurement.ts';

const INFO = { version: 3, sensor: 'max30102', fs: 100, bits: 18 };

test('interpreta la cabecera, los errores y las muestras del firmware', () => {
  assert.deepEqual(parseHeader('#cardio-monitor v3 sensor=max30102 fs=100 bits=18'), { kind: 'info', info: INFO });
  assert.deepEqual(parseHeader('#cardio-monitor v3 error=sensor'), { kind: 'error', version: 3, error: 'sensor' });
  assert.deepEqual(parseHeader('#cardio-monitor v1 fs=250 bits=10 vref=5000'), {
    kind: 'info',
    info: { version: 1, sensor: 'ad8232', fs: 250, bits: 10 },
  });
  assert.deepEqual(parseHeader('#cardio-monitor v3 sensor=max30100 fs=100 bits=16'), {
    kind: 'info',
    info: { version: 3, sensor: 'max30100', fs: 100, bits: 16 },
  });
  assert.equal(parseHeader('#otra cosa'), null);
  assert.deepEqual(parseSample('17,123456,98765', 18), { seq: 17, adc: 123456, red: 98765 });
  assert.equal(parseSample('17,123456', 18), null);
  assert.deepEqual(parseSample('255,L', 18), { seq: 255, adc: null });
  assert.equal(parseSample('256,512', 18), null);
  assert.equal(parseSample('3,262144,1', 18), null);
  assert.equal(parseSample('3,5x2,7', 18), null);
});

function feed(monitor: Monitor, values: (number | null)[], skip: Set<number> = new Set()) {
  values.forEach((value, i) => {
    if (!skip.has(i)) monitor.push({ seq: i & 255, adc: value });
  });
}

test('calcula la frecuencia cardiaca y el índice de perfusión', () => {
  const { ir } = synthetic({ fs: 100, seconds: 30, rrMs: () => 750, wanderPct: 0.3, noise: 20, piPct: 1.5 });
  const monitor = new Monitor(INFO);
  feed(monitor, Array.from(ir, toCounts));
  const snap = monitor.snapshot();
  assert.equal(Math.round(snap.heartRate!), 80);
  assert.ok(Math.abs(snap.lastRrMs! - 750) < 10, `RR ${snap.lastRrMs}`);
  assert.ok(snap.perfusion! > 1 && snap.perfusion! < 2, `IP ${snap.perfusion}`);
  assert.equal(snap.noFinger, false);
  assert.equal(snap.noPulse, false);
});

test('cuenta muestras perdidas por saltos de secuencia', () => {
  const monitor = new Monitor(INFO);
  monitor.startRecording();
  feed(monitor, new Array(600).fill(120000), new Set([100, 101, 102, 300]));
  const rec = monitor.stopRecording()!;
  assert.equal(monitor.snapshot().droppedTotal, 4);
  assert.equal(rec.samples.length, 600);
  assert.equal(rec.samples[101], DROPPED);
  assert.equal(rec.samples[300], DROPPED);
  assert.equal(rec.samples[99], 120000);
});

test('marca la falta de dedo y deja de dar frecuencia', () => {
  const { ir } = synthetic({ fs: 100, seconds: 20, rrMs: () => 800 });
  const values: (number | null)[] = Array.from(ir, toCounts);
  for (let i = 1500; i < values.length; i++) values[i] = null;
  const monitor = new Monitor(INFO);
  monitor.startRecording();
  feed(monitor, values);
  const snap = monitor.snapshot();
  assert.equal(snap.noFinger, true);
  assert.equal(snap.heartRate, null);
  assert.equal(snap.perfusion, null);
  assert.equal(monitor.stopRecording()!.samples[1800], NO_FINGER);
});

test('avisa cuando no hay pulso durante 5 s', () => {
  const monitor = new Monitor(INFO);
  feed(monitor, new Array(100 * 8).fill(120000));
  const snap = monitor.snapshot();
  assert.equal(snap.noPulse, true);
  assert.equal(snap.heartRate, null);
});

test('detecta la saturación del sensor', () => {
  const monitor = new Monitor(INFO);
  feed(monitor, new Array(200).fill(262143));
  assert.equal(monitor.snapshot().clipped, true);
});

test('las estadísticas del registro solo cuentan latidos grabados', () => {
  const { ir } = synthetic({ fs: 100, seconds: 40, rrMs: () => 1000, noise: 20 });
  const values = Array.from(ir, toCounts);
  const monitor = new Monitor(INFO);
  feed(monitor, values.slice(0, 1000));
  monitor.startRecording();
  values.slice(1000).forEach((v, i) => monitor.push({ seq: (1000 + i) & 255, adc: v }));
  const rec = monitor.stopRecording()!;
  assert.equal(rec.stats.durationS, 30);
  assert.ok(rec.stats.beats >= 29 && rec.stats.beats <= 30, `latidos ${rec.stats.beats}`);
  assert.equal(Math.round(rec.stats.hrMean!), 60);
});

test('integra SpO2, respiración y calidad con la señal de los dos colores', () => {
  const { ir, red } = synthetic({
    fs: 100,
    seconds: 90,
    rrMs: (b) => 850 + 45 * Math.sin(b * 0.85 * 2 * Math.PI * 0.25),
    breathHz: 0.25,
    breathAm: 0.12,
    wanderPct: 0.3,
    ratio: 0.5,
    noise: 20,
  });
  const monitor = new Monitor(INFO);
  const beats: BeatEvent[] = [];
  const spo2: number[] = [];
  monitor.subscribe({ onBeat: (b) => beats.push(b), onSpo2: (v) => spo2.push(v) });
  ir.forEach((v, i) => monitor.push({ seq: i & 255, adc: toCounts(v), red: toCounts(red[i]) }));
  const snap = monitor.snapshot();
  assert.ok(Math.abs(snap.spo2! - 98.8) < 1.5, `SpO2 ${snap.spo2}`);
  assert.ok(Math.abs(snap.breathsPerMin! - 15) < 1.5, `respiración ${snap.breathsPerMin}`);
  assert.equal(snap.quality, 'good');
  assert.ok(beats.length > 95, `latidos evaluados ${beats.length}`);
  assert.ok(beats.filter((b) => b.quality === 'good').length > 0.9 * beats.length);
  assert.ok(spo2.length > 70);
});

test('funciona con el MAX30100 a 50 muestras por segundo y 16 bits', () => {
  const info = { version: 3, sensor: 'max30100', fs: 50, bits: 16 };
  const { ir, red } = synthetic({
    fs: 50,
    seconds: 90,
    dc: 40000,
    dcRed: 30000,
    rrMs: (b) => 850 + 45 * Math.sin(b * 0.85 * 2 * Math.PI * 0.25),
    breathHz: 0.25,
    breathAm: 0.12,
    wanderPct: 0.3,
    ratio: 0.5,
    noise: 8,
  });
  const monitor = new Monitor(info);
  const clamp = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));
  ir.forEach((v, i) => monitor.push({ seq: i & 255, adc: clamp(v), red: clamp(red[i]) }));
  const snap = monitor.snapshot();
  assert.ok(Math.abs(snap.heartRate! - 60000 / 850) < 3, `FC ${snap.heartRate}`);
  assert.ok(Math.abs(snap.spo2! - 98.8) < 1.5, `SpO2 ${snap.spo2}`);
  assert.ok(Math.abs(snap.breathsPerMin! - 15) < 1.5, `respiración ${snap.breathsPerMin}`);
  assert.equal(snap.quality, 'good');
  assert.equal(snap.droppedTotal, 0);
});
