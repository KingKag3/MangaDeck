import { describe, expect, it } from 'vitest';
import { PRESETS, backoffMs, estimateWaitMs, formatDuration, paceConfig, waitMs } from './pacer';

const mid = () => 0.5; // no jitter
const low = () => 0;
const high = () => 1;

describe('waitMs', () => {
  const cfg = { delay: 20, jitter: 0.3, breakEvery: 15, breakSecs: 120 };

  it('waits the delay with no jitter at the midpoint', () => {
    expect(waitMs(cfg, 1, mid)).toBe(20_000);
  });

  it('spreads by the jitter on both sides', () => {
    expect(waitMs(cfg, 1, low)).toBe(14_000);
    expect(waitMs(cfg, 1, high)).toBe(26_000);
  });

  it('takes the long break after every N chapters instead of the short wait', () => {
    expect(waitMs(cfg, 15, mid)).toBe(120_000);
    expect(waitMs(cfg, 30, mid)).toBe(120_000);
    expect(waitMs(cfg, 16, mid)).toBe(20_000);
  });

  it('never breaks when breakEvery is 0', () => {
    expect(waitMs({ ...cfg, breakEvery: 0 }, 15, mid)).toBe(20_000);
  });
});

describe('backoffMs', () => {
  it('doubles from one minute and caps at 30', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]);
  });
});

describe('estimateWaitMs', () => {
  it('counts short waits and long breaks between chapters', () => {
    const cfg = { delay: 10, jitter: 0, breakEvery: 5, breakSecs: 60 };
    expect(estimateWaitMs(cfg, 1)).toBe(0);
    expect(estimateWaitMs(cfg, 4)).toBe(30_000);
    // 10 chapters = 9 gaps, one of them a long break
    expect(estimateWaitMs(cfg, 10)).toBe(8 * 10_000 + 60_000);
  });
});

describe('paceConfig', () => {
  const custom = { delay: 5, jitter: 0, breakEvery: 0, breakSecs: 0 };
  it('uses the preset, or the custom numbers', () => {
    expect(paceConfig({ pacePreset: 'gentle', paceCustom: custom })).toBe(PRESETS.gentle);
    expect(paceConfig({ pacePreset: 'custom', paceCustom: custom })).toBe(custom);
  });
});

describe('formatDuration', () => {
  it('reads naturally', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(5 * 60_000)).toBe('5 min');
    expect(formatDuration(95 * 60_000)).toBe('1 h 35 min');
  });
});
