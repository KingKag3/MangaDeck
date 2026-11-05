import { describe, expect, it } from 'vitest';
import { needsDecision, type ExportJob } from './exportJobs';

const job = (p: Partial<ExportJob>): ExportJob => ({
  id: 'j',
  mangaId: 1,
  title: 'T',
  volume: 0,
  fileName: 'T.cbz',
  items: [],
  meta: {},
  todo: [],
  parked: [],
  round: 1,
  phase: 'downloading',
  state: 'running',
  done: 0,
  packed: 0,
  failStreak: 0,
  createdAt: 0,
  ...p,
});

describe('needsDecision', () => {
  it('is true only when paused with nothing left but set-aside chapters', () => {
    expect(needsDecision(job({ state: 'paused', parked: [3] }))).toBe(true);
    expect(needsDecision(job({ state: 'paused', parked: [3], todo: [4] }))).toBe(false);
    expect(needsDecision(job({ state: 'running', parked: [3] }))).toBe(false);
    expect(needsDecision(job({ state: 'paused', parked: [] }))).toBe(false);
    expect(needsDecision(job({ state: 'paused', parked: [3], phase: 'packing' }))).toBe(false);
  });
});
