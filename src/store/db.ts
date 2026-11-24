// Base de datos del navegador (IndexedDB) con tres almacenes: metadatos de
// las grabaciones, sus muestras (aparte, porque pesan) y los resultados de
// las mediciones y pruebas de recuperación.

export const META = 'recordings';
export const SIGNAL = 'signals';
export const SESSIONS = 'sessions';

const DB_NAME = 'cardio-monitor';
const VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

export function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(META)) req.result.createObjectStore(META, { keyPath: 'id' });
      if (!names.contains(SIGNAL)) req.result.createObjectStore(SIGNAL, { keyPath: 'id' });
      if (!names.contains(SESSIONS)) req.result.createObjectStore(SESSIONS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
