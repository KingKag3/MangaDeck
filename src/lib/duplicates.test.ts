import { describe, expect, it } from 'vitest';
import { findDuplicates, titleKey } from './duplicates';
import { groupsAcrossLibrary } from './groups';

describe('titleKey', () => {
  it('ignores case, accents, punctuation, notes in brackets and a leading The', () => {
    expect(titleKey('The Boxer')).toBe(titleKey('boxer (Official)'));
    expect(titleKey('Pokémon: Adventures')).toBe(titleKey('Pokemon Adventures'));
    expect(titleKey("Frieren: Beyond Journey's End")).toBe(titleKey('frieren beyond journeys end [Color]'));
  });
  it('keeps sequels and spin-offs apart', () => {
    expect(titleKey('Solo Leveling')).not.toBe(titleKey('Solo Leveling: Ragnarok'));
  });
});

describe('findDuplicates', () => {
  it('groups entries with the same key and skips empty titles', () => {
    const list = [{ title: 'Dandadan' }, { title: 'DANDADAN (Official)' }, { title: 'Solo Leveling' }, { title: 'Solo Leveling: Ragnarok' }, { title: '!!!' }, { title: '???' }];
    const d = findDuplicates(list);
    expect(d).toHaveLength(1);
    expect(d[0].map((m) => m.title)).toEqual(['Dandadan', 'DANDADAN (Official)']);
  });
});

describe('groupsAcrossLibrary', () => {
  it('counts series once per group and orders by series then chapters', () => {
    const m = (...g: (string | null)[]) => ({ chapters: { nodes: g.map((scanlator) => ({ scanlator })) } });
    const out = groupsAcrossLibrary([m('Delta', 'Delta', 'Alpha'), m('Delta'), m('Alpha', null)]);
    expect(out).toEqual([
      { name: 'Delta', series: 2, chapters: 3 },
      { name: 'Alpha', series: 2, chapters: 2 },
      { name: 'Unknown group', series: 1, chapters: 1 },
    ]);
  });
});
