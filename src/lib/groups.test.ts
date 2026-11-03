import { describe, expect, it } from 'vitest';
import type { Chapter } from '../api/queries';
import { groupOf, listGroups, UNKNOWN_GROUP, visibleChapters } from './groups';

let nextId = 1;
function ch(chapterNumber: number, scanlator: string | null, extra: Partial<Chapter> = {}): Chapter {
  const id = nextId++;
  return {
    id,
    name: `Ch ${chapterNumber}`,
    mangaId: 1,
    chapterNumber,
    scanlator,
    sourceOrder: id,
    uploadDate: '0',
    fetchedAt: '0',
    lastReadAt: '0',
    lastPageRead: 0,
    pageCount: 0,
    isRead: false,
    isDownloaded: false,
    isBookmarked: false,
    realUrl: null,
    ...extra,
  };
}

const ids = (list: Chapter[]) => list.map((c) => c.id);

describe('groupOf', () => {
  it('trims and falls back to Unknown group', () => {
    expect(groupOf({ scanlator: '  Foo ' })).toBe('Foo');
    expect(groupOf({ scanlator: null })).toBe(UNKNOWN_GROUP);
    expect(groupOf({ scanlator: '   ' })).toBe(UNKNOWN_GROUP);
  });
});

describe('listGroups', () => {
  it('counts chapters and unread, biggest group first, ties by name', () => {
    const all = [
      ch(1, 'B', { isRead: true }),
      ch(2, 'B'),
      ch(3, 'A'),
      ch(4, 'C'),
      ch(5, null),
    ];
    expect(listGroups(all)).toEqual([
      { name: 'B', count: 2, unread: 1 },
      { name: 'A', count: 1, unread: 1 },
      { name: 'C', count: 1, unread: 1 },
      { name: UNKNOWN_GROUP, count: 1, unread: 1 },
    ]);
  });

  it('returns empty for no chapters', () => {
    expect(listGroups([])).toEqual([]);
  });
});

describe('visibleChapters', () => {
  // Newest first, like the app fetches them.
  const a3 = ch(3, 'A');
  const b3 = ch(3, 'B');
  const b2 = ch(2, 'B');
  const a1 = ch(1, 'A');
  const b1 = ch(1, 'B');
  const all = [a3, b3, b2, a1, b1];

  it('returns everything without a preference or group', () => {
    expect(visibleChapters(all, undefined)).toBe(all);
    expect(visibleChapters(all, { group: null, fill: true })).toBe(all);
  });

  it('returns everything when the group no longer exists', () => {
    expect(visibleChapters(all, { group: 'Gone', fill: false })).toBe(all);
  });

  it('shows only the chosen group, order preserved', () => {
    expect(ids(visibleChapters(all, { group: 'A', fill: false }))).toEqual(ids([a3, a1]));
  });

  it('fill adds missing numbers from other groups, one copy each', () => {
    // B has the most chapters (3), so B wins as the donor; A already has 3 and 1, only 2 is missing.
    expect(ids(visibleChapters(all, { group: 'A', fill: true }))).toEqual(ids([a3, b2, a1]));
  });

  it('fill prefers the donor group with the most chapters', () => {
    const x = ch(5, 'X');
    const y = ch(5, 'Y');
    const y4 = ch(4, 'Y');
    const g = ch(1, 'Pick');
    const pick = [x, y, y4, g];
    // Y (2 chapters) outranks X (1) for chapter 5.
    expect(ids(visibleChapters(pick, { group: 'Pick', fill: true }))).toEqual(ids([y, y4, g]));
  });

  it('never treats unnumbered chapters as duplicates', () => {
    const u1 = ch(-1, 'B');
    const u2 = ch(-1, 'B');
    const own = ch(1, 'A');
    const list = [u1, u2, own];
    expect(ids(visibleChapters(list, { group: 'A', fill: true }))).toEqual(ids([u1, u2, own]));
    expect(ids(visibleChapters(list, { group: 'A', fill: false }))).toEqual(ids([own]));
  });

  it('keepId is always kept', () => {
    expect(ids(visibleChapters(all, { group: 'A', fill: false }, b2.id))).toEqual(ids([a3, b2, a1]));
  });

  it('keepId does not break the no-filter path', () => {
    expect(visibleChapters(all, undefined, b2.id)).toBe(all);
  });

  it('chapters with no scanlator form Unknown group', () => {
    const u = ch(1, null);
    const k = ch(2, 'K');
    expect(ids(visibleChapters([k, u], { group: UNKNOWN_GROUP, fill: false }))).toEqual(ids([u]));
  });
});
