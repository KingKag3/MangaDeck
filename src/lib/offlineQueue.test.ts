import { beforeEach, describe, expect, it } from 'vitest';
import { responseKey } from './offlineDb';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

const { pendingProgressCount, queueProgress, readPending } = await import('./offlineQueue');

describe('queued reading progress', () => {
  beforeEach(() => store.clear());

  it('keeps the latest page and never turns a chapter back to unread', () => {
    queueProgress(5, { lastPageRead: 3 });
    queueProgress(5, { lastPageRead: 9, isRead: true });
    queueProgress(5, { lastPageRead: 2 });
    expect(readPending()['5']).toEqual({ lastPageRead: 2, isRead: true });
    queueProgress(6, { lastPageRead: 1 });
    expect(pendingProgressCount()).toBe(2);
  });

  it('survives a corrupt saved value', () => {
    store.set('mangadeck.pendingProgress', '{nope');
    expect(readPending()).toEqual({});
  });
});

describe('responseKey', () => {
  it('ignores whitespace in the query and tells variables apart', () => {
    expect(responseKey('{ a   b }', { id: 1 })).toBe(responseKey('{ a b }', { id: 1 }));
    expect(responseKey('{ a }', { id: 1 })).not.toBe(responseKey('{ a }', { id: 2 }));
    expect(responseKey('{ a }', undefined)).toBe(responseKey('{ a }', {}));
  });
});
