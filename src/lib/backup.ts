/**
 * Backup and restore of what Mangadeck keeps in this browser (reader options, scanlation group choices, linked sources,
 * volume maps, history, merged-file notes, library view). Never included: sign-in tokens, the server address (it differs
 * per machine), caches and unfinished download jobs. Folder links (the .cbz folder per series) live in IndexedDB as
 * permission handles that cannot be exported, so they are chosen again after a restore.
 */
export const BACKUP_KEYS = [
  'mangadeck.settings',
  'mangadeck.history',
  'mangadeck.merged',
  'mangadeck.rulesApplied',
  'mangadeck.libview',
  'mangadeck.libsources',
  'mangadeck.fresh',
  'mangadeck.updsnap',
  'mangadeck.tracker', // which AniList entry each series is linked to (the sign-in token is never included)
] as const;

export interface BackupFile {
  app: 'mangadeck';
  version: 1;
  savedAt: string;
  data: Record<string, unknown>;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function buildBackup(store: Store, now = new Date()): BackupFile {
  const data: Record<string, unknown> = {};
  for (const key of BACKUP_KEYS) {
    const raw = store.getItem(key);
    if (raw === null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      /* not JSON: leave it out rather than store something unreadable */
    }
  }
  return { app: 'mangadeck', version: 1, savedAt: now.toISOString(), data };
}

/** Reads a backup file's text. Throws a readable error when it is not one of ours; unknown keys are ignored. */
export function parseBackup(text: string): BackupFile {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('That file is not a Mangadeck backup (it is not valid JSON).');
  }
  const b = j as Partial<BackupFile> | null;
  if (!b || b.app !== 'mangadeck' || typeof b.data !== 'object' || b.data === null || Array.isArray(b.data)) {
    throw new Error('That file is not a Mangadeck backup.');
  }
  if (b.version !== 1) throw new Error('That backup was made by a newer Mangadeck. Update the app first.');
  const data: Record<string, unknown> = {};
  for (const key of BACKUP_KEYS) if (key in b.data) data[key] = (b.data as Record<string, unknown>)[key];
  if (Object.keys(data).length === 0) throw new Error('That backup has nothing in it to restore.');
  return { app: 'mangadeck', version: 1, savedAt: typeof b.savedAt === 'string' ? b.savedAt : '', data };
}

/** Writes the backup into storage, replacing the keys it holds. Returns how many were restored. */
export function applyBackup(store: Store, backup: BackupFile): number {
  let n = 0;
  for (const [key, value] of Object.entries(backup.data)) {
    if (!(BACKUP_KEYS as readonly string[]).includes(key)) continue;
    store.setItem(key, JSON.stringify(value));
    n++;
  }
  return n;
}

/** A short description of what a backup holds, for the confirmation question. */
export function describeBackup(b: BackupFile): string {
  const s = b.data['mangadeck.settings'] as { groups?: object; volumes?: object; links?: object; perManga?: object } | undefined;
  const count = (o?: object) => (o ? Object.keys(o).length : 0);
  const history = b.data['mangadeck.history'];
  const parts = [
    `${count(s?.volumes)} volume lists`,
    `${count(s?.groups)} group choices`,
    `${count(s?.links)} linked series`,
    `${count(s?.perManga)} reader overrides`,
    `${Array.isArray(history) ? history.length : 0} history entries`,
  ];
  return parts.join(', ');
}
