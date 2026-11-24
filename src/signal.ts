import { describeProcessing, PpgFilter } from './dsp/ppg.ts';
import { DROPPED, NO_FINGER } from './monitor.ts';
import type { RecordingMeta, RecordingSignal } from './store/recordings.ts';

// Registros grabados con la versión anterior (ECG con AD8232) no se pueden
// interpretar como pulso óptico.
export function isPulseRecording(meta: RecordingMeta): boolean {
  return meta.sensor === 'max30100' || meta.sensor === 'max30102';
}

export function sensorName(sensor: string | undefined): string {
  return sensor ? sensor.toUpperCase() : 'Sensor';
}

// Convierte las lecturas crudas de un registro a pulso en % con el mismo
// filtro que el monitor. Los tramos sin señal quedan como NaN.
export function filterRecording(meta: RecordingMeta, samples: ArrayLike<number>): Float32Array {
  const out = new Float32Array(samples.length);
  let filter = new PpgFilter(meta.fs);
  let interrupted = true;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v < 0) {
      out[i] = NaN;
      interrupted = true;
      continue;
    }
    if (interrupted) {
      filter = new PpgFilter(meta.fs);
      filter.settle(v);
      interrupted = false;
    }
    out[i] = filter.process(v);
  }
  return out;
}

export function recordingCsv(meta: RecordingMeta, signal: RecordingSignal): Blob {
  const pulse = filterRecording(meta, signal.samples);
  const isBeat = new Uint8Array(signal.samples.length);
  for (const b of signal.beats) if (b < isBeat.length) isBeat[b] = 1;

  const parts: string[] = [
    '# El electrocardiograma\n',
    `# registro: ${meta.label.replace(/\n/g, ' ')}\n`,
    `# inicio: ${new Date(meta.startedAt).toISOString()}\n`,
    `# sensor: ${sensorName(meta.sensor)} (ir: luz infrarroja, rojo: luz roja)\n`,
    `# frecuencia_muestreo_hz: ${meta.fs}\n`,
    `# adc_bits: ${meta.bits}\n`,
    `# pulso_pct: componente pulsátil en % de la luz recibida, ${describeProcessing()}\n`,
    'tiempo_s,ir,rojo,pulso_pct,latido,estado\n',
  ];

  let block = '';
  for (let i = 0; i < signal.samples.length; i++) {
    const v = signal.samples[i];
    const t = (i / meta.fs).toFixed(3);
    const red = signal.red ? signal.red[i] : '';
    if (v === NO_FINGER) block += `${t},,,,0,sin_dedo\n`;
    else if (v === DROPPED) block += `${t},,,,0,perdida\n`;
    else block += `${t},${v},${red},${pulse[i].toFixed(4)},${isBeat[i]},ok\n`;
    if (block.length > 65536) {
      parts.push(block);
      block = '';
    }
  }
  parts.push(block);
  return new Blob(parts, { type: 'text/csv;charset=utf-8' });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
