import { groupOf, listGroups } from './groups';
import { findVolumeRule } from './volumeRules';
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
export const PARSER_VERSION = 3;

/** Where a volume map came from, saved per manga. */
export interface VolumeInfo {
  source: 'wikipedia' | 'fandom' | 'manual' | 'rule';
  /** When it was saved (ms). The newest copy wins when the browser and the server disagree. */
  savedAt?: number;
  /** The copy kept on the server had to leave out chapter titles (and maybe dates) to fit: refresh to get them back. */
  slim?: boolean;
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
  return findTemplatesAt(text, name).map((t) => t.body);
}

/** Same, with the position where each template starts. */
function findTemplatesAt(text: string, name: string): { body: string; index: number }[] {
  const out: { body: string; index: number }[] = [];
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
    out.push({ body: text.slice(m.index + m[0].length, i - 2), index: m.index });
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

interface Heading {
  pos: number;
  level: number;
  text: string;
}

function findHeadings(wikitext: string): Heading[] {
  const out: Heading[] = [];
  for (const m of wikitext.matchAll(/^(={2,6})\s*(.+?)\s*\1\s*$/gm)) out.push({ pos: m.index ?? 0, level: m[1].length, text: plain(m[2]) });
  return out;
}

/** "Chapter: 18–26", "Chapters 18-26", "Mission: 5", "Episode 3 to 9": a chapter word, then one number or a range. */
const CHAPTER_WORDS = 'chapters?|ch|missions?|episodes?|acts?|stages?|rounds?|cases?|lessons?|days?|scenes?|quests?|tracks?';
const CHAPTER_REF = new RegExp(String.raw`\b(?:${CHAPTER_WORDS})\.?\s*:?\s*(\d+(?:\.\d+)?)(?:\s*(?:[–—-]|to)\s*(\d+(?:\.\d+)?))?`, 'gi');
/** A bullet that starts with the chapter word itself: "*Mission: 1–5" counts, "*Short Mission: 14" does not. */
const CHAPTER_LINE = new RegExp(String.raw`^\s*[*#:]*\s*(?:${CHAPTER_WORDS})\b`, 'i');
/** "* 162.2. Title": a bullet that starts with the chapter number and a dot or bracket. */
const NUMBER_BULLET = /^\s*[*#:]+\s*(\d+(?:\.\d+)?)[.)]\s+(.+)$/;
/** "*Days 12: Title": one chapter per bullet, with its number and title. */
const CHAPTER_TITLE_LINE = new RegExp(String.raw`^\s*[*#:]*\s*(?:${CHAPTER_WORDS})\.?\s*(\d+(?:\.\d+)?)\s*:\s*(.+)$`, 'i');

/** Read one "Graphic novel list" volume: its chapter range, release date, ISBN and chapter titles. */
function readVolume(params: Map<string, string>, volume: number, next: number): VolumeRange | null {
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
        // Series name their chapters differently ("Mission: 12–17"); lines about extras ("Short Mission: 14") are not part of the run.
        // A bullet per chapter ("*Days 1: {{Nihongo|"Title"|…}}") also gives the chapter titles.
        for (const l of value.split('\n')) {
          const m = CHAPTER_TITLE_LINE.exec(l);
          const t = m && chapterTitle(m[2]);
          if (m && t) titles[parseFloat(m[1])] = t;
        }
        // Or just a number and a dot ("* 162. Title"), with no chapter word at all.
        for (const l of value.split('\n')) {
          const m = NUMBER_BULLET.exec(l);
          if (!m) continue;
          const n = parseFloat(m[1]);
          first = Math.min(first, n);
          last = Math.max(last, n);
          const t = chapterTitle(m[2]);
          if (t) titles[n] = t;
        }
        const text = plain(value)
          .split('\n')
          .filter((l) => CHAPTER_LINE.test(l))
          .join('\n');
        for (const m of text.matchAll(CHAPTER_REF)) {
          const lo = parseFloat(m[1]);
          const hi = m[2] ? parseFloat(m[2]) : lo;
          if (Number.isFinite(lo) && hi >= lo) {
            first = Math.min(first, lo);
            last = Math.max(last, hi);
          }
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
  if (!(last >= first) || !Number.isFinite(first)) return null;
  const released = parseWikiDate(params.get('licensedreldate')) ?? parseWikiDate(params.get('originalreldate') ?? params.get('reldate'));
  const isbn = plain(params.get('licensedisbn') ?? params.get('originalisbn') ?? params.get('isbn') ?? '') || undefined;
  return {
    volume,
    first,
    last,
    ...(released ? { released } : {}),
    ...(isbn ? { isbn } : {}),
    ...(Object.keys(titles).length ? { titles } : {}),
  };
}

/** Consecutive volume tables under one heading; a volume number that restarts begins a new one. */
interface Sequence {
  heading: string;
  section: string;
  ranges: VolumeRange[];
}

/** Chapters keep counting up from one volume to the next (a light novel's chapters restart in every volume). */
const continuous = (rs: VolumeRange[]) => rs.every((r, i) => i === 0 || r.first >= rs[i - 1].last);

/**
 * Read the "Graphic novel list" volume tables used on Wikipedia chapter lists.
 * Each volume holds one or more `{{Numbered list|start = N| item | item }}` blocks (or a "Chapter: a–b" line).
 *
 * A page can hold several series (light novels, the manga, spin-offs), each as its own run of volumes. With `title`
 * the run under the heading that matches it wins; otherwise the longest run whose chapters keep counting up.
 */
export function parseVolumeRanges(wikitext: string, title?: string): VolumeRange[] {
  const heads = findHeadings(wikitext);
  const seqs: Sequence[] = [];
  let cur: Sequence | null = null;
  let next = 1; // chapter number after the previous volume, for lists that do not say where they start
  for (const { body, index } of findTemplatesAt(wikitext, 'Graphic novel list')) {
    const params = new Map<string, string>();
    for (const part of splitTop(body).slice(1)) {
      const m = /^\s*(\w+)\s*=([\s\S]*)$/.exec(part);
      if (m) params.set(m[1].toLowerCase(), m[2]);
    }
    const volume = parseInt((params.get('volumenumber') ?? '').trim(), 10);
    if (!Number.isFinite(volume)) continue;

    const lastRange: VolumeRange | undefined = cur?.ranges[cur.ranges.length - 1];
    if (!cur || (lastRange && volume <= lastRange.volume)) {
      const before = heads.filter((h) => h.pos < index);
      cur = {
        heading: before[before.length - 1]?.text ?? '',
        section: [...before].reverse().find((h) => h.level === 2)?.text ?? '',
        ranges: [],
      };
      seqs.push(cur);
      next = 1;
    }
    const r = readVolume(params, volume, next);
    if (r) {
      cur.ranges.push(r);
      next = r.last + 1;
    }
  }

  let pool = seqs.filter((s) => s.ranges.length > 0 && continuous(s.ranges));
  if (pool.length === 0) pool = seqs.filter((s) => s.ranges.length > 0); // nothing counts up cleanly: take what there is
  const t = title ? norm(plain(title)) : '';
  const score = (s: Sequence) => {
    const h = norm(s.heading);
    let n = s.ranges.length;
    if (t && h === t) n += 2000;
    else if (t && h.includes(t)) n += 1000;
    if (!t.includes('novel') && (norm(s.section).includes('novel') || h.includes('novel'))) n -= 500;
    return n;
  };
  let best: Sequence | undefined;
  for (const s of pool) if (!best || score(s) > score(best)) best = s;
  return (best?.ranges ?? []).sort((a, b) => a.volume - b.volume);
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

/**
 * The title and shorter forms of it. Sources often add a subtitle ("Mushoku Tensei - Jobless Reincarnation") that
 * the Wikipedia page name does not have.
 */
export function titleVariants(title: string): string[] {
  // Some sources shout the title ("GACHIAKUTA"); Wikipedia's page is "Gachiakuta".
  const shouted = /[A-Z]/.test(title) && title === title.toUpperCase();
  const bases = shouted
    ? [title, title.toLowerCase().replace(/(^|[\s:(-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())]
    : [title];
  const out = [...bases];
  for (const base of bases) {
    for (const sep of [' - ', ' – ', ' — ', ': ', ' (']) {
      const i = base.indexOf(sep);
      if (i > 2) out.push(base.slice(0, i));
      // "GTO: Great Teacher Onizuka": when the part before the separator is just an acronym, the real name is after it.
      if (i > 0 && /^[A-Z0-9]{2,5}$/.test(base.slice(0, i)) && !shouted) out.push(base.slice(i + sep.length));
    }
    out.push(base.replace(/\s*\([^)]*\)\s*/g, ' '));
  }
  return [...new Set(out.map((s) => s.trim()).filter((s) => s.length > 2))];
}

/** Find the "List of <title> chapters/volumes" page on Wikipedia and read its volumes. Returns null if none is usable. */
export async function lookupVolumes(title: string, opts: { skipRules?: boolean } = {}): Promise<VolumeInfo | null> {
  // Series we already worked out by hand come first (unless we are looking for volumes newer than that list).
  const rule = opts.skipRules ? null : findVolumeRule(title);
  if (rule) return { ...rule, v: PARSER_VERSION };

  const variants = titleVariants(title);
  const candidates: string[] = [];
  for (const v of variants) candidates.push(`List of ${v} chapters`, `List of ${v} volumes`);

  // Search too. Short forms of the title only accept the exact page name, so "Fate" cannot land on another series.
  for (const v of variants.slice(0, 2)) {
    const res = await fetch(`${API}?action=query&list=search&srsearch=${encodeURIComponent(`${v} chapters list`)}&srlimit=6&format=json&origin=*`);
    if (!res.ok) continue;
    const j = await res.json();
    for (const hit of (j?.query?.search ?? []) as { title: string }[]) {
      if (!/^list of .+ (chapters|volumes)/i.test(hit.title)) continue;
      const exact = [`list of ${v} chapters`, `list of ${v} volumes`].some((x) => norm(x) === norm(hit.title));
      if (exact || (v === title && norm(hit.title).includes(norm(v)))) candidates.push(hit.title);
    }
  }

  // Last, the series' own article: many have no separate list page and keep the volume tables themselves.
  candidates.push(...variants.filter((v) => norm(v) === norm(title)));

  for (const c of [...new Set(candidates)]) {
    const page = await wikitext(c);
    if (!page) continue;
    const ranges = parseVolumeRanges(page.text, title);
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

/* ---------- Volumes typed or pasted by hand ---------- */

/**
 * Read volume ranges from text. Understands one volume per line ("1: 0-12", "Vol. 2 ch 13-26") and text copied
 * from a wiki or publisher page ("Volume 1 … Prologue, Chapter 1 … Chapter 12 … Volume 2 …"). A volume that
 * shows up more than once (a Korean and an English row, say) is merged.
 */
export function parseVolumeText(text: string): VolumeRange[] {
  const byVolume = new Map<number, { first: number; last: number }>();
  const add = (volume: number, lo: number, hi: number) => {
    if (!Number.isFinite(volume) || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
    const cur = byVolume.get(volume);
    byVolume.set(volume, { first: Math.min(lo, hi, cur?.first ?? Infinity), last: Math.max(lo, hi, cur?.last ?? -Infinity) });
  };
  const num = /(\d+(?:\.\d+)?)/.source;

  // Simple lines first: "1: 0-12", "Vol 2 = 13 to 26", "Volume 3 - Chapters 27–39".
  const line = new RegExp(String.raw`^\s*(?:vol(?:ume)?\.?\s*)?(\d+)\s*[:=–—-]?\s*(?:chapters?\.?\s*|ch\.?\s*)?${num}\s*(?:[–—-]|to)\s*${num}\s*$`, 'i');
  for (const l of text.split(/\r?\n/)) {
    const m = line.exec(l);
    if (m) add(parseInt(m[1], 10), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (byVolume.size === 0) {
    // Page text: cut at every "Volume N" and take the chapter numbers mentioned before the next one.
    const parts = text.split(/\b(?:volume|vol\.?)\s*(\d+)\b/i);
    for (let i = 1; i < parts.length; i += 2) {
      const volume = parseInt(parts[i], 10);
      // Stop at a heading for something that is not a volume (omakes, specials, extras): their chapter mentions are not this volume's.
      const raw = parts[i + 1] ?? '';
      const stop = /\n={2,}\s*[^=\n]*\b(?:omakes?|specials?|extras?|bonus|side stor(?:y|ies)|spin-?offs?|one-?shots?|gallery|trivia|see also)\b[^=\n]*={2,}/i.exec(raw);
      const body = stop ? raw.slice(0, stop.index) : raw;
      const found: number[] = [];
      for (const m of body.matchAll(new RegExp(String.raw`\b(?:chapters?|ch\.?)\s*${num}(?:\s*(?:[–—-]|to)\s*${num})?`, 'gi'))) {
        found.push(parseFloat(m[1]));
        if (m[2]) found.push(parseFloat(m[2]));
      }
      if (/\bprologue\b/i.test(body)) found.push(0);
      if (found.length) add(volume, Math.min(...found), Math.max(...found));
    }
  }
  return [...byVolume.entries()].map(([volume, r]) => ({ volume, ...r })).sort((a, b) => a.volume - b.volume);
}

/** One line per volume, the way the editor shows and accepts them. */
export function volumeRangesToText(ranges: VolumeRange[]): string {
  return ranges.map((r) => `${r.volume}: ${r.first}-${r.last}`).join('\n');
}

/**
 * Add volumes that came out since `current` was saved: volumes of `found` numbered above the last one in `current`.
 * Nothing already in `current` is changed (it may have been entered or corrected by hand).
 */
export function mergeNewVolumes(current: VolumeRange[], found: VolumeRange[]): { ranges: VolumeRange[]; added: number } {
  const top = current.reduce((m, r) => Math.max(m, r.volume), 0);
  const fresh = found.filter((r) => r.volume > top);
  return { ranges: [...current, ...fresh].sort((a, b) => a.volume - b.volume), added: fresh.length };
}

/** Carry the release date, ISBN and chapter titles of volumes you kept over to the edited list. */
export function keepExtras(edited: VolumeRange[], old: VolumeRange[] | undefined): VolumeRange[] {
  if (!old) return edited;
  return edited.map((r) => {
    const o = old.find((x) => x.volume === r.volume);
    return o ? { ...r, ...(o.released ? { released: o.released } : {}), ...(o.isbn ? { isbn: o.isbn } : {}), ...(o.titles ? { titles: o.titles } : {}) } : r;
  });
}

/** Same volumes with the same first and last chapters (extras like dates are not compared). */
export function sameRanges(a: VolumeRange[] | undefined, b: VolumeRange[]): boolean {
  return !!a && a.length === b.length && a.every((r, i) => r.volume === b[i].volume && r.first === b[i].first && r.last === b[i].last);
}
