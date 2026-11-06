import { describe, expect, it } from 'vitest';
import { altNote, needsDecision, packId, type ExportJob } from './exportJobs';

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

describe('linked-source substitutes', () => {
  const items = [1, 2, 3].map((id) => ({ id, chapterNumber: id, volume: null, label: `Ch ${id}` }));
  it('packs the linked copy only for chapters that were substituted', () => {
    const j = job({ items, alt: { '2': { id: 99, source: 'MangaDex' } } });
    expect([1, 2, 3].map((i) => packId(j, i))).toEqual([1, 99, 3]);
  });
  it('describes the substitutes for the history', () => {
    expect(altNote(job({ items }))).toBe('');
    expect(altNote(job({ items, alt: { '2': { id: 99, source: 'MangaDex' }, '3': { id: 98, source: 'MangaDex' } } }))).toBe(
      '. 2 chapters came from other sources (MangaDex)',
    );
  });
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
