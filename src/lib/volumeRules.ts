import type { VolumeInfo, VolumeRange } from './volumes';

/**
 * Built-in rules: series whose volumes no automatic source can read (Wikipedia has no chapter lists for them), worked
 * out once from a wiki and kept here. `Find volumes` checks this list before it asks Wikipedia. To add a series:
 * set its volumes in the app (Set volumes), then copy the ranges here with every title the sources call it.
 */

interface VolumeRule {
  /** Every title the series goes by in sources. Compared ignoring case, accents and punctuation. */
  titles: string[];
  /** Where the ranges came from, shown next to the volume strip. */
  page: string;
  ranges: VolumeRange[];
}

/** [volume, first chapter, last chapter] rows. */
const rows = (...r: [number, number, number][]): VolumeRange[] => r.map(([volume, first, last]) => ({ volume, first, last }));

export const VOLUME_RULES: VolumeRule[] = [
  {
    titles: ['Mushoku Tensei - Jobless Reincarnation', 'Mushoku Tensei: Jobless Reincarnation', 'Mushoku Tensei: Isekai Ittara Honki Dasu (Manga)'],
    page: 'Mushoku Tensei Wiki (manga volumes)',
    ranges: rows(
      [1, 1, 5], [2, 6, 10], [3, 11, 16], [4, 17, 21], [5, 22, 27], [6, 28, 32], [7, 33, 37], [8, 38, 42], [9, 43, 47],
      [10, 48, 51], [11, 52, 56.5], [12, 57, 60], [13, 61, 64], [14, 65, 68.5], [15, 69, 72.5], [16, 73, 76], [17, 77, 81],
      [18, 82, 86], [19, 87, 91], [20, 92, 96], [21, 97, 101], [22, 102, 106], [23, 107, 111], [24, 112, 116], [25, 117, 121],
    ),
  },
  {
    titles: ['Solo Leveling', 'Na Honjaman Level-Up', 'I Level Up Alone'],
    page: 'Solo Leveling Wiki (webtoon volumes)',
    ranges: rows(
      [1, 0, 12], [2, 13, 26], [3, 27, 44], [4, 45, 63], [5, 64, 81], [6, 82, 97], [7, 98, 110], [8, 111, 122],
      [9, 123, 134], [10, 135, 146], [11, 147, 158], [12, 159, 168], [13, 169, 179], [14, 180, 190], [15, 191, 200],
    ),
  },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The rule for this title, as volume info ready to save, or null. */
export function findVolumeRule(title: string, rules: VolumeRule[] = VOLUME_RULES): VolumeInfo | null {
  const t = norm(title);
  if (!t) return null;
  const rule = rules.find((r) => r.titles.some((x) => norm(x) === t));
  return rule ? { source: 'rule', page: rule.page, ranges: rule.ranges.map((r) => ({ ...r })) } : null;
}
