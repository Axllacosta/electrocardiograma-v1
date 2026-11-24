import type { MeasurementResult } from '../analysis/measurement.ts';
import type { RecoveryResult } from '../analysis/recovery.ts';
import { db, done, request, SESSIONS } from './db.ts';

export type SessionResult = MeasurementResult | RecoveryResult;

export async function saveSession(result: SessionResult) {
  const tx = (await db()).transaction(SESSIONS, 'readwrite');
  tx.objectStore(SESSIONS).put(result);
  await done(tx);
}

export async function listSessions<K extends SessionResult['kind']>(kind: K): Promise<Extract<SessionResult, { kind: K }>[]> {
  const tx = (await db()).transaction(SESSIONS, 'readonly');
  const all = await request(tx.objectStore(SESSIONS).getAll() as IDBRequest<SessionResult[]>);
  return all
    .filter((s): s is Extract<SessionResult, { kind: K }> => s.kind === kind)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteSession(id: string) {
  const tx = (await db()).transaction(SESSIONS, 'readwrite');
  tx.objectStore(SESSIONS).delete(id);
  await done(tx);
}
