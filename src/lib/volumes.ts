import { groupOf, listGroups } from './groups';
import type { Chapter } from '../api/queries';

/** Official volume and the chapter numbers it contains (inclusive). */
export interface VolumeRange {
  volume: number;
  first: number;
  last: number;
  /** Release date (YYYY-MM-DD), English edition when listed. */
  released?: string;
  isbn?: string;
  /** Chapter titles by chapter number. */
  titles?: Record<number, string>;
}

/** Bump when the parser learns something new, so older saved lookups get refreshed. */
export const PARSER_VERSION = 2;

/** Where a volume map came from, saved per manga. */
export interface VolumeInfo {
  source: 'wikipedia';
  /** Parser version that produced `ranges` (missing on lookups saved before versions existed). */
  v?: number;
  page: string;
  ranges: VolumeRange[];
}

/* ---------- Wikitext parsing ---------- */

/** Split on `sep` while ignoring separators inside {{templates}} and [[links]]. */
function splitTop(s: string, sep = '|'): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      cur += two;
      i++;
    } else if (two === '}}' || two === ']]') {
      depth--;
      cur += two;
      i++;
    } else if (s[i] === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}

/** Contents of every `{{name ...}}` template (without the name), nested ones included in the outer body. */
function findTemplates(text: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\{\\{\\s*${name}\\s*(?=[|\\n}])`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = m.index + 2;
    while (i < text.length && depth > 0) {
      const two = text.slice(i, i + 2);
      if (two === '{{') {
        depth++;
        i += 2;
      } else if (two === '}}') {
        depth--;
        i += 2;
      } else i++;
    }
    out.push(text.slice(m.index + m[0].length, i - 2));
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Drop <ref>…</ref>, templates and link markup from a wikitext value. */
function plain(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .trim();
}

/** "October 11, 2022" (or "11 October 2022") to "2022-10-11". */
export function parseWikiDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = plain(raw).toLowerCase();
  const mdy = /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  const dmy = /(\d{1,2})\s+([a-z]+),?\s+(\d{4})/.exec(t);
  const parts: string[] = mdy ? [mdy[1], mdy[2], mdy[3]] : dmy ? [dmy[2], dmy[1], dmy[3]] : [];
  const [mon, day, year] = parts;
  const m = mon ? MONTHS.indexOf(mon) : -1;
  if (m < 0 || !day || !year) return undefined;
  return `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Chapter title from a list item: the English title of {{Nihongo|"Title"|…}}, or the plain text. */
function chapterTitle(item: string): string | undefined {
  const t = item.trim();
  const nihongo = /^\{\{\s*Nihongo\s*\|([\s\S]*)\}\}$/i.exec(t);
  const raw = nihongo ? splitTop(nihongo[1])[0] : t;
  const title = plain(raw).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
  return title || undefined;
}

/**
 * Read the "Graphic novel list" volume tables used on Wikipedia chapter lists.
 * Each volume holds one or more `{{Numbered list|start = N| item | item }}` blocks, which give its chapters.
 */
export function parseVolumeRanges(wikitext: string): VolumeRange[] {
  const ranges: VolumeRange[] = [];
  let next = 1; // chapter number after the previous volume, for lists that do not say where they start
  for (const body of findTemplates(wikitext, 'Graphic novel list')) {
    const params = new Map<string, string>();
    for (const part of splitTop(body).slice(1)) {
      const m = /^\s*(\w+)\s*=([\s\S]*)$/.exec(part);
      if (m) params.set(m[1].toLowerCase(), m[2]);
    }
    const volume = parseInt((params.get('volumenumber') ?? '').trim(), 10);
    if (!Number.isFinite(volume)) continue;
    // Volume numbers restarting means a new table (spin-offs, side stories): keep only the main series.
    if (ranges.length > 0 && volume <= ranges[ranges.length - 1].volume) break;

    let first = Infinity;
    let last = -Infinity;
    const titles: Record<number, string> = {};
    for (const [key, value] of params) {
      if (!/^chapterlist(col\d+)?$/.test(key)) continue;
      const lists = findTemplates(value, '(?:Numbered list|nlist|Ordered list)');
      if (lists.length === 0) {
        const lines = value.split('\n').filter((l) => /^\s*#(?![#*:])/.test(l));
        const n = lines.length;
        lines.forEach((l, i) => {
          const t = chapterTitle(l.replace(/^\s*#/, ''));
          if (t) titles[next + i] = t;
        });
        if (n > 0) {
          first = Math.min(first, next);
          last = Math.max(last, next + n - 1);
        } else {
          // Some pages just say "* Chapter: 18–26" (or "Chapters 18-26", or a single "Chapter 5").
          const text = plain(value);
          const range = /chapters?\s*:?\s*(\d+(?:\.\d+)?)\s*(?:[–—-]|to)\s*(\d+(?:\.\d+)?)/i.exec(text);
          const single = /chapters?\s*:?\s*(\d+(?:\.\d+)?)/i.exec(text);
          const lo = range ? parseFloat(range[1]) : single ? parseFloat(single[1]) : NaN;
          const hi = range ? parseFloat(range[2]) : lo;
          if (Number.isFinite(lo) && hi >= lo) {
            first = Math.min(first, lo);
            last = Math.max(last, hi);
          }
        }
        continue;
      }
      for (const list of lists) {
        let start: number | null = null;
        let count = 0;
        const items: string[] = [];
        for (const p of splitTop(list).slice(1)) {
          const s = /^\s*start\s*=\s*(\d+)\s*$/i.exec(p);
          if (s) start = parseInt(s[1], 10);
          else if (/^\s*\w+\s*=/.test(p) && !p.includes('{{')) continue; // other named option
          else if (p.trim()) {
            count++;
            items.push(p);
          }
        }
        if (count === 0) continue;
        const from = start ?? next;
        items.forEach((it, i) => {
          const t = chapterTitle(it);
          if (t) titles[from + i] = t;
        });
        first = Math.min(first, from);
        last = Math.max(last, from + count - 1);
      }
    }
    if (last >= first && Number.isFinite(first)) {
      const released = parseWikiDate(params.get('licensedreldate')) ?? parseWikiDate(params.get('originalreldate') ?? params.get('reldate'));
      const isbn = plain(params.get('licensedisbn') ?? params.get('originalisbn') ?? params.get('isbn') ?? '') || undefined;
      ranges.push({
        volume,
        first,
        last,
        ...(released ? { released } : {}),
        ...(isbn ? { isbn } : {}),
        ...(Object.keys(titles).length ? { titles } : {}),
      });
      next = last + 1;
    }
  }
  return ranges.sort((a, b) => a.volume - b.volume);
}

/* ---------- Wikipedia lookup ---------- */

const API = 'https://en.wikipedia.org/w/api.php';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function wikitext(page: string): Promise<{ title: string; text: string } | null> {
  const res = await fetch(`${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&redirects=1&format=json&origin=*`);
  if (!res.ok) return null;
  const j = await res.json();
  const text = j?.parse?.wikitext?.['*'];
  return typeof text === 'string' ? { title: j.parse.title as string, text } : null;
}

/** Find the "List of <title> chapters" page on Wikipedia and read its volumes. Returns null if none is usable. */
export async function lookupVolumes(title: string): Promise<VolumeInfo | null> {
  const candidates = [`List of ${title} chapters`];
  const res = await fetch(
    `${API}?action=query&list=search&srsearch=${encodeURIComponent(`${title} chapters list`)}&srlimit=6&format=json&origin=*`,
  );
  if (res.ok) {
    const j = await res.json();
    for (const hit of (j?.query?.search ?? []) as { title: string }[]) {
      if (/^list of .+ (chapters|volumes)/i.test(hit.title) && norm(hit.title).includes(norm(title))) candidates.push(hit.title);
    }
  }
  for (const c of candidates) {
    const page = await wikitext(c);
    if (!page) continue;
    const ranges = parseVolumeRanges(page.text);
    if (ranges.length) return { source: 'wikipedia', v: PARSER_VERSION, page: page.title, ranges };
  }
  return null;
}

/* ---------- Mapping chapters to volumes ---------- */

/** A distinct colour per volume (golden-angle hue steps keep neighbours apart). */
export function volumeColor(volume: number): string {
  return `hsl(${Math.round(volume * 137.5) % 360} 72% 62%)`;
}

const NAME_VOLUME = /\bvol(?:ume)?\.?\s*(\d+)/i;

/** The official volume a chapter belongs to, or null. A "Vol. N" in the chapter name wins over the lookup. */
export function volumeOf(c: Pick<Chapter, 'name' | 'chapterNumber'>, ranges: VolumeRange[] | undefined): number | null {
  const fromName = NAME_VOLUME.exec(c.name);
  if (fromName) return parseInt(fromName[1], 10);
  if (!ranges || c.chapterNumber < 0) return null;
  const n = Math.floor(c.chapterNumber); // 5.5 sits with chapter 5
  return ranges.find((r) => n >= r.first && n <= r.last)?.volume ?? null;
}

export interface VolumeSummary {
  volume: number;
  count: number;
  unread: number;
  first: number;
  last: number;
}

/**
 * One summary per volume present in `chapters`, in volume order.
 * Copies of one chapter number (from different scanlation groups) count once, and the chapter counts as read
 * when any copy is read. Unnumbered chapters always count on their own.
 */
export function summarizeVolumes(chapters: Chapter[], ranges: VolumeRange[] | undefined): VolumeSummary[] {
  const map = new Map<number, VolumeSummary>();
  const seen = new Map<string, { s: VolumeSummary; read: boolean }>();
  for (const c of chapters) {
    const v = volumeOf(c, ranges);
    if (v === null) continue;
    const s = map.get(v) ?? { volume: v, count: 0, unread: 0, first: Infinity, last: -Infinity };
    map.set(v, s);
    const key = c.chapterNumber >= 0 ? `${v}:${c.chapterNumber}` : `id:${c.id}`;
    const prev = seen.get(key);
    if (prev) {
      if (c.isRead && !prev.read) {
        prev.read = true;
        prev.s.unread--;
      }
      continue;
    }
    seen.set(key, { s, read: c.isRead });
    s.count++;
    if (!c.isRead) s.unread++;
    if (c.chapterNumber >= 0) {
      s.first = Math.min(s.first, c.chapterNumber);
      s.last = Math.max(s.last, c.chapterNumber);
    }
  }
  return [...map.values()].sort((a, b) => a.volume - b.volume);
}

/**
 * The chapters to pack into one volume file: one copy per chapter number (from the group with the most
 * chapters), oldest first. Unnumbered chapters come last, in source order.
 */
export function volumeChapters(all: Chapter[], ranges: VolumeRange[] | undefined, volume: number): Chapter[] {
  const rank = new Map(listGroups(all).map((g, i) => [g.name, i]));
  const rankOf = (c: Chapter) => rank.get(groupOf(c)) ?? 0;
  const best = new Map<string, Chapter>();
  for (const c of all) {
    if (volumeOf(c, ranges) !== volume) continue;
    const key = c.chapterNumber >= 0 ? `n${c.chapterNumber}` : `id${c.id}`;
    const have = best.get(key);
    if (!have || rankOf(c) < rankOf(have)) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => {
    if ((a.chapterNumber >= 0) !== (b.chapterNumber >= 0)) return a.chapterNumber >= 0 ? -1 : 1;
    return a.chapterNumber >= 0 ? a.chapterNumber - b.chapterNumber : a.sourceOrder - b.sourceOrder;
  });
}

export interface PackItem {
  chapter: Chapter;
  volume: number | null;
}

/**
 * Every chapter, one copy per chapter number (from the group with the most chapters), oldest first,
 * each tagged with its volume. Chapters outside every volume get volume null and sort last.
 */
export function seriesChapters(all: Chapter[], ranges: VolumeRange[] | undefined): PackItem[] {
  const rank = new Map(listGroups(all).map((g, i) => [g.name, i]));
  const rankOf = (c: Chapter) => rank.get(groupOf(c)) ?? 0;
  const best = new Map<string, Chapter>();
  for (const c of all) {
    const key = c.chapterNumber >= 0 ? `n${c.chapterNumber}` : `id${c.id}`;
    const have = best.get(key);
    if (!have || rankOf(c) < rankOf(have)) best.set(key, c);
  }
  const items = [...best.values()].map((chapter) => ({ chapter, volume: volumeOf(chapter, ranges) }));
  const v = (i: PackItem) => i.volume ?? Infinity;
  return items.sort((a, b) => {
    if (v(a) !== v(b)) return v(a) < v(b) ? -1 : 1;
    const [x, y] = [a.chapter, b.chapter];
    if ((x.chapterNumber >= 0) !== (y.chapterNumber >= 0)) return x.chapterNumber >= 0 ? -1 : 1;
    return x.chapterNumber >= 0 ? x.chapterNumber - y.chapterNumber : x.sourceOrder - y.sourceOrder;
  });
}
