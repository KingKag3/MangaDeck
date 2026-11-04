import type { Chapter } from '../api/queries';

/**
 * The same series on more than one source. A manga page can link other entries ("linked sources"); their chapters fill
 * the gaps of the main one, are used when a chapter will not download, and can be moved to when a source is bad.
 * Chapters are matched by chapter number (unnumbered chapters, number < 0, are never matched).
 */

export interface LinkedSource {
  /** The other manga entry on the server. */
  mangaId: number;
  title: string;
  /** Display name of its source, for labels. */
  source: string;
}

export const sameNumber = (a: number, b: number) => a >= 0 && b >= 0 && Math.abs(a - b) < 1e-6;

/** Chapters the linked entry has that the main one does not, one copy per chapter number, in reading order. */
export function missingFromLinked(primary: Chapter[], linked: Chapter[]): Chapter[] {
  const have = new Set(primary.filter((c) => c.chapterNumber >= 0).map((c) => c.chapterNumber));
  const seen = new Set<number>();
  const out: Chapter[] = [];
  for (const c of linked) {
    if (c.chapterNumber < 0 || have.has(c.chapterNumber) || seen.has(c.chapterNumber)) continue;
    seen.add(c.chapterNumber);
    out.push(c);
  }
  return out.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

/** The linked entry's copy of a chapter number, preferring one that is already downloaded. */
export function findAltChapter(linked: Chapter[], chapterNumber: number): Chapter | null {
  const hits = linked.filter((c) => sameNumber(c.chapterNumber, chapterNumber));
  return hits.find((c) => c.isDownloaded) ?? hits[0] ?? null;
}

/** The main chapters plus what linked sources add, for packing a volume or the whole series. */
export function withLinkedChapters(primary: Chapter[], linkedLists: Chapter[][]): Chapter[] {
  let all = primary;
  for (const l of linkedLists) all = [...all, ...missingFromLinked(all, l)];
  return all;
}

/**
 * What to copy to the new entry when moving a series: everything up to the furthest chapter you read counts as read,
 * and bookmarks follow by chapter number.
 */
export function planMigration(from: Chapter[], to: Chapter[]): { readIds: number[]; bookmarkIds: number[] } {
  const readNumbers = from.filter((c) => c.isRead && c.chapterNumber >= 0).map((c) => c.chapterNumber);
  const furthest = readNumbers.length ? Math.max(...readNumbers) : -1;
  const marked = new Set(from.filter((c) => c.isBookmarked && c.chapterNumber >= 0).map((c) => c.chapterNumber));
  const readIds: number[] = [];
  const bookmarkIds: number[] = [];
  for (const c of to) {
    if (c.chapterNumber < 0) continue;
    if (!c.isRead && furthest >= 0 && c.chapterNumber <= furthest) readIds.push(c.id);
    if (!c.isBookmarked && marked.has(c.chapterNumber)) bookmarkIds.push(c.id);
  }
  return { readIds, bookmarkIds };
}
