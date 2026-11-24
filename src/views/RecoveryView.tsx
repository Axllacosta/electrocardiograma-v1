import { useCallback, useEffect, useRef, useState } from 'react';
import { RECOVERY_S, RecoveryTest, type RecoveryResult } from '../analysis/recovery.ts';
import type { ChartOptions } from '../chart.ts';
import { ChartCanvas } from '../components/ChartCanvas.tsx';
import { formatDate, round } from '../format.ts';
import { deleteSession, listSessions, saveSession } from '../store/sessions.ts';
import { formatClock, heartRateOf, NeedsSignal, useBeats, useTick, type ToolProps } from './shared.tsx';

function interpretation(drop: number): string {
  if (drop >= 25) return 'Bajada amplia: tu corazón se recupera rápido, algo típico de personas entrenadas.';
  if (drop >= 12) return 'Bajada dentro de lo habitual en adultos sanos.';
  return 'Bajada pequeña. Puede deberse a un esfuerzo corto o a que tardaste en apoyar el dedo; repite la prueba antes de sacar conclusiones.';
}

export function RecoveryView({ monitor, ...rest }: ToolProps) {
  const [test, setTest] = useState<RecoveryTest | null>(null);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<RecoveryResult[]>([]);
  const saved = useRef<string | null>(null);
  useTick(test !== null || monitor !== null, 500);

  const refresh = useCallback(() => {
    listSessions('recovery').then(setHistory, () => setHistory([]));
  }, []);
  useEffect(refresh, [refresh]);

  useBeats(monitor, test !== null, (beat) => {
    const hr = heartRateOf(beat);
    if (hr !== null) test?.addBeat({ timeS: beat.timeS, hr });
  });

  const nowS = monitor?.timeS ?? 0;
  const snap = monitor?.snapshot() ?? null;
  test?.update(nowS);

  useEffect(() => {
    if (!test) return;
    if (!monitor) {
      setTest(null);
      setMessage('Se perdió la conexión: la prueba se canceló.');
      return;
    }
    if (test.phase === 'done' && saved.current !== test.restStartS.toString()) {
      saved.current = test.restStartS.toString();
      const r = test.result(crypto.randomUUID());
      setTest(null);
      if (!r) {
        setMessage('No hubo suficientes latidos válidos en el minuto de recuperación. Repite la prueba con el dedo quieto.');
        return;
      }
      setResult(r);
      saveSession(r).then(refresh, () => setMessage('No se pudo guardar el resultado en el navegador.'));
    }
  });

  const start = () => {
    if (!monitor) return;
    setResult(null);
    setMessage(null);
    setTest(new RecoveryTest(monitor.timeS));
  };

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar esta prueba? No se puede deshacer.')) return;
    await deleteSession(id);
    refresh();
  };

  const ready = snap !== null && snap.heartRate !== null;

  const chart = ((): ChartOptions | null => {
    if (!test || test.phase !== 'recovery') return null;
    const points = test.heartPoints.filter((p) => p.timeS >= test.recoveryStartS);
    return {
      theme: 'screen',
      x: [0, RECOVERY_S],
      xLabel: (x) => `${Math.round(x)} s`,
      note: 'FC (lpm) desde que terminaste',
      series: [{ points: points.map((p) => ({ x: p.timeS - test.recoveryStartS, y: p.hr })), color: '#4fe08a', width: 2 }],
    };
  })();

  return (
    <div className="tool">
      <header className="tool-head">
        <div>
          <h2>Prueba de recuperación</h2>
          <p className="muted">
            Mide cuánto baja tu frecuencia cardiaca en el primer minuto después de un esfuerzo. Cuanto más baja, mejor se
            recupera el cuerpo. Es útil para seguir tu propia evolución si la repites siempre con el mismo ejercicio.
          </p>
        </div>
      </header>

      {!monitor && !test ? (
        <NeedsSignal {...rest} />
      ) : (
        <>
          {!test && (
            <div className="tool-controls">
              <ol className="steps">
                <li>Un minuto en reposo con el dedo en el sensor.</li>
                <li>Uno o dos minutos de ejercicio intenso: sentadillas, saltos o subir escaleras.</li>
                <li>Al terminar, apoya el dedo enseguida y quédate quieto un minuto.</li>
              </ol>
              <div className="spacer" />
              <button type="button" className="button button-primary" disabled={!ready} onClick={start}>
                Empezar prueba
              </button>
            </div>
          )}
          {!test && !ready && monitor && <p className="hint">Apoya el dedo y espera a que aparezca tu frecuencia cardiaca.</p>}

          {test && (
            <section className="tool-screen recovery">
              {test.phase === 'rest' && (
                <>
                  <h3>1. Reposo</h3>
                  <p>Quédate sentado y quieto con el dedo en el sensor.</p>
                  <dl className="tool-metrics">
                    <div>
                      <dt>Quedan</dt>
                      <dd>{formatClock(test.remaining(nowS))}</dd>
                    </div>
                    <div>
                      <dt>FC</dt>
                      <dd>{round(snap?.heartRate ?? null)}</dd>
                    </div>
                  </dl>
                </>
              )}
              {test.phase === 'exercise' && (
                <>
                  <h3>2. Ejercicio</h3>
                  <p>
                    Quita el dedo y haz uno o dos minutos de ejercicio intenso. En cuanto termines, apoya el dedo y pulsa el
                    botón: el minuto de recuperación empieza ahí.
                  </p>
                </>
              )}
              {test.phase === 'recovery' && (
                <>
                  <h3>3. Recuperación</h3>
                  <dl className="tool-metrics">
                    <div>
                      <dt>Quedan</dt>
                      <dd>{formatClock(test.remaining(nowS))}</dd>
                    </div>
                    <div>
                      <dt>FC</dt>
                      <dd>{round(snap?.heartRate ?? null)}</dd>
                    </div>
                  </dl>
                  {chart && <ChartCanvas options={chart} label="Frecuencia cardiaca durante la recuperación" height={220} />}
                </>
              )}
              <div className="help-actions">
                {test.phase === 'rest' && (
                  <button type="button" className="button button-ghost" onClick={() => test.skipRest()}>
                    Ya estaba en reposo: saltar
                  </button>
                )}
                {test.phase === 'exercise' && (
                  <button type="button" className="button button-primary" onClick={() => test.startRecovery(nowS)}>
                    Terminé, dedo apoyado
                  </button>
                )}
                <button type="button" className="button button-ghost" onClick={() => setTest(null)}>
                  Cancelar prueba
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {message && <p className="notice">{message}</p>}

      {result && (
        <section className="result">
          <h3>Resultado</h3>
          <dl className="summary">
            <div>
              <dt>FC en reposo</dt>
              <dd>{round(result.restHr)} lpm</dd>
            </div>
            <div>
              <dt>FC al terminar</dt>
              <dd>{round(result.peakHr)} lpm</dd>
            </div>
            <div>
              <dt>FC al minuto</dt>
              <dd>{round(result.hrAt60)} lpm</dd>
            </div>
            <div>
              <dt>Bajada en 1 minuto</dt>
              <dd>{round(result.drop)} lpm</dd>
            </div>
          </dl>
          <p className="hint">
            {interpretation(result.drop)} La referencia depende del esfuerzo y de si te quedas quieto; lo más útil es
            comparar tus propias pruebas.
          </p>
        </section>
      )}

      <section className="history">
        <h3>Historial</h3>
        {history.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col" className="num">Reposo</th>
                  <th scope="col" className="num">Al terminar</th>
                  <th scope="col" className="num">Al minuto</th>
                  <th scope="col" className="num">Bajada</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.startedAt)}</td>
                    <td className="num">{round(r.restHr)} lpm</td>
                    <td className="num">{round(r.peakHr)} lpm</td>
                    <td className="num">{round(r.hrAt60)} lpm</td>
                    <td className="num">{round(r.drop)} lpm</td>
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
          <p className="hint">Todavía no hay pruebas guardadas.</p>
        )}
      </section>
    </div>
  );
}
