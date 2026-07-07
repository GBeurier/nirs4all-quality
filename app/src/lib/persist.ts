// Local persistence via IndexedDB — works fully in-browser / offline (and in the
// WASM single-file build). Stores the whole LabState under one key; IndexedDB's
// structured clone preserves the spectra Float64Arrays (unlike JSON). All calls
// fail-soft (no IndexedDB → the app just runs from the in-memory demo state).

const DB_NAME = 'quali-nirs4all';
const STORE = 'state';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(state: unknown): Promise<void> {
  try {
    const db = await openDb();
    await run(db, 'readwrite', (s) => s.put(state, KEY));
    db.close();
  } catch (e) {
    // not silent: a large upload can exceed the IndexedDB clone/quota — surface it
    console.warn('[quali-nirs4all] persistence failed (dataset too large for the browser?)', e);
  }
}

export async function loadState<T>(): Promise<T | null> {
  try {
    const db = await openDb();
    const value = await run<T | undefined>(db, 'readonly', (s) => s.get(KEY));
    db.close();
    return value ?? null;
  } catch {
    return null;
  }
}

export async function clearState(): Promise<void> {
  try {
    const db = await openDb();
    await run(db, 'readwrite', (s) => s.delete(KEY));
    db.close();
  } catch { /* fail-soft */ }
}
