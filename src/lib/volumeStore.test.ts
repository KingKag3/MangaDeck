import { describe, expect, it } from 'vitest';
import { chooseSync, volumeInfoFromMeta, META_KEY } from './volumeStore';
import { findVolumeRule } from './volumeRules';
import type { VolumeInfo } from './volumes';

const info = (savedAt?: number): VolumeInfo => ({
  source: 'manual',
  page: 'entered by hand',
  savedAt,
  ranges: [{ volume: 1, first: 1, last: 5 }],
});

describe('volumeInfoFromMeta', () => {
  it('reads the saved map from the manga meta', () => {
    const meta = [
      { key: 'other', value: 'x' },
      { key: META_KEY, value: JSON.stringify(info(5)) },
    ];
    expect(volumeInfoFromMeta(meta)?.ranges).toEqual([{ volume: 1, first: 1, last: 5 }]);
  });

  it('is null when missing, broken or empty', () => {
    expect(volumeInfoFromMeta(undefined)).toBeNull();
    expect(volumeInfoFromMeta([])).toBeNull();
    expect(volumeInfoFromMeta([{ key: META_KEY, value: 'not json' }])).toBeNull();
    expect(volumeInfoFromMeta([{ key: META_KEY, value: JSON.stringify({ ranges: [] }) }])).toBeNull();
  });
});

describe('chooseSync', () => {
  it('pulls when only the server has it, pushes when only this browser does', () => {
    expect(chooseSync(undefined, info(1))).toBe('pull');
    expect(chooseSync(info(1), null)).toBe('push');
    expect(chooseSync(undefined, null)).toBe('none');
  });

  it('keeps the newest when both have one', () => {
    expect(chooseSync(info(10), info(20))).toBe('pull');
    expect(chooseSync(info(30), info(20))).toBe('push');
    expect(chooseSync(info(20), info(20))).toBe('none');
    expect(chooseSync(info(), info(20))).toBe('pull'); // an old copy without a date loses
  });
});

describe('findVolumeRule', () => {
  it('finds a series by any of its titles, ignoring case and punctuation', () => {
    expect(findVolumeRule('Mushoku Tensei - Jobless Reincarnation')?.ranges).toHaveLength(25);
    expect(findVolumeRule('MUSHOKU TENSEI: JOBLESS REINCARNATION')?.source).toBe('rule');
    expect(findVolumeRule('solo leveling')?.ranges).toHaveLength(15);
  });

  it('returns null for other series and a copy that is safe to change', () => {
    expect(findVolumeRule('Dandadan')).toBeNull();
    expect(findVolumeRule('')).toBeNull();
    const a = findVolumeRule('Solo Leveling')!;
    a.ranges[0].last = 999;
    expect(findVolumeRule('Solo Leveling')!.ranges[0].last).toBe(12);
  });
});
