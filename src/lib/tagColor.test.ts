import { describe, expect, it } from 'vitest';
import { tagColor, tagHue } from './tagColor';

describe('tagHue', () => {
  it('gives familiar genres a colour that fits, ignoring case and spacing', () => {
    expect(tagHue('Action')).toBe(tagHue(' action '));
    expect(tagHue('Romance')).toBe(328);
    expect(tagHue('Comedy')).toBe(48);
    expect(tagHue('Horror')).toBe(300);
    expect(tagHue('Fantasy')).toBe(275);
    expect(tagHue('Sci-Fi')).toBe(185);
    expect(tagHue('Slice of Life')).toBe(118);
  });

  it('puts adult tags and gore apart from ordinary ones, and matches words inside longer tags', () => {
    expect(tagHue('Sexual Harassment')).toBe(340);
    expect(tagHue('Ecchi')).toBe(340);
    expect(tagHue('Gore')).toBe(355);
    expect(tagHue('Comedic Violence')).toBe(355); // the specific word wins over the mild one
    expect(tagHue('Urban Fantasy')).toBe(275);
  });

  it('gives other tags a steady colour from their name', () => {
    const a = tagHue('Zebra Crossing');
    expect(a).toBe(tagHue('zebra crossing'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
    expect(tagHue('Zebra Crossing')).not.toBe(tagHue('Quantum Pickles'));
  });
});

describe('tagColor', () => {
  it('is a CSS colour', () => {
    expect(tagColor('Action')).toMatch(/^hsl\(\d+ 70% 68%\)$/);
  });
});
