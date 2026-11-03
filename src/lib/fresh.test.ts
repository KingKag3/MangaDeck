import { describe, expect, it } from 'vitest';
import { diffCounts } from './fresh';

describe('diffCounts', () => {
  it('reports only titles that gained chapters, and by how many', () => {
    expect(diffCounts({ '1': 10, '2': 5, '3': 7 }, { '1': 12, '2': 5, '3': 7 })).toEqual({ '1': 2 });
  });

  it('ignores titles that were not there before and titles that shrank', () => {
    expect(diffCounts({ '1': 10, '2': 8 }, { '1': 9, '2': 8, '9': 40 })).toEqual({});
  });
});
