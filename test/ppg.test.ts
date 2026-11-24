import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PpgFilter, PulseDetector } from '../src/dsp/ppg.ts';
import { heartRate, rmssd, sdnn } from '../src/dsp/rr.ts';
import { synthetic } from './synthetic.ts';

const FS = 100;

function detect(ir: Float64Array) {
  const filter = new PpgFilter(FS);
  filter.settle(ir[0]);
  const det = new PulseDetector(FS);
  det.reset(0);
  const found: number[] = [];
  for (let i = 0; i < ir.length; i++) {
    const t = det.push(filter.process(ir[i]), i);
    if (t !== null) found.push(t);
  }
  return found;
}

// Empareja cada latido detectado con el inicio de pulso verdadero que tiene
// justo antes (el flanco de subida llega unos 100-150 ms después del inicio).
function match(found: number[], onsets: number[], fromSample: number) {
  const expected = onsets.filter((o) => o >= fromSample && o < onsets[onsets.length - 1] - FS);
  const owner = (f: number) => {
    let best = -1;
    for (let i = 0; i < onsets.length; i++) if (onsets[i] <= f) best = i;
    return best;
  };
  const counts = new Map<number, number>();
  for (const f of found) {
    const o = owner(f);
    if (o < 0 || f - onsets[o] > 0.4 * FS) continue;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const hits = expected.filter((o) => counts.get(onsets.indexOf(o)) === 1).length;
  const doubles = [...counts.values()].filter((c) => c > 1).length;
  return { expected: expected.length, hits, doubles };
}

const cases = [
  { name: 'ritmo regular a 72 lpm', rr: () => 833 },
  { name: 'bradicardia a 40 lpm', rr: () => 1500 },
  { name: 'taquicardia a 160 lpm', rr: () => 375 },
  { name: 'intervalos variables', rr: (b: number) => 800 + 120 * Math.sin(b / 3) },
];

for (const c of cases) {
  test(`detecta todos los latidos: ${c.name}`, () => {
    const { ir, onsets } = synthetic({ fs: FS, seconds: 60, rrMs: c.rr, wanderPct: 0.5, noise: 30 });
    const res = match(detect(ir), onsets, 4 * FS);
    assert.equal(res.hits, res.expected);
    assert.equal(res.doubles, 0);
  });
}

test('los intervalos entre latidos coinciden con los reales en pocos ms', () => {
  const rr = (b: number) => 800 + 80 * Math.sin(b / 2);
  const { ir, onsets } = synthetic({ fs: FS, seconds: 90, rrMs: rr, noise: 20 });
  const found = detect(ir);
  // Cada latido detectado se asigna al inicio de pulso que tiene justo antes.
  const owner = found.map((t) => onsets.filter((o) => o <= t).length - 1);
  let worst = 0;
  let compared = 0;
  for (let i = 1; i < found.length; i++) {
    if (owner[i] !== owner[i - 1] + 1) continue;
    const measured = ((found[i] - found[i - 1]) * 1000) / FS;
    const truth = ((onsets[owner[i]] - onsets[owner[i - 1]]) * 1000) / FS;
    worst = Math.max(worst, Math.abs(measured - truth));
    compared++;
  }
  assert.ok(compared > 100, `solo ${compared} intervalos`);
  // El pulso sintético adelanta o retrasa algo su subida según el ritmo, como uno real.
  assert.ok(worst < 12, `error máximo ${worst.toFixed(1)} ms`);
});

test('pulso débil (índice de perfusión 0,3 %)', () => {
  const { ir, onsets } = synthetic({ fs: FS, seconds: 40, rrMs: () => 900, piPct: 0.3, noise: 30 });
  const res = match(detect(ir), onsets, 4 * FS);
  assert.equal(res.hits, res.expected);
});

test('vuelve a detectar tras un cambio brusco de amplitud', () => {
  const a = synthetic({ fs: FS, seconds: 30, rrMs: () => 800, noise: 20 });
  const b = synthetic({ fs: FS, seconds: 30, rrMs: () => 800, piPct: 0.4, noise: 20 });
  const ir = new Float64Array(a.ir.length + b.ir.length);
  ir.set(a.ir);
  ir.set(b.ir, a.ir.length);
  const late = b.onsets.map((o) => o + a.ir.length);
  const res = match(detect(ir), late, a.ir.length + 8 * FS);
  assert.equal(res.hits, res.expected);
});

for (const noise of [30, 100]) {
  test(`no detecta latidos en una señal sin pulso (ruido de ±${noise} cuentas)`, () => {
    let seed = 7;
    const ir = Float64Array.from({ length: 60 * FS }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return 120000 + noise * ((seed / 0x7fffffff) * 2 - 1);
    });
    assert.equal(detect(ir).length, 0);
  });
}

test('el filtro da el pulso en % de la luz, hacia arriba', () => {
  const { ir } = synthetic({ fs: FS, seconds: 20, rrMs: () => 1000, piPct: 2 });
  const f = new PpgFilter(FS);
  f.settle(ir[0]);
  let lo = Infinity;
  let hi = -Infinity;
  let atPeak = 0;
  for (let i = 0; i < ir.length; i++) {
    const y = f.process(ir[i]);
    if (i < 10 * FS) continue;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
    // A 200 ms del inicio del latido (cima sistólica) la señal está alta.
    if ((i - 50) % 100 === 20) atPeak += y;
  }
  assert.ok(hi - lo > 1.2 && hi - lo < 2.6, `amplitud ${hi - lo}`);
  assert.ok(atPeak > 0);
});

test('frecuencia cardiaca y variabilidad', () => {
  assert.equal(heartRate([]), null);
  assert.equal(Math.round(heartRate([1000, 1000, 1000])!), 60);
  const rr = Array.from({ length: 20 }, (_, i) => (i % 2 ? 1000 : 1100));
  assert.equal(Math.round(rmssd(rr)!), 100);
  assert.ok(Math.abs(sdnn(rr)! - 51.3) < 0.1);
  assert.equal(sdnn(rr.slice(0, 5)), null);
  // Un intervalo artefactado no entra en el cálculo
  const withArtifact = [...rr.slice(0, 10), 400, ...rr.slice(10)];
  assert.equal(Math.round(rmssd(withArtifact)!), 100);
});
