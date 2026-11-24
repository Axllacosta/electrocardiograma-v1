import { useEffect, useRef, useState } from 'react';
import { breathingMetrics, INHALE_FRACTION, pacerLevel, pacerPhase, PACER_RATES, type HeartPoint } from '../analysis/breathing.ts';
import type { ChartOptions } from '../chart.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { round } from '../format.ts';
import { formatClock, heartRateOf, NeedsSignal, useBeats, useTick, type ToolProps } from './shared.tsx';

const CHART_SECONDS = 90;
const percent = new Intl.NumberFormat('es', { style: 'percent' });
const rateFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });

function coherenceWord(c: number) {
  if (c >= 0.6) return 'alta';
  if (c >= 0.3) return 'media';
  return 'baja';
}

// El círculo se mueve con el reloj del navegador para que la animación sea
// fluida; las métricas usan el reloj de las muestras del sensor.
function Pacer({ rate, startMs }: { rate: number; startMs: number }) {
  const circle = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const phase = pacerPhase((performance.now() - startMs) / 1000, rate);
      const level = pacerLevel(phase);
      if (circle.current) circle.current.style.transform = `scale(${0.35 + 0.65 * level})`;
      if (label.current) {
        const period = 60 / rate;
        const inhale = phase < INHALE_FRACTION;
        const left = inhale ? (INHALE_FRACTION - phase) * period : (1 - phase) * period;
        label.current.textContent = `${inhale ? 'Inhala' : 'Exhala'} ${Math.ceil(left)}`;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [rate, startMs]);

  return (
    <div className="pacer" aria-hidden="true">
      <div className="pacer-ring" />
      <div ref={circle} className="pacer-circle" />
      <span ref={label} className="pacer-label" />
    </div>
  );
}

export function BreathingView({ monitor, ...rest }: ToolProps) {
  const [rate, setRate] = useState<number>(6);
  const [session, setSession] = useState<{ startMs: number; startS: number } | null>(null);
  const points = useRef<HeartPoint[]>([]);
  useTick(session !== null, 1000);

  useBeats(monitor, session !== null, (beat) => {
    const hr = heartRateOf(beat);
    if (hr !== null) points.current.push({ timeS: beat.timeS, hr });
  });

  useEffect(() => {
    if (!monitor) setSession(null);
  }, [monitor]);

  const start = () => {
    if (!monitor) return;
    points.current = [];
    setSession({ startMs: performance.now(), startS: monitor.timeS });
  };

  const nowS = monitor?.timeS ?? 0;
  const metrics = session ? breathingMetrics(points.current, session.startS, nowS, rate) : null;
  const lastHr = points.current.length > 0 ? points.current[points.current.length - 1].hr : null;

  // Se recalcula en cada redibujado (una vez por segundo).
  const chart = ((): ChartOptions | null => {
    if (!session) return null;
    const from = Math.max(session.startS, nowS - CHART_SECONDS);
    const shown = points.current.filter((p) => p.timeS >= from);
    const hrs = shown.map((p) => p.hr);
    const lo = hrs.length > 0 ? Math.min(...hrs) : 60;
    const hi = hrs.length > 0 ? Math.max(...hrs) : 80;
    const span = Math.max(10, hi - lo);
    const mid = (lo + hi) / 2;
    // Guía del ritmo respiratorio dibujada detrás, a escala de la FC.
    const guide = [];
    for (let t = from; t <= nowS; t += 0.25) {
      guide.push({ x: t - from, y: mid + (span / 2) * (pacerLevel(pacerPhase(t - session.startS, rate)) * 2 - 1) });
    }
    return {
      theme: 'screen',
      x: [0, CHART_SECONDS],
      y: [mid - span * 0.7, mid + span * 0.7],
      xLabel: (x) => `${Math.round(x)} s`,
      yLabel: (y) => `${Math.round(y)}`,
      note: 'FC (lpm) y guía de respiración',
      series: [
        { points: guide, color: 'rgba(108, 196, 255, 0.35)', width: 6 },
        { points: shown.map((p) => ({ x: p.timeS - from, y: p.hr })), color: '#4fe08a', width: 2 },
      ],
    };
  })();

  return (
    <div className="tool">
      <header className="tool-head">
        <div>
          <h2>Respiración guiada</h2>
          <p className="muted">
            Sigue el círculo: inhala mientras crece y exhala mientras se encoge, sin forzar. Respirando despacio y a ritmo
            constante, tu frecuencia cardiaca empieza a subir y bajar con cada respiración. Cuanto más amplia y regular es esa
            ola, más alta la coherencia.
          </p>
        </div>
      </header>

      {!monitor ? (
        <NeedsSignal {...rest} />
      ) : (
        <>
          <div className="tool-controls">
            <div className="segmented" role="radiogroup" aria-label="Ritmo">
              <span className="segmented-label">Ritmo</span>
              {PACER_RATES.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={r === rate} onClick={() => setRate(r)}>
                  {rateFormat.format(r)}
                </button>
              ))}
              <span className="muted">resp./min</span>
            </div>
            <div className="spacer" />
            {session ? (
              <button type="button" className="button" onClick={() => setSession(null)}>
                Terminar
              </button>
            ) : (
              <button type="button" className="button button-primary" onClick={start}>
                Empezar
              </button>
            )}
          </div>

          <section className="tool-screen breathing">
            {session ? (
              <Pacer rate={rate} startMs={session.startMs} />
            ) : (
              <div className="pacer pacer-idle">
                <span className="pacer-label">6 respiraciones por minuto le funcionan a la mayoría</span>
              </div>
            )}
            <div className="breathing-side">
              <dl className="tool-metrics">
                <div>
                  <dt>FC</dt>
                  <dd>{round(lastHr)}</dd>
                </div>
                <div>
                  <dt title="Diferencia media entre la FC más alta y más baja de cada respiración">Oscilación</dt>
                  <dd>{metrics?.oscillationBpm == null ? '–' : `${round(metrics.oscillationBpm)} lpm`}</dd>
                </div>
                <div>
                  <dt title="Parte de la variación de la FC que sigue el ritmo marcado">Coherencia</dt>
                  <dd>
                    {metrics?.coherence == null ? '–' : `${percent.format(metrics.coherence)} (${coherenceWord(metrics.coherence)})`}
                  </dd>
                </div>
                <div>
                  <dt>Tiempo</dt>
                  <dd>{session ? formatClock(nowS - session.startS) : '–'}</dd>
                </div>
              </dl>
              {chart ? (
                <ChartCanvas options={chart} label="Frecuencia cardiaca y guía de respiración" height={240} />
              ) : (
                <p className="panel-empty">Pulsa Empezar. La coherencia aparece tras unos 30 segundos.</p>
              )}
            </div>
          </section>
          <p className="hint">
            Si te mareas, vuelve a respirar normal. Para notar el efecto, practica unos 5 minutos sentado y con el dedo quieto
            sobre el sensor.
          </p>
        </>
      )}
    </div>
  );
}
