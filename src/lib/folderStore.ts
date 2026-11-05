import type { FolderHandle } from './export';

/**
 * Remembers which folder holds a series' .cbz files, so the manga page can list them and merge them later.
 * Chrome and Edge let a page keep a folder handle in IndexedDB. After a browser restart the handle is still there but
 * needs one click to allow access again (no folder picker). Browsers never reveal the full path, only the folder name.
 */

const DB = 'mangadeck-folders';
const STORE = 'folders';
const MERGED_KEY = 'mangadeck.merged';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveFolder(mangaId: number, dir: FolderHandle): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(dir, String(mangaId)));
  } catch {
    /* private windows or blocked storage: the folder just is not remembered */
  }
}

export async function loadFolder(mangaId: number): Promise<FolderHandle | null> {
  try {
    return ((await run('readonly', (s) => s.get(String(mangaId)))) as FolderHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function forgetFolder(mangaId: number): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(String(mangaId)));
  } catch {
    /* ignore */
  }
}

/**
 * Can we read and write the folder? With `ask` this may show the browser's permission prompt, so it has to be called
 * straight from a click.
 */
export async function folderAccess(dir: FolderHandle, ask: boolean): Promise<boolean> {
  try {
    if (!dir.queryPermission) return true;
    if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    if (!ask || !dir.requestPermission) return false;
    return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

export interface FolderFile {
  name: string;
  size: number;
  file: File;
}

/** The .cbz files directly inside the folder (not its sub-folders). */
export async function listCbz(dir: FolderHandle): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  if (!dir.values) return out;
  for await (const h of dir.values()) {
    if (h.kind !== 'file' || !/\.cbz$/i.test(h.name) || !h.getFile) continue;
    try {
      const file = await h.getFile();
      out.push({ name: h.name, size: file.size, file });
    } catch {
      /* a file that vanished or is locked is skipped */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/* ---------- Which files were merged into which (so the list can mark them) ---------- */

type MergedMap = Record<string, Record<string, string>>;

function readMerged(): MergedMap {
  try {
    return JSON.parse(localStorage.getItem(MERGED_KEY) ?? '{}') as MergedMap;
  } catch {
    return {};
  }
}

export function getMerged(mangaId: number): Record<string, string> {
  return readMerged()[String(mangaId)] ?? {};
}

export function markMerged(mangaId: number, sources: string[], into: string) {
  const all = readMerged();
  const cur = all[String(mangaId)] ?? {};
  for (const s of sources) cur[s] = into;
  all[String(mangaId)] = cur;
  try {
    localStorage.setItem(MERGED_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
