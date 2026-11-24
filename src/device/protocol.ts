// Formato de línea del firmware en arduino/cardio_monitor.

export interface DeviceInfo {
  version: number;
  sensor: string;
  fs: number;
  bits: number;
}

export interface Sample {
  seq: number;
  adc: number | null; // luz infrarroja; null: no hay dedo sobre el sensor
  red?: number; // luz roja, para la SpO2
}

export type HeaderLine = { kind: 'info'; info: DeviceInfo } | { kind: 'error'; version: number; error: string };

const HEADER = /^#cardio-monitor v(\d+)((?: [a-z]+=[\w.-]+)*)$/;
const SAMPLE = /^(\d{1,3}),(?:(\d{1,7}),(\d{1,7})|L)$/;

export const SUPPORTED_VERSION = 3;

export function parseHeader(line: string): HeaderLine | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  const version = Number(m[1]);
  const fields = new Map<string, string>();
  for (const pair of m[2].trim().split(' ')) {
    if (!pair) continue;
    const [key, value] = pair.split('=');
    fields.set(key, value);
  }
  const error = fields.get('error');
  if (error) return { kind: 'error', version, error };

  const fs = Number(fields.get('fs'));
  const bits = Number(fields.get('bits'));
  if (!(fs > 0) || !(bits > 0 && bits <= 24)) return null;
  // La versión 1 del firmware era para el AD8232 y no indicaba el sensor.
  const sensor = fields.get('sensor') ?? (version === 1 ? 'ad8232' : 'desconocido');
  return { kind: 'info', info: { version, sensor, fs, bits } };
}

export function parseSample(line: string, bits: number): Sample | null {
  const m = SAMPLE.exec(line);
  if (!m) return null;
  const seq = Number(m[1]);
  if (seq > 255) return null;
  if (m[2] === undefined) return { seq, adc: null };
  const adc = Number(m[2]);
  const red = Number(m[3]);
  if (adc >= 2 ** bits || red >= 2 ** bits) return null;
  return { seq, adc, red };
}
