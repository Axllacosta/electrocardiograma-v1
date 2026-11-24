import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, formatDuration, round } from '../format.ts';
import type { Scale } from '../render.ts';
import type { Settings } from '../settings.ts';
import { describeProcessing } from '../dsp/ppg.ts';
import { download, filterRecording, isPulseRecording, recordingCsv, sensorName } from '../signal.ts';
import {
  deleteRecording,
  listRecordings,
  loadSignal,
  renameRecording,
  type RecordingMeta,
  type RecordingSignal,
} from '../store/recordings.ts';
import { HrvCharts, type Interval } from './HrvCharts.tsx';
import { Strip } from './Strip.tsx';

interface Props {
  settings: Settings;
  version: number;
}

export function Recordings({ settings, version }: Props) {
  const [list, setList] = useState<RecordingMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecordingMeta | null>(null);

  const refresh = useCallback(() => {
    listRecordings().then(setList, (err: Error) => setError(err.message));
  }, []);

  useEffect(refresh, [refresh, version]);

  if (selected) {
    return (
      <RecordingDetail
        meta={selected}
        settings={settings}
        onBack={() => {
          setSelected(null);
          refresh();
        }}
        onRenamed={setSelected}
      />
    );
  }

  if (error) return <p className="notice">No se pudieron leer los registros: {error}</p>;
  if (!list) return null;
  if (list.length === 0) {
    return (
      <div className="empty">
        <h2>Todavía no hay registros</h2>
        <p>Pulsa Grabar en el monitor para guardar un tramo de pulso. Los registros se guardan en este navegador.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Registro</th>
            <th scope="col">Inicio</th>
            <th scope="col" className="num">Duración</th>
            <th scope="col" className="num">FC media</th>
            <th scope="col" className="num">Latidos</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="link" onClick={() => setSelected(r)}>
                  {r.label}
                </button>
              </td>
              <td>{formatDate(r.startedAt)}</td>
              <td className="num">{formatDuration(r.stats.durationS)}</td>
              <td className="num">{round(r.stats.hrMean)} lpm</td>
              <td className="num">{r.stats.beats}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DetailProps {
  meta: RecordingMeta;
  settings: Settings;
  onBack(): void;
  onRenamed(meta: RecordingMeta): void;
}

function RecordingDetail({ meta, settings, onBack, onRenamed }: DetailProps) {
  const [signal, setSignal] = useState<RecordingSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState(meta.label);
  const [start, setStart] = useState(0);
  const [windowSamples, setWindowSamples] = useState(1);

  useEffect(() => {
    loadSignal(meta.id).then(setSignal, (err: Error) => setError(err.message));
  }, [meta.id]);

  const compatible = isPulseRecording(meta);

  const pulse = useMemo(
    () => (signal && compatible ? filterRecording(meta, signal.samples) : null),
    [signal, meta, compatible],
  );

  // Intervalos entre latidos: guardados en los registros nuevos, o calculados
  // a partir de las marcas de latido en los anteriores.
  const intervals = useMemo<Interval[]>(() => {
    if (!signal || !compatible) return [];
    const b = signal.beats;
    if (signal.rr && signal.rr.length === b.length - 1) {
      return Array.from(signal.rr, (rr, i) => ({ timeS: b[i + 1] / meta.fs, rrMs: rr }));
    }
    return Array.from(b.slice(1), (v, i) => ({ timeS: v / meta.fs, rrMs: ((v - b[i]) * 1000) / meta.fs }));
  }, [signal, compatible, meta.fs]);

  const scale: Scale = useMemo(
    () => ({ pxPerMm: settings.pxPerMm, speedMmS: settings.speedMmS }),
    [settings.pxPerMm, settings.speedMmS],
  );

  const maxStart = pulse ? Math.max(0, pulse.length - windowSamples) : 0;
  const position = Math.min(start, maxStart);

  const saveLabel = async () => {
    const trimmed = label.trim();
    if (!trimmed || trimmed === meta.label) {
      setLabel(meta.label);
      return;
    }
    onRenamed(await renameRecording(meta, trimmed));
  };

  const remove = async () => {
    if (!window.confirm(`¿Eliminar «${meta.label}»? No se puede deshacer.`)) return;
    await deleteRecording(meta.id);
    onBack();
  };

  const exportCsv = () => {
    if (!signal || !compatible) return;
    const stamp = new Date(meta.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    download(recordingCsv(meta, signal), `pulso-${stamp}.csv`);
  };

  const s = meta.stats;

  return (
    <div className="detail">
      <div className="detail-head">
        <button type="button" className="button" onClick={onBack}>
          Volver a registros
        </button>
        <input
          className="title-input"
          aria-label="Nombre del registro"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => void saveLabel()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <div className="detail-actions">
          <button type="button" className="button" onClick={exportCsv} disabled={!signal || !compatible}>
            Exportar CSV
          </button>
          <button type="button" className="button button-danger" onClick={() => void remove()}>
            Eliminar
          </button>
        </div>
      </div>

      <dl className="summary">
        <div>
          <dt>Inicio</dt>
          <dd>{formatDate(meta.startedAt)}</dd>
        </div>
        <div>
          <dt>Duración</dt>
          <dd>{formatDuration(s.durationS)}</dd>
        </div>
        <div>
          <dt>FC media</dt>
          <dd>{round(s.hrMean)} lpm</dd>
        </div>
        <div>
          <dt>FC mín. y máx.</dt>
          <dd>
            {round(s.hrMin)} / {round(s.hrMax)} lpm
          </dd>
        </div>
        <div>
          <dt>Latidos</dt>
          <dd>{s.beats}</dd>
        </div>
        <div>
          <dt>SDNN</dt>
          <dd>{round(s.sdnn)} ms</dd>
        </div>
        <div>
          <dt>RMSSD</dt>
          <dd>{round(s.rmssd)} ms</dd>
        </div>
        {s.spo2Mean !== undefined && (
          <div>
            <dt>SpO2 estimada</dt>
            <dd>{round(s.spo2Mean)} %</dd>
          </div>
        )}
        {s.breathsPerMin !== undefined && (
          <div>
            <dt>Respiración</dt>
            <dd>{round(s.breathsPerMin)} rpm</dd>
          </div>
        )}
      </dl>

      {error && <p className="notice">No se pudo abrir el registro: {error}</p>}
      {!compatible && (
        <p className="notice">
          Este registro se grabó con la versión anterior, de ECG con el módulo AD8232, y no se puede mostrar como pulso.
          Sus datos resumidos siguen siendo válidos.
        </p>
      )}

      {pulse && signal && (
        <>
          <Strip
            pulse={pulse}
            beats={signal.beats}
            fs={meta.fs}
            start={position}
            scale={scale}
            onWindowChange={setWindowSamples}
          />
          <div className="scrubber">
            <input
              type="range"
              aria-label="Posición en el registro"
              min={0}
              max={maxStart}
              step={Math.max(1, Math.round(meta.fs / 5))}
              value={position}
              disabled={maxStart === 0}
              onChange={(e) => setStart(Number(e.target.value))}
            />
            <span className="muted">
              {formatDuration(position / meta.fs)} de {formatDuration(pulse.length / meta.fs)}
            </span>
          </div>
          <p className="hint">
            {sensorName(meta.sensor)} a {meta.fs} Hz, {describeProcessing()}, escala automática. Las marcas superiores indican los
            latidos detectados.
          </p>
          <h3 className="section-title">Variabilidad</h3>
          <HrvCharts intervals={intervals} theme="paper" />
        </>
      )}
    </div>
  );
}
