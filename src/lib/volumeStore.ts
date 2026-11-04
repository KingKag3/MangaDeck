import { M, type MangaDetail } from '../api/queries';
import { setVolumeInfo } from './settings';
import type { VolumeInfo } from './volumes';

/**
 * Volume maps are kept in two places: this browser (fast, `settings.volumes`) and the Suwayomi server, as a piece of
 * the manga's own meta data. The server copy follows the manga to every browser and address (5173, 8080) and survives
 * rebuilding Docker, so a volume list only has to be found or entered once.
 */

export const META_KEY = 'mangadeck.volumes';
/** The server silently refuses (no error, nothing stored) a meta value over 4,096 characters; stay under that. */
export const META_LIMIT = 4000;

/**
 * The text to store on the server: everything when it fits, otherwise without chapter titles, otherwise also without
 * release dates and ISBNs. The volume ranges are always kept. Returns null if even they do not fit.
 */
export function serverCopy(info: VolumeInfo): string | null {
  const full = JSON.stringify(info);
  if (full.length <= META_LIMIT) return full;
  const noTitles: VolumeInfo = { ...info, slim: true, ranges: info.ranges.map(({ titles: _t, ...r }) => r) };
  const a = JSON.stringify(noTitles);
  if (a.length <= META_LIMIT) return a;
  const bare: VolumeInfo = { ...noTitles, ranges: noTitles.ranges.map(({ released: _d, isbn: _i, ...r }) => r) };
  const b = JSON.stringify(bare);
  return b.length <= META_LIMIT ? b : null;
}

/** The volume map saved on the server for this manga, or null. */
export function volumeInfoFromMeta(meta: MangaDetail['meta'] | undefined): VolumeInfo | null {
  const raw = meta?.find((m) => m.key === META_KEY)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as VolumeInfo;
    return Array.isArray(v?.ranges) && v.ranges.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export type SyncAction = 'none' | 'pull' | 'push';

/** Which copy wins: the newest one (by `savedAt`). `pull` = take the server's, `push` = send ours. */
export function chooseSync(local: VolumeInfo | undefined, remote: VolumeInfo | null): SyncAction {
  if (!local && !remote) return 'none';
  if (!local) return 'pull';
  if (!remote) return 'push';
  const l = local.savedAt ?? 0;
  const r = remote.savedAt ?? 0;
  return r > l ? 'pull' : l > r ? 'push' : 'none';
}

/** Send the map to the server. Failures are not shown: the browser copy still works. */
export function pushVolumeMeta(mangaId: number, info: VolumeInfo) {
  const value = serverCopy(info);
  if (!value) {
    console.warn('These volumes are too long to keep on the server; they stay in this browser only.');
    return;
  }
  M.setMangaMeta(mangaId, META_KEY, value)
    .then((r) => {
      // A value the server refuses comes back as null instead of an error.
      if (!r?.setMangaMeta?.meta) console.warn('The server did not keep the volumes (value too large?).');
    })
    .catch((e) => console.warn('Could not save volumes on the server:', e));
}

/** Save found, entered or imported volumes here and on the server (null removes them from both). */
export function saveVolumes(mangaId: number, info: VolumeInfo | null) {
  if (info === null) {
    setVolumeInfo(mangaId, null);
    M.deleteMangaMeta(mangaId, META_KEY).catch((e) => console.warn('Could not remove volumes on the server:', e));
    return;
  }
  const stamped = { ...info, savedAt: Date.now() };
  setVolumeInfo(mangaId, stamped);
  pushVolumeMeta(mangaId, stamped);
}
