import type { VolumeRange } from './volumes';

/**
 * Sending a volume list in so it can join the shared list. Only the title and the chapter ranges are sent: no account,
 * no library, no reading history.
 */

export interface Submission {
  /** Format version of this file, so the maintainer's tools can tell them apart later. */
  version: 1;
  titles: string[];
  /** Where the ranges came from, shown next to the volume strip for everyone. */
  page: string;
  /** [volume, first chapter, last chapter] rows. */
  ranges: [number, number, number][];
}

/** Problems that would make a list wrong or useless; an empty array means it is fine to share. */
export function validateRanges(ranges: VolumeRange[]): string[] {
  const problems: string[] = [];
  if (ranges.length === 0) return ['There are no volumes in the list.'];
  const sorted = [...ranges].sort((a, b) => a.volume - b.volume);
  const seen = new Set<number>();
  for (const [i, r] of sorted.entries()) {
    if (![r.volume, r.first, r.last].every(Number.isFinite) || r.volume < 1 || r.first < 0) {
      problems.push(`Volume ${r.volume}: the numbers are not valid.`);
      continue;
    }
    if (seen.has(r.volume)) problems.push(`Volume ${r.volume} appears twice.`);
    seen.add(r.volume);
    if (r.last < r.first) problems.push(`Volume ${r.volume}: it ends (ch. ${r.last}) before it starts (ch. ${r.first}).`);
    const prev = sorted[i - 1];
    if (prev && r.first < prev.last) problems.push(`Volume ${r.volume} starts at ch. ${r.first}, inside volume ${prev.volume} (which ends at ch. ${prev.last}).`);
  }
  return problems;
}

/** The file to send: the series title, a source label and the rows. */
export function makeSubmission(title: string, ranges: VolumeRange[], page = 'Shared by a user'): Submission {
  const rows = [...ranges].sort((a, b) => a.volume - b.volume).map((r): [number, number, number] => [r.volume, r.first, r.last]);
  return { version: 1, titles: [title.trim()], page, ranges: rows };
}

/** Pretty JSON, one volume row per line, for copying or saving. */
export function submissionText(s: Submission): string {
  const rows = s.ranges.map((r) => `    [${r.join(', ')}]`).join(',\n');
  return `{\n  "version": ${s.version},\n  "titles": ${JSON.stringify(s.titles)},\n  "page": ${JSON.stringify(s.page)},\n  "ranges": [\n${rows}\n  ]\n}\n`;
}

/** A safe file name for the download. */
export function submissionFileName(s: Submission): string {
  const base = s.titles[0].replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'series';
  return `volumes-${base}.json`;
}

