import { useEffect, useState } from 'react';
import { fetchBlob, getAccessToken, resolveUrl } from '../api/client';

const cache = new Map<string, string>(); // url -> object URL
const MAX_CACHE = 120;

function remember(url: string, objectUrl: string) {
  cache.set(url, objectUrl);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) {
      URL.revokeObjectURL(cache.get(oldest)!);
      cache.delete(oldest);
    }
  }
}

/**
 * Returns a src usable in <img>. When the server uses bearer-token auth, plain <img> tags can't
 * send the Authorization header, so we fetch the bytes ourselves and hand back a blob URL.
 * Without a token the resolved URL is returned directly (browser cache + native lazy loading).
 */
export function useImage(path: string | null | undefined, enabled = true): { src: string; failed: boolean } {
  const full = resolveUrl(path);
  const needsFetch = !!getAccessToken();
  const [src, setSrc] = useState<string>(needsFetch ? (cache.get(full) ?? '') : enabled ? full : '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!full || !enabled) return;
    if (!needsFetch) {
      setSrc(full); // once enabled, keep it (lazy-load window only ever grows)
      return;
    }
    const hit = cache.get(full);
    if (hit) {
      setSrc(hit);
      return;
    }
    const ctrl = new AbortController();
    fetchBlob(full, ctrl.signal)
      .then((blob) => {
        const obj = URL.createObjectURL(blob);
        remember(full, obj);
        setSrc(obj);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setFailed(true);
      });
    return () => ctrl.abort();
  }, [full, enabled, needsFetch]);

  return { src, failed };
}

/** Warm the browser/blob cache for a page we expect to show soon. */
export function preloadImage(path: string) {
  const full = resolveUrl(path);
  if (!full) return;
  if (getAccessToken()) {
    if (cache.has(full)) return;
    fetchBlob(full)
      .then((blob) => remember(full, URL.createObjectURL(blob)))
      .catch(() => undefined);
  } else {
    const img = new Image();
    img.src = full;
  }
}
