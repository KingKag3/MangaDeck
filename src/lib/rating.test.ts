import { describe, expect, it } from 'vitest';
import { pickMatch } from './rating';

const c = (english: string | null, romaji: string | null, popularity: number, format = 'MANGA', synonyms: string[] = []) => ({
  title: { english, romaji, native: null },
  synonyms,
  format,
  popularity,
});

describe('pickMatch', () => {
  it('matches by any name, ignoring punctuation and case', () => {
    const list = [c('Kaiju No. 8: B-Side', 'Kaijuu 8-gou: B-Side', 9000), c('Kaiju No. 8', 'Kaijuu 8-gou', 90000)];
    expect(pickMatch(list, 'Kaiju No.8')).toBe(list[1]);
  });
  it('uses synonyms and the romaji name', () => {
    const list = [c(null, 'Shingeki no Kyojin', 500, 'MANGA', ['Attack on Titan'])];
    expect(pickMatch(list, 'attack on titan')).toBe(list[0]);
  });
  it('takes the most read of several exact matches and skips novels', () => {
    const list = [c('Overgeared', null, 100), c('Overgeared', null, 5000, 'NOVEL'), c('Overgeared', null, 800)];
    expect(pickMatch(list, 'Overgeared')).toBe(list[2]);
  });
  it('returns null rather than a near miss', () => {
    expect(pickMatch([c('Kaiju Girl', null, 1000)], 'Kaiju No.8')).toBeNull();
    expect(pickMatch([], 'x')).toBeNull();
  });
});
