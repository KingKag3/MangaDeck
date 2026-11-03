import { useSyncExternalStore } from 'react';

/**
 * Titles that got new chapters in the last "Check for updates", so the library can highlight their cards until
 * they are opened or dismissed. Saved in the browser, so the highlight survives a reload.
 */

const FRESH = 'mangadeck.fresh';
const SNAP = 'mangadeck.updsnap';

type Counts = Record<string, number>;

function read(key: string): Counts {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Counts;
  } catch {
    /* ignore */
  }
  return {};
}

function write(key: string, value: Counts | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

let fresh: Counts = read(FRESH);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setFresh(next: Counts) {
  fresh = next;
  write(FRESH, fresh);
  emit();
}

/** How many chapters each title gained: only titles that were in `before` and grew. */
export function diffCounts(before: Counts, after: Counts): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(after)) {
    const was = before[id];
    if (was !== undefined && n > was) out[id] = n - was;
  }
  return out;
}

/** Remember the chapter counts right before an update starts. */
export function snapshotCounts(counts: Counts) {
  write(SNAP, counts);
}

/** After an update: compare with the snapshot and highlight what grew. Returns how many titles gained chapters. */
export function recordNewChapters(after: Counts): number {
  const before = read(SNAP);
  if (Object.keys(before).length === 0) return 0;
  const grew = diffCounts(before, after);
  write(SNAP, null);
  const merged = { ...fresh };
  for (const [id, n] of Object.entries(grew)) merged[id] = (merged[id] ?? 0) + n;
  if (Object.keys(grew).length) setFresh(merged);
  return Object.keys(grew).length;
}

/** The title was opened: no more highlight. */
export function markSeen(id: number) {
  if (fresh[String(id)] === undefined) return;
  const next = { ...fresh };
  delete next[String(id)];
  setFresh(next);
}

export function dismissAllFresh() {
  setFresh({});
}

export function useFresh(): Counts {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => fresh,
  );
}
