import { describe, expect, it } from 'vitest';
import { newVolumeNumbers } from './volumeWatch';

const r = (volume: number) => ({ volume, from: volume * 10, to: volume * 10 + 9 }) as never;

describe('newVolumeNumbers', () => {
  it('lists volumes above the last saved one', () => {
    expect(newVolumeNumbers([r(1), r(2)], [r(1), r(2), r(3), r(4)])).toEqual([3, 4]);
  });
  it('is empty when nothing is new', () => {
    expect(newVolumeNumbers([r(1), r(2)], [r(1), r(2)])).toEqual([]);
  });
  it('ignores volumes below the top one (a corrected list adds nothing)', () => {
    expect(newVolumeNumbers([r(1), r(3)], [r(1), r(2), r(3)])).toEqual([]);
  });
});
