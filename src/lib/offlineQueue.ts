/** Reading progress made while the server could not be reached, kept until it can be sent (see flushProgress in offline.ts). */
export const PENDING = 'mangadeck.pendingProgress';
export type ProgressPatch = { isRead?: boolean; lastPageRead?: number };

export function readPending(): Record<string, ProgressPatch> {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? '{}');
  } catch {
    return {};
  }
}

export function queueProgress(id: number, patch: ProgressPatch) {
  const all = readPending();
  const prev = all[String(id)] ?? {};
  all[String(id)] = { ...prev, ...patch, ...(prev.isRead || patch.isRead ? { isRead: true } : {}) };
  try {
    localStorage.setItem(PENDING, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function pendingProgressCount(): number {
  return Object.keys(readPending()).length;
}
