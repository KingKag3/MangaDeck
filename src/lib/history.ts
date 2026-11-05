import { useSyncExternalStore } from 'react';

/**
 * A log of what finished downloading, newest first, saved in this browser. Suwayomi only knows what is in its queue right
 * now, so this is what the Downloads page shows under "History".
 */

export interface HistoryEntry {
  /** When it finished (ms since epoch). */
  at: number;
  /** One chapter (paced download), one volume .cbz, or a whole-series .cbz. */
  kind: 'chapter' | 'volume' | 'series';
  mangaId: number;
  title: string;
  /** "Chapter 12", "Vol. 03 .cbz", ... */
  label: string;
  ok: boolean;
  /** Extra detail: "12 chapters, 240 pages", or why it failed. */
  note?: string;
  /** Where a file went. Browsers hide full paths, so this is a file or folder name, or "Downloads folder". */
  where?: string;
}

export const HISTORY_KEY = 'mangadeck.history';
export const HISTORY_MAX = 500;

/** The list with `entry` added in front, cut to `max` entries. */
export function appendEntry(list: HistoryEntry[], entry: HistoryEntry, max = HISTORY_MAX): HistoryEntry[] {
  return [entry, ...list].slice(0, max);
}

/** Read the saved log; anything that is not a well-formed entry is dropped. */
export function parseHistory(raw: string | null | undefined): HistoryEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (e): e is HistoryEntry =>
          !!e &&
          typeof e.at === 'number' &&
          (e.kind === 'chapter' || e.kind === 'volume' || e.kind === 'series') &&
          typeof e.mangaId === 'number' &&
          typeof e.title === 'string' &&
          typeof e.label === 'string' &&
          typeof e.ok === 'boolean' &&
          (e.where === undefined || typeof e.where === 'string'),
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function read(): HistoryEntry[] {
  try {
    return parseHistory(globalThis.localStorage?.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

let entries: HistoryEntry[] = read();
const listeners = new Set<() => void>();

function write(next: HistoryEntry[]) {
  entries = next;
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

// Another tab may be the one downloading: pick up its entries.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== HISTORY_KEY) return;
    entries = read();
    listeners.forEach((l) => l());
  });
}

/** Record a finished (or failed) download. */
export function logDownload(entry: Omit<HistoryEntry, 'at'>) {
  // Re-read first so a second tab's entries are not overwritten.
  entries = read();
  write(appendEntry(entries, { ...entry, at: Date.now() }));
}

/** Forget the .cbz exports (volume and whole-series), keeping the chapter downloads. */
export function clearExports() {
  entries = read();
  write(entries.filter((e) => e.kind === 'chapter'));
}

export function clearHistory() {
  write([]);
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => entries,
  );
}
