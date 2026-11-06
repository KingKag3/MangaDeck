import { describe, expect, it } from 'vitest';
import { authorizeUrl, nextEntry, parseCallback, progressOf } from './tracker';

describe('AniList sign-in', () => {
  it('builds the authorize address from the client id', () => {
    expect(authorizeUrl(' 12345 ')).toBe('https://anilist.co/api/v2/oauth/authorize?client_id=12345&response_type=token');
  });
  it('reads the token and its lifetime from the callback address', () => {
    const r = parseCallback('#access_token=abc.def&token_type=Bearer&expires_in=3600', 1000);
    expect(r).toEqual({ token: 'abc.def', expiresAt: 1000 + 3600 * 1000 });
  });
  it('falls back to a year when no lifetime is given, and rejects an address without a token', () => {
    expect(parseCallback('#access_token=x', 0)?.expiresAt).toBe(365 * 86400 * 1000);
    expect(parseCallback('#error=access_denied')).toBeNull();
    expect(parseCallback('')).toBeNull();
  });
});

describe('progress rules', () => {
  it('counts whole chapters', () => {
    expect(progressOf(12.5)).toBe(12);
    expect(progressOf(0.5)).toBe(0);
  });
  it('never lowers progress or writes the same number again', () => {
    expect(nextEntry({ progress: 50, status: 'CURRENT' }, 40, null)).toBeNull();
    expect(nextEntry({ progress: 50, status: 'CURRENT' }, 50, null)).toBeNull();
    expect(nextEntry(null, 0, null)).toBeNull();
  });
  it('starts a series as CURRENT and keeps the status of a finished one being re-read', () => {
    expect(nextEntry(null, 3, null)).toEqual({ progress: 3, status: 'CURRENT' });
    expect(nextEntry({ progress: 2, status: 'PLANNING' }, 3, 100)).toEqual({ progress: 3, status: 'CURRENT' });
    expect(nextEntry({ progress: 100, status: 'COMPLETED' }, 101, null)).toEqual({ progress: 101 });
  });
  it('completes a series when the last chapter is reached', () => {
    expect(nextEntry({ progress: 98, status: 'CURRENT' }, 100, 100)).toEqual({ progress: 100, status: 'COMPLETED' });
    expect(nextEntry(null, 8, 8)).toEqual({ progress: 8, status: 'COMPLETED' });
  });
});
