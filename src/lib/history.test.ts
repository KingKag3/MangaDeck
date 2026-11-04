import { describe, expect, it } from 'vitest';
import { appendEntry, parseHistory, type HistoryEntry } from './history';

const e = (n: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ at: n, kind: 'chapter', mangaId: 1, title: 'T', label: `Chapter ${n}`, ok: true, ...over });

describe('appendEntry', () => {
  it('puts the newest first and cuts the list to the limit', () => {
    const list = appendEntry(appendEntry([], e(1), 2), e(2), 2);
    expect(list.map((x) => x.at)).toEqual([2, 1]);
    expect(appendEntry(list, e(3), 2).map((x) => x.at)).toEqual([3, 2]);
  });
});

describe('parseHistory', () => {
  it('reads a saved log back', () => {
    const list = [e(2), e(1, { ok: false, note: 'blocked' })];
    expect(parseHistory(JSON.stringify(list))).toEqual(list);
  });

  it('survives missing, broken and odd data', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory(JSON.stringify([e(1), { at: 'x' }, null, { ...e(2), kind: 'other' }]))).toEqual([e(1)]);
  });
});
