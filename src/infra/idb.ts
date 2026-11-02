// Typed IndexedDB wrapper. Database `nexus-pog` v1: projects, catalog, assets, kv. Fails soft (returns null / false)
// when IndexedDB is unavailable so the app still runs (unsaved) in restricted browsers.

const DB_NAME = 'nexus-pog', DB_VER = 1;
export type StoreName = 'projects' | 'catalog' | 'assets' | 'kv';
let dbp: Promise<IDBDatabase | null> | null = null;

export function openDB(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['projects', 'catalog', 'assets', 'kv']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
      r.onerror = () => res(null);
      r.onblocked = () => console.warn('[DB] upgrade blocked — close other tabs');
    } catch { res(null); }
  });
  return dbp;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | null> {
  const d = await openDB();
  if (!d) return null;
  return new Promise((res) => { try { const q = d.transaction(store).objectStore(store).get(key); q.onsuccess = () => res((q.result as T) ?? null); q.onerror = () => res(null); } catch { res(null); } });
}

export async function idbSet(store: StoreName, key: string, val: unknown): Promise<boolean> {
  const d = await openDB();
  if (!d) return false;
  return new Promise((res, rej) => { try { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); } catch (e) { rej(e); } });
}

export async function idbDel(store: StoreName, key: string): Promise<boolean> {
  const d = await openDB();
  if (!d) return false;
  return new Promise((res) => { try { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch { res(false); } });
}

export async function idbAll<T>(store: StoreName): Promise<[string, T][]> {
  const d = await openDB();
  if (!d) return [];
  return new Promise((res) => {
    try {
      const out: [string, T][] = [], q = d.transaction(store).objectStore(store).openCursor();
      q.onsuccess = () => { const c = q.result; if (c) { out.push([String(c.key), c.value as T]); c.continue(); } else res(out); };
      q.onerror = () => res(out);
    } catch { res([]); }
  });
}
