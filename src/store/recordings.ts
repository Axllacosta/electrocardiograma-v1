import type { RecordingData, RecordingStats } from '../monitor.ts';
import { db, done, META, request, SIGNAL } from './db.ts';

// Los registros se guardan en IndexedDB, en dos almacenes: los metadatos para
// listar rápido y las muestras aparte, que solo se cargan al abrir uno.

export interface RecordingMeta {
  id: string;
  label: string;
  startedAt: number;
  fs: number;
  bits: number;
  // Falta en los registros de la versión anterior, que era de ECG con AD8232.
  sensor?: string;
  stats: RecordingStats;
}

export interface RecordingSignal {
  id: string;
  samples: Int32Array | Int16Array;
  // Faltan en registros de versiones anteriores.
  red?: Int32Array;
  rr?: Float32Array;
  beats: Uint32Array;
}

export async function saveRecording(data: RecordingData, label: string): Promise<RecordingMeta> {
  const meta: RecordingMeta = {
    id: crypto.randomUUID(),
    label,
    startedAt: data.startedAt,
    fs: data.fs,
    bits: data.bits,
    sensor: data.sensor,
    stats: data.stats,
  };
  const tx = (await db()).transaction([META, SIGNAL], 'readwrite');
  tx.objectStore(META).put(meta);
  tx.objectStore(SIGNAL).put({
    id: meta.id,
    samples: data.samples,
    red: data.red,
    rr: data.rr,
    beats: data.beats,
  } satisfies RecordingSignal);
  await done(tx);
  return meta;
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const tx = (await db()).transaction(META, 'readonly');
  const all = await request(tx.objectStore(META).getAll() as IDBRequest<RecordingMeta[]>);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function loadSignal(id: string): Promise<RecordingSignal> {
  const tx = (await db()).transaction(SIGNAL, 'readonly');
  const signal = await request(tx.objectStore(SIGNAL).get(id) as IDBRequest<RecordingSignal | undefined>);
  if (!signal) throw new Error('No se encontraron las muestras de este registro.');
  return signal;
}

export async function renameRecording(meta: RecordingMeta, label: string): Promise<RecordingMeta> {
  const updated = { ...meta, label };
  const tx = (await db()).transaction(META, 'readwrite');
  tx.objectStore(META).put(updated);
  await done(tx);
  return updated;
}

export async function deleteRecording(id: string) {
  const tx = (await db()).transaction([META, SIGNAL], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(SIGNAL).delete(id);
  await done(tx);
}
