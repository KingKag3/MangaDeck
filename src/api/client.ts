// Minimal GraphQL client for Suwayomi-Server.
// - Server URL defaults to same-origin (/api/graphql) so the Docker nginx / Vite dev proxy just works.
// - Supports UI_LOGIN (JWT bearer + refresh). BASIC_AUTH / SIMPLE_LOGIN work through the browser itself.

import { clearResponses, readResponse, responseKey, saveResponse } from '../lib/offlineDb';

const LS = {
  server: 'mangadeck.server',
  access: 'mangadeck.access',
  refresh: 'mangadeck.refresh',
};

export const UNAUTHORIZED_EVENT = 'mangadeck:unauthorized';
export const OFFLINE_EVENT = 'mangadeck:offline';

// True while the server cannot be reached and answers come from the last saved copy (see gql below).
let offline = false;
let since: number | null = null;
export const isOffline = () => offline;
export const offlineSince = () => since;
function setOffline(v: boolean, at: number | null = null) {
  if (v === offline && at === since) return;
  offline = v;
  since = v ? at : null;
  window.dispatchEvent(new Event(OFFLINE_EVENT));
}

/** True for "could not reach the server" (a failed fetch, or the proxy answering 502/503/504). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof GqlError && !!e.status && [0, 502, 503, 504].includes(e.status));
}

export function getServer(): string {
  try {
    return (localStorage.getItem(LS.server) ?? '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setServer(value: string) {
  localStorage.setItem(LS.server, value.trim().replace(/\/+$/, ''));
}

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(LS.access);
  } catch {
    return null;
  }
}

export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(LS.access, access);
  if (refresh) localStorage.setItem(LS.refresh, refresh);
}

export function clearTokens() {
  localStorage.removeItem(LS.access);
  localStorage.removeItem(LS.refresh);
  void clearResponses(); // saved answers belong to the signed-in user
}

/** Turn a server-relative path ("/api/v1/manga/1/thumbnail") into a loadable URL. */
export function resolveUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return `${getServer()}${path.startsWith('/') ? '' : '/'}${path}`;
}

export class GqlError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GqlError';
    this.status = status;
  }
}

async function post(query: string, variables: unknown, token: string | null): Promise<Response> {
  return fetch(`${getServer()}/api/graphql`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(LS.refresh);
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await post(
          'mutation($t:String!){refreshToken(input:{refreshToken:$t}){accessToken}}',
          { t: refreshToken },
          null,
        );
        if (!res.ok) return false;
        const json = await res.json();
        const access = json?.data?.refreshToken?.accessToken as string | undefined;
        if (!access) return false;
        setTokens(access);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

function unauthorized(): never {
  clearTokens();
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  throw new GqlError('Not authorized', 401);
}

/**
 * Run a query. Reads are remembered; when the server cannot be reached the last remembered answer is returned instead
 * (and the app shows the offline banner). Mutations are never faked: they throw.
 */
export async function gql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const isMutation = /^s*mutation/.test(query);
  const key = isMutation ? '' : responseKey(query, variables);
  const fallback = async (err: unknown): Promise<T> => {
    const hit = key ? await readResponse(key) : null;
    if (!hit) throw err;
    setOffline(true, hit.at);
    return hit.data as T;
  };

  let res: Response;
  try {
    res = await post(query, variables ?? {}, getAccessToken());
  } catch (e) {
    return fallback(e);
  }
  // A gateway timeout (502/503/504) usually means a slow source or a busy server: ask again a couple of times first.
  for (const wait of navigator.onLine ? [1500, 4000] : []) {
    if (![502, 503, 504].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, wait));
    try {
      res = await post(query, variables ?? {}, getAccessToken());
    } catch (e) {
      return fallback(e);
    }
  }
  if ([502, 503, 504].includes(res.status)) return fallback(new GqlError(`Server responded ${res.status} ${res.statusText}`, res.status));
  if (res.status === 401) {
    if (await tryRefresh()) res = await post(query, variables ?? {}, getAccessToken());
    if (res.status === 401) unauthorized();
  }
  if (!res.ok) throw new GqlError(`Server responded ${res.status} ${res.statusText}`, res.status);
  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors.map((e: { message: string }) => e.message).join('; ');
    if (/unauthori[sz]ed|not logged in|authentication/i.test(msg) && !json.data) unauthorized();
    // Partial data is still useful (e.g. one failing field) – only throw when nothing came back.
    if (!json.data) throw new GqlError(msg);
    console.warn('GraphQL partial errors:', msg);
  }
  setOffline(false);
  if (key && json.data) void saveResponse(key, json.data);
  return json.data as T;
}

export async function login(username: string, password: string) {
  const res = await post(
    'mutation($u:String!,$p:String!){login(input:{username:$u,password:$p}){accessToken refreshToken}}',
    { u: username, p: password },
    null,
  );
  const json = await res.json().catch(() => null);
  const data = json?.data?.login;
  if (!data?.accessToken) {
    throw new GqlError(json?.errors?.[0]?.message ?? 'Login failed', res.status);
  }
  setTokens(data.accessToken, data.refreshToken);
}

/** Fetch an image as a Blob, attaching the bearer token when we have one. */
export async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const token = getAccessToken();
  const res = await fetch(url, {
    credentials: 'include',
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new GqlError(`Image request failed (${res.status})`, res.status);
  return res.blob();
}
