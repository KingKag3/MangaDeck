import { describe, expect, it } from 'vitest';
import { META_KEY, candidatesFromMangas, formatRules, mergeRules, norm } from './volumeRulesExport.mjs';

const meta = (info) => [{ key: META_KEY, value: JSON.stringify(info) }];
const manga = (title, info) => ({ id: 1, title, meta: info ? meta(info) : [] });
const ranges = (rows) => rows.map(([volume, first, last]) => ({ volume, first, last }));

describe('candidatesFromMangas', () => {
  it('keeps hand-made lists only, as sorted [volume, first, last] rows', () => {
    const found = candidatesFromMangas([
      manga('Typed In', { source: 'manual', ranges: ranges([[2, 6, 10], [1, 1, 5]]) }),
      manga('From Wikipedia', { source: 'wikipedia', ranges: ranges([[1, 1, 5]]) }),
      manga('From The Rules', { source: 'rule', ranges: ranges([[1, 1, 5]]) }),
      manga('No Volumes', null),
      manga('Broken', { source: 'manual', ranges: [] }),
    ]);
    expect(found).toEqual([{ title: 'Typed In', ranges: [[1, 1, 5], [2, 6, 10]] }]);
  });

  it('skips unreadable meta and rows without numbers', () => {
    const bad = { id: 2, title: 'Bad', meta: [{ key: META_KEY, value: '{nope' }] };
    const odd = manga('Odd', { source: 'manual', ranges: [{ volume: 1, first: 1, last: 5 }, { volume: 2 }] });
    expect(candidatesFromMangas([bad, odd])).toEqual([{ title: 'Odd', ranges: [[1, 1, 5]] }]);
  });
});

describe('mergeRules', () => {
  const existing = [{ titles: ['Solo Leveling'], page: 'Wiki', ranges: [[1, 0, 12], [2, 13, 26]] }];

  it('adds a new series as a new rule', () => {
    const { rules, report } = mergeRules(existing, [{ title: 'New Series', ranges: [[1, 1, 7]] }]);
    expect(report.added).toEqual(['New Series']);
    expect(rules).toHaveLength(2);
    expect(rules[1].titles).toEqual(['New Series']);
  });

  it('replaces the ranges of a series it already knows when they changed, ignoring title punctuation', () => {
    const { rules, report } = mergeRules(existing, [{ title: 'solo-leveling', ranges: [[1, 0, 12], [2, 13, 26], [3, 27, 44]] }]);
    expect(report.updated).toEqual(['solo-leveling']);
    expect(rules[0].ranges).toHaveLength(3);
    expect(rules).toHaveLength(1);
  });

  it('adds a second title to a rule that has the same list, and leaves identical lists alone', () => {
    const { rules, report } = mergeRules(existing, [
      { title: 'Na Honjaman Level-Up', ranges: [[1, 0, 12], [2, 13, 26]] },
      { title: 'Solo Leveling', ranges: [[1, 0, 12], [2, 13, 26]] },
    ]);
    expect(report.aliased).toEqual(['Na Honjaman Level-Up']);
    expect(report.updated).toEqual([]);
    expect(rules[0].titles).toEqual(['Solo Leveling', 'Na Honjaman Level-Up']);
  });

  it('does not change what it was given', () => {
    const copy = JSON.stringify(existing);
    mergeRules(existing, [{ title: 'X', ranges: [[1, 1, 2]] }]);
    expect(JSON.stringify(existing)).toBe(copy);
  });
});

describe('formatRules', () => {
  it('writes JSON that reads back the same, with eight rows to a line', () => {
    const rules = [{ titles: ['A', 'B'], page: 'P', ranges: Array.from({ length: 10 }, (_, i) => [i + 1, i * 5 + 1, i * 5 + 5]) }];
    const text = formatRules(rules);
    expect(JSON.parse(text)).toEqual(rules);
    expect(text.split('\n').filter((l) => l.includes('[1, 1, 5]'))).toHaveLength(1);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n').filter((l) => /^ {6}\[/.test(l))).toHaveLength(2); // 10 rows -> 8 + 2
  });
});

describe('norm', () => {
  it('compares titles loosely', () => {
    expect(norm('Mushoku Tensei: Jobless Reincarnation')).toBe(norm('MUSHOKU TENSEI - Jobless  Reincarnation'));
  });
});
