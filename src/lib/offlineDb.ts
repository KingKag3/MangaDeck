/**
 * Small IndexedDB wrapper for offline reading. Two stores:
 *  - responses: the last good answer of each GraphQL query, so pages still open when the server cannot be reached
 *  - chapters:  chapters saved for offline reading (their page list and sizes); the page images themselves are in the
 *               Cache Storage (see offline.ts), where the service worker can serve them.
 * Every function fails quietly (private windows, blocked storage): offline reading just is not available then.
 */
const DB = 'mangadeck-offline';
const RESPONSES = 'responses';
const CHAPTERS = 'chapters';

export interface SavedChapter {
  chapterId: number;
  mangaId: number;
  mangaTitle: string;
  name: string;
  number: number;
  pages: string[];
  bytes: number;
  savedAt: number;
}

export interface StoredResponse {
  key: string;
  data: unknown;
  at: number;
}

let opened: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RESPONSES)) db.createObjectStore(RESPONSES, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(CHAPTERS)) db.createObjectStore(CHAPTERS, { keyPath: 'chapterId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    opened.catch(() => (opened = null));
  }
  return opened;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ---------- last good responses ---------- */

export const responseKey = (query: string, variables: unknown) => query.replace(/\s+/g, ' ').trim() + '|' + JSON.stringify(variables ?? {});

let writes = 0;
export async function saveResponse(key: string, data: unknown): Promise<void> {
  try {
    await run(RESPONSES, 'readwrite', (s) => s.put({ key, data, at: Date.now() } satisfies StoredResponse));
    if (++writes % 25 === 0) void trimResponses(200);
  } catch {
    /* offline cache is best effort */
  }
}

export async function readResponse(key: string): Promise<StoredResponse | null> {
  try {
    return ((await run(RESPONSES, 'readonly', (s) => s.get(key))) as StoredResponse | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearResponses(): Promise<void> {
  try {
    await run(RESPONSES, 'readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}

/** Keep the newest `max` responses. */
export async function trimResponses(max: number): Promise<void> {
  try {
    const all = (await run(RESPONSES, 'readonly', (s) => s.getAll())) as StoredResponse[];
    if (all.length <= max) return;
    const drop = all.sort((a, b) => a.at - b.at).slice(0, all.length - max);
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(RESPONSES, 'readwrite');
      for (const r of drop) tx.objectStore(RESPONSES).delete(r.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

/* ---------- saved chapters ---------- */

export async function putSavedChapter(c: SavedChapter): Promise<void> {
  await run(CHAPTERS, 'readwrite', (s) => s.put(c));
}

export async function deleteSavedChapter(chapterId: number): Promise<void> {
  await run(CHAPTERS, 'readwrite', (s) => s.delete(chapterId));
}

export async function clearSavedChapters(): Promise<void> {
  await run(CHAPTERS, 'readwrite', (s) => s.clear());
}

export async function allSavedChapters(): Promise<SavedChapter[]> {
  try {
    return (await run(CHAPTERS, 'readonly', (s) => s.getAll())) as SavedChapter[];
  } catch {
    return [];
  }
}

/** The page list of a chapter saved for offline reading, or null. */
export async function getSavedPages(chapterId: number): Promise<string[] | null> {
  try {
    const c = (await run(CHAPTERS, 'readonly', (s) => s.get(chapterId))) as SavedChapter | undefined;
    return c?.pages ?? null;
  } catch {
    return null;
  }
}
