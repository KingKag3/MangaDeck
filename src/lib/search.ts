/** Lowercase, accent-free text for comparing titles with what was typed. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words of a search box entry. */
export function queryWords(q: string): string[] {
  return fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True when the title contains every word (anywhere, any order). No words matches everything. */
export function titleHasWords(title: string, words: string[]): boolean {
  if (!words.length) return true;
  const t = fold(title);
  return words.every((w) => t.includes(w));
}
