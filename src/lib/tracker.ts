import { useSyncExternalStore } from 'react';
import { pickMatch } from './rating';

/**
 * AniList tracking: reading a chapter to the end (or marking it read) updates your AniList list.
 *
 * Sign-in is AniList's own browser flow (you register a small "client" at anilist.co/settings/developer, paste its ID in
 * Settings, press Connect, and approve). The token it returns is kept in this browser only and is sent to
 * graphql.anilist.co and nowhere else. Progress only ever moves forward: it is never lowered, and a COMPLETED entry stays so.
 */

const ENDPOINT = 'https://graphql.anilist.co';
const AUTH_KEY = 'mangadeck.anilist';
const LINKS_KEY = 'mangadeck.tracker';
const QUEUE_KEY = 'mangadeck.trackerQueue';

export interface Auth {
  clientId: string;
  token: string;
  expiresAt: number;
  name: string;
}

export interface TrackLink {
  mediaId: number;
  title: string;
  /** Chapters AniList knows the series has (null while it is running). */
  total: number | null;
  url: string;
}

interface Stored {
  clientId: string;
  token: string;
  expiresAt: number;
  name: string;
  links: Record<string, TrackLink>;
  /** Progress that could not be sent because AniList was unreachable: series id -> whole chapter number. */
  queue: Record<string, number>;
}

function load(): Stored {
  const empty: Stored = { clientId: '', token: '', expiresAt: 0, name: '', links: {}, queue: {} };
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}');
    const l = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}');
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '{}');
    return { ...empty, ...a, links: l && typeof l === 'object' ? l : {}, queue: q && typeof q === 'object' ? q : {} };
  } catch {
    return empty;
  }
}

let state = load();
let snapshot = state;
const listeners = new Set<() => void>();

function save() {
  snapshot = { ...state };
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ clientId: state.clientId, token: state.token, expiresAt: state.expiresAt, name: state.name }));
    localStorage.setItem(LINKS_KEY, JSON.stringify(state.links));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useTracker(): Stored {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

export const isConnected = (s: Pick<Stored, 'token' | 'expiresAt'> = state) => !!s.token && s.expiresAt > Date.now();
export const getLink = (mangaId: number): TrackLink | undefined => state.links[String(mangaId)];

/* ---------- sign-in ---------- */

export const redirectUrl = () => `${window.location.origin}/anilist`;

export function setClientId(id: string) {
  state = { ...state, clientId: id.trim() };
  save();
}

export function authorizeUrl(clientId: string): string {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId.trim())}&response_type=token`;
}

/** Reads "#access_token=…&token_type=Bearer&expires_in=…" from the page AniList sends you back to. */
export function parseCallback(hash: string, now = Date.now()): { token: string; expiresAt: number } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const token = p.get('access_token');
  if (!token) return null;
  const secs = Number(p.get('expires_in'));
  return { token, expiresAt: now + (Number.isFinite(secs) && secs > 0 ? secs : 365 * 86400) * 1000 };
}

/** A failure worth trying again later: AniList unreachable, rate limited or erroring. */
export class RetryError extends Error {}

async function call<T>(query: string, variables: Record<string, unknown>, authed = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(authed && state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new RetryError('Could not reach AniList.');
  }
  if (res.status === 401 || res.status === 400) {
    const j = await res.json().catch(() => null);
    const msg = j?.errors?.[0]?.message ?? `AniList responded ${res.status}`;
    if (/invalid token|unauthori[sz]ed/i.test(msg)) disconnect();
    throw new Error(msg);
  }
  if (res.status === 429 || res.status >= 500) throw new RetryError(`AniList responded ${res.status}`);
  if (!res.ok) throw new Error(`AniList responded ${res.status}`);
  const json = await res.json();
  if (json.errors?.length && !json.data) throw new Error(json.errors[0].message);
  return json.data as T;
}

/** Store the token from the callback page and look up who it belongs to. */
export async function connect(token: string, expiresAt: number): Promise<string> {
  state = { ...state, token, expiresAt, name: '' };
  const d = await call<{ Viewer: { name: string } }>('query{Viewer{name}}', {});
  state = { ...state, name: d.Viewer.name };
  save();
  return d.Viewer.name;
}

export function disconnect() {
  state = { ...state, token: '', expiresAt: 0, name: '' };
  save();
}

/* ---------- matching a series ---------- */

export interface Candidate {
  id: number;
  title: string;
  format: string | null;
  chapters: number | null;
  url: string;
  cover: string | null;
}

interface Raw {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[] | null;
  format: string | null;
  popularity: number | null;
  chapters: number | null;
  siteUrl: string;
  coverImage: { medium: string | null } | null;
}

const SEARCH = `query($s:String){Page(perPage:8){media(search:$s,type:MANGA){id title{romaji english native} synonyms format popularity chapters siteUrl coverImage{medium}}}}`;
const toCandidate = (r: Raw): Candidate => ({ id: r.id, title: r.title.english || r.title.romaji || r.title.native || '', format: r.format, chapters: r.chapters, url: r.siteUrl, cover: r.coverImage?.medium ?? null });

export async function searchAniList(title: string): Promise<{ best: Candidate | null; all: Candidate[] }> {
  const d = await call<{ Page: { media: Raw[] } }>(SEARCH, { s: title }, false);
  const media = d.Page.media;
  const best = pickMatch(media, title);
  return { best: best ? toCandidate(best) : null, all: media.filter((m) => m.format !== 'NOVEL').map(toCandidate) };
}

export function setLink(mangaId: number, c: Candidate | null) {
  const links = { ...state.links };
  if (c === null) delete links[String(mangaId)];
  else links[String(mangaId)] = { mediaId: c.id, title: c.title, total: c.chapters, url: c.url };
  state = { ...state, links };
  save();
}

/** Link a series to the AniList entry whose name equals its title, if there is exactly such an entry. Returns the link or null. */
export async function autoLink(mangaId: number, title: string): Promise<TrackLink | null> {
  if (!isConnected() || getLink(mangaId)) return getLink(mangaId) ?? null;
  const { best } = await searchAniList(title);
  if (!best) return null;
  setLink(mangaId, best);
  return getLink(mangaId) ?? null;
}

/* ---------- pushing progress ---------- */

type Entry = { progress: number; status: string | null } | null;

/** What to write for a new progress number, or null when nothing should change (never lower progress). */
export function nextEntry(entry: Entry, progress: number, total: number | null): { progress: number; status?: string } | null {
  if (progress < 1) return null;
  if (entry && progress <= entry.progress) return null;
  const done = total != null && total > 0 && progress >= total;
  if (done) return { progress, status: 'COMPLETED' };
  if (entry?.status === 'COMPLETED' || entry?.status === 'REPEATING') return { progress }; // a re-read: keep their status
  return { progress, status: 'CURRENT' };
}

/** The whole chapter number AniList counts for a chapter such as 12.5 (progress counts whole chapters). */
export const progressOf = (chapterNumber: number) => Math.floor(chapterNumber);

export type PushResult = { ok: true; progress: number; changed: boolean } | { ok: false; reason: string; retry?: boolean };

/** The queue with this progress added (the highest number per series wins). */
export function queueMerge(queue: Record<string, number>, mangaId: number, progress: number): Record<string, number> {
  const key = String(mangaId);
  if (!(progress >= 1) || (queue[key] ?? 0) >= progress) return queue;
  return { ...queue, [key]: progress };
}

function enqueue(mangaId: number, progress: number) {
  const queue = queueMerge(state.queue, mangaId, progress);
  if (queue === state.queue) return;
  state = { ...state, queue };
  save();
}

function dequeue(mangaId: string, upTo: number) {
  if (!(mangaId in state.queue) || state.queue[mangaId] > upTo) return; // a newer number arrived meanwhile
  const queue = { ...state.queue };
  delete queue[mangaId];
  state = { ...state, queue };
  save();
}

export const queuedCount = (s: Pick<Stored, 'queue'> = state) => Object.keys(s.queue).length;

/** Set the AniList progress for a series to this chapter number, if it is ahead of what AniList has. */
let chain: Promise<unknown> = Promise.resolve();
export function pushProgress(mangaId: number, chapterNumber: number, keepForRetry = true): Promise<PushResult> {
  // One at a time, so two quick updates cannot cross and lower the progress.
  const run = chain.then(async () => {
    const r = await push(mangaId, chapterNumber);
    if (r.ok) dequeue(String(mangaId), progressOf(chapterNumber));
    else if (r.retry && keepForRetry) enqueue(mangaId, progressOf(chapterNumber));
    return r;
  });
  chain = run.catch(() => undefined);
  return run;
}

async function push(mangaId: number, chapterNumber: number): Promise<PushResult> {
  const link = getLink(mangaId);
  if (!isConnected()) return { ok: false, reason: 'Not connected to AniList.' };
  if (!link) return { ok: false, reason: 'This series is not linked to an AniList entry.' };
  const progress = progressOf(chapterNumber);
  try {
    const d = await call<{ Media: { chapters: number | null; mediaListEntry: Entry } }>(
      'query($id:Int){Media(id:$id){chapters mediaListEntry{progress status}}}',
      { id: link.mediaId },
    );
    const next = nextEntry(d.Media.mediaListEntry, progress, d.Media.chapters ?? link.total);
    if (!next) return { ok: true, progress, changed: false };
    await call(
      'mutation($m:Int,$p:Int,$s:MediaListStatus){SaveMediaListEntry(mediaId:$m,progress:$p,status:$s){id}}',
      { m: link.mediaId, p: next.progress, s: next.status ?? null },
    );
    return { ok: true, progress, changed: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e), retry: e instanceof RetryError };
  }
}

/** Fire and forget: called when a chapter is read to the end or marked read. Quiet when not connected or not linked. */
export function trackRead(mangaId: number, chapterNumber: number) {
  if (!isConnected() || !getLink(mangaId) || !(chapterNumber >= 1)) return;
  void pushProgress(mangaId, chapterNumber).then((r) => {
    if (r.ok) void flushQueue(); // AniList is reachable again: send what was waiting
  });
}

let flushing = false;
/** Send the progress that was waiting for AniList. Returns how many series were updated. */
export async function flushQueue(): Promise<number> {
  if (flushing || !isConnected()) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const [id, progress] of Object.entries(state.queue)) {
      const r = await pushProgress(Number(id), progress, false);
      if (r.ok) {
        if (r.changed) sent++;
      } else if (r.retry) break; // still unreachable: keep everything for next time
      else dequeue(id, progress); // not linked any more, or refused: do not keep trying
    }
  } finally {
    flushing = false;
  }
  return sent;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushQueue());
  setTimeout(() => void flushQueue(), 3000);
  setInterval(() => {
    if (queuedCount()) void flushQueue();
  }, 5 * 60_000);
}

/* ---------- pulling progress from AniList ---------- */

/** The chapter AniList says you have reached for a linked series, or null when it has no entry for you. */
export async function fetchRemoteProgress(mangaId: number): Promise<number | null> {
  const link = getLink(mangaId);
  if (!link || !isConnected()) throw new Error('Not connected, or this series is not linked to AniList.');
  const d = await call<{ Media: { mediaListEntry: { progress: number } | null } }>('query($id:Int){Media(id:$id){mediaListEntry{progress}}}', { id: link.mediaId });
  return d.Media.mediaListEntry?.progress ?? null;
}

/** Ids of the unread chapters that AniList progress already covers (whole chapters; extras such as 12.5 count with 12). */
export function chaptersToMark(chapters: { id: number; chapterNumber: number; isRead: boolean }[], progress: number): number[] {
  return chapters.filter((c) => !c.isRead && c.chapterNumber >= 1 && progressOf(c.chapterNumber) <= progress).map((c) => c.id);
}
