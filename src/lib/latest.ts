import { toMs } from './format';

export interface DatedChapter {
  chapterNumber: number;
  uploadDate: string | number;
}

/**
 * When a series' newest chapter first came out. Sources and groups stamp extras (311.5), re-uploads and other groups'
 * copies with recent dates, so "the latest upload" often is not the newest chapter. Instead: take the highest whole
 * chapter number and the earliest date any copy of it has. Falls back to the highest number of any kind, then 0.
 */
export function newestChapterReleased(chapters: DatedChapter[]): number {
  const numbered = chapters.filter((c) => c.chapterNumber > 0);
  if (!numbered.length) return 0;
  const whole = numbered.filter((c) => Number.isInteger(c.chapterNumber));
  const pool = whole.length ? whole : numbered;
  const top = Math.max(...pool.map((c) => c.chapterNumber));
  const dates = pool.filter((c) => c.chapterNumber === top).map((c) => toMs(c.uploadDate)).filter((d) => d > 0);
  return dates.length ? Math.min(...dates) : 0;
}
