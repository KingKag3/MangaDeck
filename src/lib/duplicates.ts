import { fold } from './search';

/** A title reduced to what identifies the series: no accents, case, "(Official)" style notes, punctuation or leading "The". */
export function titleKey(title: string): string {
  const t = fold(title)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
  return t.replace(/ /g, '');
}

/**
 * Library entries that share a title key (the same series added from two sources). Different titles that merely share
 * words ("Solo Leveling" and "Solo Leveling: Ragnarok") are not matched. Groups come out biggest first.
 */
export function findDuplicates<T extends { title: string }>(mangas: T[]): T[][] {
  const by = new Map<string, T[]>();
  for (const m of mangas) {
    const k = titleKey(m.title);
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), m]);
  }
  return [...by.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length || a[0].title.localeCompare(b[0].title));
}
