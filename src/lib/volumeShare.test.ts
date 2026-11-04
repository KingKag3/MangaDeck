import { describe, expect, it } from 'vitest';
import { parseRules } from './remoteRules';
import { makeSubmission, submissionFileName, submissionText, validateRanges } from './volumeShare';

const r = (volume: number, first: number, last: number) => ({ volume, first, last });

describe('validateRanges', () => {
  it('accepts a normal list, including a shared boundary chapter and decimal chapters', () => {
    expect(validateRanges([r(1, 1, 5), r(2, 6, 10.5), r(3, 10.5, 14)])).toEqual([]);
  });

  it('rejects an empty list', () => {
    expect(validateRanges([])).toHaveLength(1);
  });

  it('finds duplicates, backwards ranges and overlaps', () => {
    expect(validateRanges([r(1, 1, 5), r(1, 6, 9)]).join(' ')).toMatch(/appears twice/);
    expect(validateRanges([r(1, 9, 5)]).join(' ')).toMatch(/before it starts/);
    expect(validateRanges([r(1, 1, 8), r(2, 5, 12)]).join(' ')).toMatch(/inside volume 1/);
  });

  it('finds numbers that are not numbers', () => {
    expect(validateRanges([r(1, Number.NaN, 5)])).toHaveLength(1);
    expect(validateRanges([r(0, 1, 5)])).toHaveLength(1);
  });
});

describe('makeSubmission and submissionText', () => {
  it('sorts the volumes and writes JSON that reads back the same', () => {
    const s = makeSubmission('  The Boxer ', [r(2, 6, 10), r(1, 1, 5)]);
    expect(s.titles).toEqual(['The Boxer']);
    expect(s.ranges).toEqual([[1, 1, 5], [2, 6, 10]]);
    expect(JSON.parse(submissionText(s))).toEqual(s);
  });

  it('makes a safe file name', () => {
    expect(submissionFileName(makeSubmission('Mushoku Tensei: Jobless/Reincarnation?', [r(1, 1, 2)]))).toBe('volumes-Mushoku-Tensei-Jobless-Reincarnation.json');
    expect(submissionFileName(makeSubmission('???', [r(1, 1, 2)]))).toBe('volumes-series.json');
  });
});

describe('parseRules', () => {
  const good = { titles: ['The Boxer'], page: 'x', ranges: [[1, 1, 5], [2, 6, 10]] };

  it('keeps well-formed rules and drops everything else', () => {
    const bad = [
      null,
      { titles: [], page: 'x', ranges: [[1, 1, 5]] },
      { titles: ['A'], page: 'x', ranges: [] },
      { titles: ['A'], page: 'x', ranges: [[1, 9, 5]] },
      { titles: ['A'], page: 'x', ranges: [[1, 'a', 5]] },
      { titles: ['A'], page: 'y'.repeat(81), ranges: [[1, 1, 5]] },
      { titles: [5], page: 'x', ranges: [[1, 1, 5]] },
    ];
    expect(parseRules([good, ...bad])).toEqual([good]);
    expect(parseRules('nope')).toEqual([]);
  });
});
