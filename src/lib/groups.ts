import type { Chapter } from '../api/queries';

/** Per-manga choice of scanlation group. `group: null` means "all groups". */
export interface GroupPref {
  group: string | null;
  /** When a group is picked, also show chapters that group never released (taken from other groups). */
  fill: boolean;
}

/**
 * The group choice for one manga: its own saved choice (including an explicit "All groups"), else the library-wide
 * preferred group when one is set. A preferred group a series never had changes nothing (visibleChapters ignores it).
 */
export function groupPrefFor(s: { groups: Record<string, GroupPref>; defaultGroup: string; defaultFill: boolean }, mangaId: number): GroupPref | undefined {
  const own = s.groups[String(mangaId)];
  if (own) return own;
  return s.defaultGroup ? { group: s.defaultGroup, fill: s.defaultFill } : undefined;
}

export const UNKNOWN_GROUP = 'Unknown group';

export function groupOf(c: Pick<Chapter, 'scanlator'>): string {
  return c.scanlator?.trim() || UNKNOWN_GROUP;
}

export interface GroupInfo {
  name: string;
  count: number;
  unread: number;
}

/** Groups that released chapters of this manga, biggest first. */
export function listGroups(all: Chapter[]): GroupInfo[] {
  const map = new Map<string, GroupInfo>();
  for (const c of all) {
    const name = groupOf(c);
    const g = map.get(name) ?? { name, count: 0, unread: 0 };
    g.count++;
    if (!c.isRead) g.unread++;
    map.set(name, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Apply a group preference to a chapter list (order is preserved).
 * `keepId` is always kept so the reader can still open a chapter that was reached some other way.
 */
export function visibleChapters(all: Chapter[], pref: GroupPref | undefined, keepId?: number): Chapter[] {
  if (!pref || !pref.group) return all;
  const groups = listGroups(all);
  if (!groups.some((g) => g.name === pref.group)) return all; // group no longer exists

  const include = new Set<number>();
  const haveNumbers = new Set<number>();
  for (const c of all) {
    if (groupOf(c) === pref.group) {
      include.add(c.id);
      if (c.chapterNumber >= 0) haveNumbers.add(c.chapterNumber);
    }
  }

  if (pref.fill) {
    // Fill the gaps from the other groups, preferring whichever released the most chapters.
    const rank = new Map(groups.map((g, i) => [g.name, i]));
    const others = all
      .filter((c) => !include.has(c.id))
      .sort((a, b) => (rank.get(groupOf(a)) ?? 0) - (rank.get(groupOf(b)) ?? 0));
    for (const c of others) {
      if (c.chapterNumber < 0) include.add(c.id); // unnumbered: can't tell if it's a duplicate
      else if (!haveNumbers.has(c.chapterNumber)) {
        haveNumbers.add(c.chapterNumber);
        include.add(c.id);
      }
    }
  }

  if (keepId !== undefined) include.add(keepId);
  return all.filter((c) => include.has(c.id));
}
