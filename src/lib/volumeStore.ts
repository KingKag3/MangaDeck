import { M, type MangaDetail } from '../api/queries';
import { setVolumeInfo } from './settings';
import type { VolumeInfo } from './volumes';

/**
 * Volume maps are kept in two places: this browser (fast, `settings.volumes`) and the Suwayomi server, as a piece of
 * the manga's own meta data. The server copy follows the manga to every browser and address (5173, 8080) and survives
 * rebuilding Docker, so a volume list only has to be found or entered once.
 */

export const META_KEY = 'mangadeck.volumes';
const MAX_BYTES = 200_000;

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
  const value = JSON.stringify(info);
  if (value.length > MAX_BYTES) return;
  M.setMangaMeta(mangaId, META_KEY, value).catch((e) => console.warn('Could not save volumes on the server:', e));
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
