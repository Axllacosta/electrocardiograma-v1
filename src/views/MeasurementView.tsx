import { useCallback, useEffect, useRef, useState } from 'react';
import { MEASUREMENT_DURATIONS, MeasurementSession, type MeasurementResult } from '../analysis/measurement.ts';
import type { ChartOptions } from '../chart.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { QualityBadge } from '../components/QualityBadge.tsx';
import { formatDate, round } from '../format.ts';
import { deleteSession, listSessions, saveSession } from '../store/sessions.ts';
import { formatClock, NeedsSignal, useBeats, useTick, type ToolProps } from './shared.tsx';

// Si el dedo falta más que esto, la medición se cancela.
const MAX_GAP_S = 10;

function Results({ r }: { r: MeasurementResult }) {
  return (
    <dl className="summary">
      <div>
        <dt>FC media</dt>
        <dd>{round(r.hrMean)} lpm</dd>
      </div>
      <div>
        <dt>RMSSD</dt>
        <dd>{round(r.rmssd)} ms</dd>
      </div>
      <div>
        <dt>SDNN</dt>
        <dd>{round(r.sdnn)} ms</dd>
      </div>
      <div>
        <dt>SpO2 estimada</dt>
        <dd>{round(r.spo2Mean)} %</dd>
      </div>
      <div>
        <dt>Respiración</dt>
        <dd>{round(r.breathsPerMin)} rpm</dd>
      </div>
      <div>
        <dt>Latidos con señal buena</dt>
        <dd>{round(r.goodPct)} %</dd>
      </div>
    </dl>
  );
}

function Trend({ history }: { history: MeasurementResult[] }) {
  const ordered = [...history].reverse().filter((r) => r.rmssd !== null || r.hrMean !== null);
  if (ordered.length < 2) return <p className="hint">Con dos mediciones o más verás aquí la evolución.</p>;
  const day = 86400000;
  const t0 = ordered[0].startedAt;
  const days = (r: MeasurementResult) => (r.startedAt - t0) / day;
  const span = Math.max(1, days(ordered[ordered.length - 1]));
  const dateLabel = (x: number) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(t0 + x * day);
  const rmssd: ChartOptions = {
    theme: 'paper',
    x: [-span * 0.03, span * 1.03],
    xLabel: dateLabel,
    note: 'RMSSD (ms): más alto suele indicar mejor recuperación',
    series: [
      { points: ordered.filter((r) => r.rmssd !== null).map((r) => ({ x: days(r), y: r.rmssd! })), color: '#1f7a4a' },
      { points: ordered.filter((r) => r.rmssd !== null).map((r) => ({ x: days(r), y: r.rmssd! })), color: '#1f7a4a', dots: true, dotSize: 3.5 },
    ],
  };
  const hr: ChartOptions = {
    theme: 'paper',
    x: rmssd.x,
    xLabel: dateLabel,
    note: 'FC en reposo (lpm)',
    series: [
      { points: ordered.filter((r) => r.hrMean !== null).map((r) => ({ x: days(r), y: r.hrMean! })), color: '#b42318' },
      { points: ordered.filter((r) => r.hrMean !== null).map((r) => ({ x: days(r), y: r.hrMean! })), color: '#b42318', dots: true, dotSize: 3.5 },
    ],
  };
  return (
    <div className="hrv-charts">
      <figure>
        <figcaption>Variabilidad</figcaption>
        <ChartCanvas options={rmssd} label="Evolución del RMSSD" height={200} />
      </figure>
      <figure>
        <figcaption>Frecuencia cardiaca</figcaption>
        <ChartCanvas options={hr} label="Evolución de la frecuencia cardiaca en reposo" height={200} />
      </figure>
    </div>
  );
}

export function MeasurementView({ monitor, ...rest }: ToolProps) {
  const [minutes, setMinutes] = useState<number>(5);
  const [session, setSession] = useState<MeasurementSession | null>(null);
  const [result, setResult] = useState<MeasurementResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<MeasurementResult[]>([]);
  const lastSignal = useRef(0);
  useTick(session !== null || monitor !== null, 500);

  const refresh = useCallback(() => {
    listSessions('measurement').then(setHistory, () => setHistory([]));
  }, []);
  useEffect(refresh, [refresh]);

  useBeats(monitor, session !== null, (beat) => session?.addBeat(beat));
  useEffect(() => {
    if (!monitor || !session) return;
    return monitor.subscribe({ onSpo2: (v) => session.addSpo2(v) });
  }, [monitor, session]);

  const snap = monitor?.snapshot() ?? null;
  const nowS = monitor?.timeS ?? 0;
  const ready = snap !== null && snap.heartRate !== null;

  // Comprobaciones del progreso, en cada redibujado.
  useEffect(() => {
    if (!session) return;
    if (!monitor) {
      setSession(null);
      setMessage('Se perdió la conexión: la medición se canceló.');
      return;
    }
    if (snap && !snap.noFinger) lastSignal.current = nowS;
    if (nowS - lastSignal.current > MAX_GAP_S) {
      setSession(null);
      setMessage('Quitaste el dedo del sensor demasiado tiempo: la medición se canceló.');
      return;
    }
    if (session.done(nowS)) {
      const r = session.result(crypto.randomUUID());
      setSession(null);
      setResult(r);
      saveSession(r).then(refresh, () => setMessage('No se pudo guardar el resultado en el navegador.'));
    }
  });

  const start = () => {
    if (!monitor) return;
    setResult(null);
    setMessage(null);
    lastSignal.current = monitor.timeS;
    setSession(new MeasurementSession(minutes * 60, monitor.timeS));
  };

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar esta medición? No se puede deshacer.')) return;
    await deleteSession(id);
    refresh();
  };

  const progress = session ? Math.min(1, session.elapsed(nowS) / session.durationS) : 0;

  return (
    <div className="tool">
      <header className="tool-head">
        <div>
          <h2>Medición en reposo</h2>
          <p className="muted">
            Un resumen comparable de un día a otro: frecuencia en reposo, variabilidad, SpO2 y respiración. Para que las
            mediciones se puedan comparar, hazlas en las mismas condiciones, por ejemplo por la mañana, sentado, tras un par
            de minutos de calma y respirando normal.
          </p>
        </div>
      </header>

      {!monitor && !session ? (
        <NeedsSignal {...rest} />
      ) : (
        <>
          <div className="tool-controls">
            <div className="segmented" role="radiogroup" aria-label="Duración">
              <span className="segmented-label">Duración</span>
              {MEASUREMENT_DURATIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={m === minutes}
                  disabled={session !== null}
                  onClick={() => setMinutes(m)}
                >
                  {m}
                </button>
              ))}
              <span className="muted">min</span>
            </div>
            <div className="spacer" />
            {session ? (
              <button type="button" className="button" onClick={() => setSession(null)}>
                Cancelar
              </button>
            ) : (
              <button type="button" className="button button-primary" disabled={!ready} onClick={start}>
                Empezar medición
              </button>
            )}
          </div>
          {!session && !ready && <p className="hint">Apoya el dedo y espera a que aparezca tu frecuencia cardiaca.</p>}

          {session && (
            <section className="tool-screen measuring">
              <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${progress * 100}%` }} />
              </div>
              <dl className="tool-metrics">
                <div>
                  <dt>Quedan</dt>
                  <dd>{formatClock(session.durationS - session.elapsed(nowS))}</dd>
                </div>
                <div>
                  <dt>FC</dt>
                  <dd>{round(snap?.heartRate ?? null)}</dd>
                </div>
                <div>
                  <dt>SpO2 est.</dt>
                  <dd>{round(snap?.spo2 ?? null)}</dd>
                </div>
                <div>
                  <dt>Señal</dt>
                  <dd>
                    <QualityBadge level={snap?.quality ?? null} />
                  </dd>
                </div>
                <div>
                  <dt>Latidos</dt>
                  <dd>{session.beatCount}</dd>
                </div>
              </dl>
              <p className="panel-empty">Quédate quieto y respira normal. Los latidos con mala señal no cuentan para la variabilidad.</p>
            </section>
          )}
        </>
      )}

      {message && <p className="notice">{message}</p>}

      {result && (
        <section className="result">
          <h3>Resultado</h3>
          <Results r={result} />
          {result.goodPct < 70 && (
            <p className="hint">Menos del 70 % de los latidos tuvo buena señal: repite la medición con el dedo más quieto.</p>
          )}
        </section>
      )}

      <section className="history">
        <h3>Historial</h3>
        <Trend history={history} />
        {history.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col" className="num">Duración</th>
                  <th scope="col" className="num">FC</th>
                  <th scope="col" className="num">RMSSD</th>
                  <th scope="col" className="num">SDNN</th>
                  <th scope="col" className="num">SpO2 est.</th>
                  <th scope="col" className="num">Resp.</th>
                  <th scope="col" className="num">Señal buena</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.startedAt)}</td>
                    <td className="num">{r.durationS / 60} min</td>
                    <td className="num">{round(r.hrMean)} lpm</td>
                    <td className="num">{round(r.rmssd)} ms</td>
                    <td className="num">{round(r.sdnn)} ms</td>
                    <td className="num">{round(r.spo2Mean)} %</td>
                    <td className="num">{round(r.breathsPerMin)} rpm</td>
                    <td className="num">{round(r.goodPct)} %</td>
                    <td className="num">
                      <button type="button" className="link" onClick={() => void remove(r.id)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">Todavía no hay mediciones guardadas.</p>
        )}
      </section>
    </div>
  );
}
