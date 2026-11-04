import data from '../data/volumeRules.json';
import type { VolumeInfo, VolumeRange } from './volumes';

/**
 * Built-in rules: volume lists for series that no automatic source can read (Wikipedia has no chapter lists for them),
 * worked out once from a wiki or typed in, and shared with everyone who uses the app through `src/data/volumeRules.json`.
 * `Find volumes` checks this list before it asks Wikipedia, and opening a series applies a matching rule by itself.
 *
 * To add series: set their volumes in the app (Set volumes), then run `npm run volumes:export` with Suwayomi running.
 * It copies every hand-made list from your server into the JSON file, ready to commit.
 */

export interface VolumeRule {
  /** Every title the series goes by in sources. Compared ignoring case, accents and punctuation. */
  titles: string[];
  /** Where the ranges came from, shown next to the volume strip. */
  page: string;
  /** [volume, first chapter, last chapter] rows. */
  ranges: [number, number, number][];
}

export const VOLUME_RULES: VolumeRule[] = data as VolumeRule[];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const toRanges = (rows: VolumeRule['ranges']): VolumeRange[] => rows.map(([volume, first, last]) => ({ volume, first, last }));

/** Community rules fetched at runtime (see remoteRules.ts). They are checked before the built-in ones. */
let extraRules: VolumeRule[] = [];
export function setExtraRules(rules: VolumeRule[]) {
  extraRules = rules;
}

/** The rule for this title, as volume info ready to save, or null. */
export function findVolumeRule(title: string, rules: VolumeRule[] = [...extraRules, ...VOLUME_RULES]): VolumeInfo | null {
  const t = norm(title);
  if (!t) return null;
  const rule = rules.find((r) => r.titles.some((x) => norm(x) === t));
  return rule ? { source: 'rule', page: rule.page, ranges: toRanges(rule.ranges) } : null;
}
