import { describe, expect, it } from 'vitest';
import { dayBucket, timeAgo, toMs } from './format';

describe('toMs', () => {
  it('leaves milliseconds alone and converts seconds', () => {
    expect(toMs('1752668520431')).toBe(1752668520431);
    expect(toMs('1793734105')).toBe(1793734105000);
    expect(toMs('0')).toBe(0);
    expect(toMs(null)).toBe(0);
  });
});

describe('dates', () => {
  it('treat second-based fetchedAt as recent, not 1970', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(dayBucket(String(nowSeconds))).toBe('Today');
    expect(timeAgo(String(nowSeconds - 3 * 3600))).toBe('3h ago');
  });
});
