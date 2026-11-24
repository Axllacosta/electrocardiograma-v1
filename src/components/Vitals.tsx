import { round } from '../format.ts';
import type { Snapshot } from '../monitor.ts';
import { QualityBadge } from './QualityBadge.tsx';

const decimal = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Unit({ value, unit, format = round }: { value: number | null; unit: string; format?: (v: number | null) => string }) {
  if (value === null) return <>–</>;
  return (
    <>
      {format(value)} <span className="muted">{unit}</span>
    </>
  );
}

interface Props {
  snap: Snapshot | null;
  hrLow: number;
  hrHigh: number;
  hrAlarm: boolean;
}

export function Vitals({ snap, hrLow, hrHigh, hrAlarm }: Props) {
  const hr = snap?.heartRate ?? null;
  const spo2 = snap?.spo2 ?? null;
  return (
    <aside className="vitals" aria-label="Parámetros">
      <div className={hrAlarm ? 'hr hr-alarm' : 'hr'}>
        <div className="hr-head">
          <span>FC</span>
          <span className="muted">lpm</span>
        </div>
        <output className="hr-value" aria-live="off">
          {round(hr)}
        </output>
        <div className="hr-limits muted">
          {hrLow}–{hrHigh}
        </div>
      </div>

      <div className="spo2" title="Estimación sin calibrar contra un oxímetro clínico: orientativa.">
        <div className="hr-head">
          <span>SpO2</span>
          <span className="muted">% estimada</span>
        </div>
        <output className="spo2-value" aria-live="off">
          {round(spo2)}
        </output>
      </div>

      <dl className="readings">
        <div>
          <dt>Señal</dt>
          <dd>
            <QualityBadge level={snap?.quality ?? null} />
          </dd>
        </div>
        <div>
          <dt title="Respiraciones por minuto, estimadas a partir del pulso">Respiración</dt>
          <dd>
            <Unit value={snap?.breathsPerMin ?? null} unit="rpm" />
          </dd>
        </div>
        <div>
          <dt>RR</dt>
          <dd>
            <Unit value={snap?.lastRrMs ?? null} unit="ms" />
          </dd>
        </div>
        <div>
          <dt>SDNN</dt>
          <dd>
            <Unit value={snap?.sdnn ?? null} unit="ms" />
          </dd>
        </div>
        <div>
          <dt>RMSSD</dt>
          <dd>
            <Unit value={snap?.rmssd ?? null} unit="ms" />
          </dd>
        </div>
        <div>
          <dt title="Índice de perfusión: amplitud del pulso en % de la luz recibida">IP</dt>
          <dd>
            <Unit value={snap?.perfusion ?? null} unit="%" format={(v) => decimal.format(v!)} />
          </dd>
        </div>
        <div>
          <dt>FC mín. y máx.</dt>
          <dd>
            {round(snap?.minHr ?? null)} / {round(snap?.maxHr ?? null)}
          </dd>
        </div>
        <div>
          <dt>Latidos</dt>
          <dd>{snap?.beats ?? '–'}</dd>
        </div>
      </dl>
    </aside>
  );
}
