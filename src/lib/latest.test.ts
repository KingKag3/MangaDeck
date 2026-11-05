import { describe, expect, it } from 'vitest';
import { newestChapterReleased } from './latest';

const day = (d: string) => String(Date.parse(d));

describe('newestChapterReleased', () => {
  it('uses the earliest copy of the highest whole chapter, ignoring recent extras', () => {
    const ch = [
      { chapterNumber: 311.5, uploadDate: day('2026-11-04') },
      { chapterNumber: 311, uploadDate: day('2026-07-20') },
      { chapterNumber: 311, uploadDate: day('2026-05-19') },
      { chapterNumber: 310, uploadDate: day('2026-05-13') },
    ];
    expect(newestChapterReleased(ch)).toBe(Date.parse('2026-05-19'));
  });

  it('ignores a recent upload of a low chapter number', () => {
    const ch = [
      { chapterNumber: 43, uploadDate: day('2026-09-12') },
      { chapterNumber: 2, uploadDate: day('2026-11-03') },
    ];
    expect(newestChapterReleased(ch)).toBe(Date.parse('2026-09-12'));
  });

  it('skips unnumbered chapters and zero dates, falls back to fractions, then 0', () => {
    expect(newestChapterReleased([{ chapterNumber: -1, uploadDate: day('2026-01-01') }])).toBe(0);
    expect(newestChapterReleased([{ chapterNumber: 5.5, uploadDate: day('2026-02-02') }])).toBe(Date.parse('2026-02-02'));
    expect(newestChapterReleased([{ chapterNumber: 4, uploadDate: '0' }, { chapterNumber: 4, uploadDate: day('2026-03-03') }])).toBe(Date.parse('2026-03-03'));
    expect(newestChapterReleased([])).toBe(0);
  });
});
