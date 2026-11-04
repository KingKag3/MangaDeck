import { describe, expect, it } from 'vitest';
import { chooseSync, volumeInfoFromMeta, META_KEY, META_LIMIT, serverCopy } from './volumeStore';
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

describe('serverCopy', () => {
  const big = (volumes: number, titlesPer: number): VolumeInfo => ({
    source: 'wikipedia',
    page: 'Gachiakuta',
    savedAt: 1,
    ranges: Array.from({ length: volumes }, (_, i) => ({
      volume: i + 1,
      first: i * 10 + 1,
      last: i * 10 + 10,
      released: '2024-01-16',
      isbn: '978-4-06-527922-9',
      titles: Object.fromEntries(Array.from({ length: titlesPer }, (_, k) => [i * 10 + k + 1, `A chapter title number ${k + 1}`])),
    })),
  });

  it('keeps everything when it fits', () => {
    const v = serverCopy(big(3, 4))!;
    expect(v.length).toBeLessThanOrEqual(META_LIMIT);
    expect(JSON.parse(v).ranges[0].titles).toBeDefined();
    expect(JSON.parse(v).slim).toBeUndefined();
  });

  it('drops the chapter titles first (and says so) when the whole thing is too long', () => {
    const v = JSON.parse(serverCopy(big(19, 9))!);
    expect(v.slim).toBe(true);
    expect(v.ranges).toHaveLength(19);
    expect(v.ranges[0].titles).toBeUndefined();
    expect(v.ranges[0].released).toBe('2024-01-16');
  });

  it('then drops dates and ISBNs, but never the volume ranges, and gives up only past the limit', () => {
    const s = serverCopy(big(60, 0))!;
    const v = JSON.parse(s);
    expect(s.length).toBeLessThanOrEqual(META_LIMIT);
    expect(v.ranges).toHaveLength(60);
    expect(v.ranges[0]).toEqual({ volume: 1, first: 1, last: 10 });
    expect(serverCopy(big(400, 0))).toBeNull();
  });
});
