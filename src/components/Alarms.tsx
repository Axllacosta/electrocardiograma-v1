import type { Snapshot } from '../monitor.ts';
import { round } from '../format.ts';

// Colores según IEC 60601-1-8: rojo prioridad alta, amarillo media,
// cian para avisos técnicos del equipo.
export type AlarmLevel = 'high' | 'medium' | 'technical';

export interface Alarm {
  id: string;
  level: AlarmLevel;
  text: string;
}

export function activeAlarms(snap: Snapshot, hrLow: number, hrHigh: number): Alarm[] {
  const alarms: Alarm[] = [];
  if (snap.noPulse) alarms.push({ id: 'nopulse', level: 'high', text: 'No se detecta pulso desde hace más de 5 s' });
  const hr = snap.heartRate;
  if (hr !== null && hr > hrHigh) alarms.push({ id: 'hrhigh', level: 'medium', text: `FC alta: ${round(hr)} lpm` });
  if (hr !== null && hr < hrLow) alarms.push({ id: 'hrlow', level: 'medium', text: `FC baja: ${round(hr)} lpm` });
  if (snap.spo2 !== null && snap.spo2 < 90) {
    alarms.push({ id: 'spo2', level: 'medium', text: `SpO2 estimada baja: ${round(snap.spo2)} %. Revisa la colocación del dedo` });
  }
  if (snap.quality === 'poor') {
    alarms.push({ id: 'quality', level: 'technical', text: 'Señal de mala calidad: deja el dedo quieto y sin apretar' });
  }
  if (snap.noFinger) alarms.push({ id: 'finger', level: 'technical', text: 'Apoya el dedo sobre el sensor' });
  if (snap.clipped) {
    alarms.push({ id: 'clip', level: 'technical', text: 'Señal saturada: tapa el sensor y el dedo de la luz ambiente' });
  }
  if (snap.droppedRecently) {
    alarms.push({ id: 'drop', level: 'technical', text: 'Se están perdiendo muestras del puerto serie' });
  }
  return alarms;
}

export function AlarmBar({ alarms }: { alarms: Alarm[] }) {
  if (alarms.length === 0) return null;
  return (
    <ul className="alarms" role="alert">
      {alarms.map((a) => (
        <li key={a.id} className={`alarm alarm-${a.level}`}>
          {a.text}
        </li>
      ))}
    </ul>
  );
}
