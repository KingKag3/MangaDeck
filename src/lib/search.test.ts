import { describe, expect, it } from 'vitest';
import { queryWords, titleHasWords } from './search';

describe('queryWords', () => {
  it('splits on spaces and punctuation and ignores case and accents', () => {
    expect(queryWords('  Hero, Café!')).toEqual(['hero', 'cafe']);
    expect(queryWords('')).toEqual([]);
  });
});

describe('titleHasWords', () => {
  it('finds a single word anywhere in the title', () => {
    expect(titleHasWords('MY HERO ACADEMIA', ['hero'])).toBe(true);
    expect(titleHasWords('Weak Hero', ['hero'])).toBe(true);
    expect(titleHasWords('The Demon King Overrun by Heroes', ['hero'])).toBe(true);
    expect(titleHasWords('Horimiya', ['hero'])).toBe(false);
  });

  it('needs every word, in any order', () => {
    expect(titleHasWords('The Hero Returns', ['returns', 'hero'])).toBe(true);
    expect(titleHasWords('The Hero Returns', ['hero', 'king'])).toBe(false);
  });

  it('matches everything when there are no words', () => {
    expect(titleHasWords('Anything', [])).toBe(true);
  });
});
