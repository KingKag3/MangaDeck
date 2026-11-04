import { describe, expect, it } from 'vitest';
import type { Chapter } from '../api/queries';
import { findAltChapter, missingFromLinked, planMigration, withLinkedChapters } from './sourceLinks';

let n = 0;
const ch = (chapterNumber: number, over: Partial<Chapter> = {}): Chapter => ({
  id: ++n,
  name: `Chapter ${chapterNumber}`,
  mangaId: 1,
  chapterNumber,
  scanlator: null,
  sourceOrder: chapterNumber,
  uploadDate: '0',
  fetchedAt: '0',
  lastReadAt: '0',
  lastPageRead: 0,
  pageCount: 0,
  isRead: false,
  isDownloaded: false,
  isBookmarked: false,
  realUrl: null,
  ...over,
});

describe('missingFromLinked', () => {
  it('returns only chapter numbers the main entry lacks, once each, in order', () => {
    const main = [ch(1), ch(2), ch(5)];
    const alt = [ch(5), ch(4), ch(3), ch(3), ch(2), ch(-1)];
    expect(missingFromLinked(main, alt).map((c) => c.chapterNumber)).toEqual([3, 4]);
  });

  it('never matches unnumbered chapters', () => {
    expect(missingFromLinked([ch(-1)], [ch(-1)])).toEqual([]);
  });
});

describe('findAltChapter', () => {
  it('finds by number and prefers a downloaded copy', () => {
    const a = ch(7);
    const b = ch(7, { isDownloaded: true });
    expect(findAltChapter([a, b], 7)).toBe(b);
    expect(findAltChapter([a], 8)).toBeNull();
    expect(findAltChapter([a], -1)).toBeNull();
  });
});

describe('withLinkedChapters', () => {
  it('adds gaps from each linked list without duplicating', () => {
    const all = withLinkedChapters([ch(1), ch(4)], [[ch(2), ch(3)], [ch(3), ch(5)]]);
    expect(all.map((c) => c.chapterNumber).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('planMigration', () => {
  it('marks read up to the furthest chapter read and carries bookmarks by number', () => {
    const from = [ch(1, { isRead: true }), ch(2, { isRead: true }), ch(4, { isRead: true }), ch(6, { isBookmarked: true })];
    const to = [ch(1), ch(2), ch(3), ch(4), ch(5), ch(6), ch(-1)];
    const plan = planMigration(from, to);
    expect(plan.readIds).toEqual([to[0].id, to[1].id, to[2].id, to[3].id]);
    expect(plan.bookmarkIds).toEqual([to[5].id]);
  });

  it('does nothing when nothing was read', () => {
    expect(planMigration([ch(1)], [ch(1), ch(2)])).toEqual({ readIds: [], bookmarkIds: [] });
  });
});
