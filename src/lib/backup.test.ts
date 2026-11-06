import { describe, expect, it } from 'vitest';
import { applyBackup, buildBackup, describeBackup, parseBackup } from './backup';

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('backup', () => {
  it('round-trips the listed keys and leaves tokens and the server address out', () => {
    const a = memory({
      'mangadeck.settings': JSON.stringify({ groups: { '38': { group: 'Delta', fill: true } }, volumes: { '1': {} }, links: {}, perManga: {} }),
      'mangadeck.history': JSON.stringify([{ title: 'x' }]),
      'mangadeck.access': 'secret-token',
      'mangadeck.server': 'http://10.0.0.5:4567',
      'mangadeck.libview': 'not json',
    });
    const file = buildBackup(a, new Date('2026-11-06T10:00:00Z'));
    expect(Object.keys(file.data).sort()).toEqual(['mangadeck.history', 'mangadeck.settings']);
    expect(JSON.stringify(file)).not.toContain('secret-token');

    const b = memory({ 'mangadeck.access': 'mine' });
    expect(applyBackup(b, parseBackup(JSON.stringify(file)))).toBe(2);
    expect(JSON.parse(b.m.get('mangadeck.settings')!).groups['38'].group).toBe('Delta');
    expect(b.m.get('mangadeck.access')).toBe('mine');
    expect(describeBackup(file)).toBe('1 volume lists, 1 group choices, 0 linked series, 0 reader overrides, 1 history entries');
  });

  it('rejects files that are not backups, are newer, or are empty', () => {
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"a":1}')).toThrow(/not a Mangadeck backup/);
    expect(() => parseBackup('[]')).toThrow(/not a Mangadeck backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'mangadeck', version: 2, data: {} }))).toThrow(/newer/);
    expect(() => parseBackup(JSON.stringify({ app: 'mangadeck', version: 1, data: { 'mangadeck.access': 'x' } }))).toThrow(/nothing/);
  });

  it('ignores unknown keys when applying', () => {
    const s = memory();
    const n = applyBackup(s, { app: 'mangadeck', version: 1, savedAt: '', data: { 'mangadeck.access': 'x', 'mangadeck.merged': { a: 'b' } } });
    expect(n).toBe(1);
    expect(s.m.has('mangadeck.access')).toBe(false);
  });
});
