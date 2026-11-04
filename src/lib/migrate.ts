import { M, Q } from '../api/queries';
import { getSettings, setLinks, updateMangaPrefs } from './settings';
import { planMigration, type LinkedSource } from './sourceLinks';
import { saveVolumes } from './volumeStore';

/**
 * Move a series from one source entry to another: the new entry joins the library (in the same categories), chapters you
 * read are marked read there, bookmarks follow, and the settings kept for the old entry (volumes, reader options) are
 * copied. The old entry leaves the library but stays linked as a fallback source; its downloads are not deleted.
 */
export async function migrateSeries(o: {
  fromId: number;
  fromTitle: string;
  fromSource: string;
  toId: number;
  categoryIds: number[];
}): Promise<{ read: number; bookmarks: number }> {
  const [from, to0] = await Promise.all([Q.chapters(o.fromId), Q.chapters(o.toId)]);
  let to = to0;
  if (to.length === 0) {
    await M.refreshManga(o.toId, true, true);
    to = await Q.chapters(o.toId);
  }
  const plan = planMigration(from, to);
  if (plan.readIds.length) await M.updateChapters(plan.readIds, { isRead: true });
  if (plan.bookmarkIds.length) await M.updateChapters(plan.bookmarkIds, { isBookmarked: true });

  await M.setInLibrary(o.toId, true);
  if (o.categoryIds.length) await M.setMangaCategories(o.toId, o.categoryIds, []);
  await M.setInLibrary(o.fromId, false);

  const s = getSettings();
  const volumes = s.volumes[String(o.fromId)];
  if (volumes && !s.volumes[String(o.toId)]) saveVolumes(o.toId, volumes);
  const prefs = s.perManga[String(o.fromId)];
  if (prefs && !s.perManga[String(o.toId)]) updateMangaPrefs(o.toId, prefs);

  // The old entry stays reachable as a fallback; the new one inherits the other links.
  const others = (s.links[String(o.fromId)] ?? []).filter((l) => l.mangaId !== o.toId && l.mangaId !== o.fromId);
  const old: LinkedSource = { mangaId: o.fromId, title: o.fromTitle, source: o.fromSource };
  setLinks(o.toId, [old, ...others]);
  setLinks(o.fromId, []);
  return { read: plan.readIds.length, bookmarks: plan.bookmarkIds.length };
}
