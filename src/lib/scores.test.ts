import { describe, expect, it } from 'vitest';
import { byScore } from './scores';

describe('score order', () => {
  it('puts the best first and titles without a score last', () => {
    const list: [string, number | null | undefined][] = [['a', 70], ['b', null], ['c', 91], ['d', undefined], ['e', 85]];
    expect([...list].sort((x, y) => byScore(x[1], y[1])).map((x) => x[0]).slice(0, 3)).toEqual(['c', 'e', 'a']);
    expect(byScore(null, 0)).toBeGreaterThan(0);
  });
});
