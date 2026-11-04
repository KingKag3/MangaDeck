import { COMMUNITY_ENABLED, SUPABASE_KEY, SUPABASE_URL } from './community';
import type { VolumeRule } from './volumeRules';
import { setExtraRules } from './volumeRules';
import type { Submission } from './volumeShare';
import { validateRanges } from './volumeShare';

/**
 * Community volume lists: approved rows from the shared Supabase table become extra rules, checked before the built-in
 * ones. Everything here fails quietly: no network, a paused project or odd data just means no extra rules.
 */

const CACHE_KEY = 'mangadeck.remoteRules';
const MAX_AGE = 24 * 60 * 60 * 1000;

const headers = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });

/** Keep only well-formed rules: rows come from strangers, so nothing is trusted. */
export function parseRules(data: unknown): VolumeRule[] {
  if (!Array.isArray(data)) return [];
  const out: VolumeRule[] = [];
  for (const r of data.slice(0, 5000)) {
    if (!r || typeof r !== 'object') continue;
    const { titles, page, ranges } = r as Record<string, unknown>;
    if (!Array.isArray(titles) || titles.length < 1 || titles.length > 5) continue;
    if (!titles.every((t) => typeof t === 'string' && t.trim().length > 0 && t.length <= 200)) continue;
    if (typeof page !== 'string' || page.length > 80) continue;
    if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > 500) continue;
    if (!ranges.every((x) => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n)))) continue;
    const rows = ranges as [number, number, number][];
    if (validateRanges(rows.map(([volume, first, last]) => ({ volume, first, last }))).length > 0) continue;
    out.push({ titles: titles as string[], page, ranges: rows });
  }
  return out;
}

function readCache(): { at: number; rules: VolumeRule[] } | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { at?: unknown; rules?: unknown };
    if (typeof j.at !== 'number') return null;
    return { at: j.at, rules: parseRules(j.rules) };
  } catch {
    return null;
  }
}

/** Use the saved copy right away (so opening a series works at once), then refresh it when it is a day old. */
export async function initRemoteRules(): Promise<void> {
  if (!COMMUNITY_ENABLED) return;
  const cached = readCache();
  if (cached) setExtraRules(cached.rules);
  if (cached && Date.now() - cached.at < MAX_AGE) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/volume_submissions?select=titles,page,ranges&approved=eq.true&order=id.asc&limit=5000`, {
      headers: headers(),
    });
    if (!res.ok) return;
    const rules = parseRules(await res.json());
    setExtraRules(rules);
    try {
      globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rules }));
    } catch {
      /* ignore */
    }
  } catch {
    /* offline or paused: keep whatever we had */
  }
}

/** Send a list in. It stays hidden until the maintainer approves it. Throws a plain message on failure. */
export async function sendSubmission(s: Submission): Promise<void> {
  if (!COMMUNITY_ENABLED) throw new Error('Sending is not set up yet. Copy the list instead.');
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/volume_submissions`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ titles: s.titles, page: s.page, ranges: s.ranges }),
    });
  } catch {
    throw new Error('Could not reach the shared list. Check your connection, or copy the list instead.');
  }
  if (!res.ok) throw new Error(`The shared list refused it (${res.status}). Copy the list instead.`);
}
