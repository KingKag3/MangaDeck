import { parseVolumeRanges, parseVolumeText, type VolumeRange } from './volumes';

/**
 * Read volumes from a link to a Wikipedia or Fandom wiki page, for series with no automatic source.
 *  - a Wikipedia list page with volume tables is read like the automatic lookup;
 *  - a link to ONE volume page ("…/wiki/Manga_Volume_1") makes Mangadeck follow "Manga Volume 2, 3, 4 …" and read the
 *    chapters listed on each;
 *  - any other page is read as text ("Volume 1 … Chapter 1 … Chapter 12").
 */

export interface WikiTarget {
  api: string;
  title: string;
}

/** Only well-known wiki hosts, over https. Returns where to ask for the page text. */
export function parseWikiUrl(raw: string): WikiTarget | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname;
  const known = /(^|\.)wikipedia\.org$/.test(host) || /(^|\.)fandom\.com$/.test(host) || /(^|\.)wikia\.org$/.test(host);
  const i = u.pathname.indexOf('/wiki/');
  if (u.protocol !== 'https:' || !known || i < 0) return null;
  let title: string;
  try {
    title = decodeURIComponent(u.pathname.slice(i + 6)).replace(/_/g, ' ');
  } catch {
    return null;
  }
  const api = /wikipedia\.org$/.test(host) ? `https://${host}/w/api.php` : `https://${host}${u.pathname.slice(0, i)}/api.php`;
  return { api, title };
}

/**
 * "Manga Volume 3" → how to build the title of volume N ("Manga Volume " + N), and which volume this is.
 * Some wikis pad the numbers ("Manga Volume 03"): the padding of the page you gave is kept, and for volumes 1–9
 * `builds` also offers the other spelling, in case only some pages are padded.
 */
export function volumePagePattern(title: string): { build: (n: number) => string; builds: (n: number) => string[]; n: number } | null {
  const m = /^(.*?)(\s*(?:volume|vol\.?)\s*)(\d+)\s*$/i.exec(title.trim());
  if (!m) return null;
  const width = m[3].length > 1 && m[3].startsWith('0') ? m[3].length : 0;
  const name = (n: number, pad: number) => `${m[1]}${m[2]}${pad ? String(n).padStart(pad, '0') : n}`;
  return {
    build: (n) => name(n, width),
    builds: (n) => (n < 10 ? [name(n, width), name(n, width ? 0 : 2)] : [name(n, width)]),
    n: parseInt(m[3], 10),
  };
}

/** The part of a page under a "Chapters" heading, or null. */
function chaptersSection(text: string): string | null {
  const head = /^(={2,5})\s*Chapters?\s*\1\s*$/im.exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const level = head[1].length;
  const next = new RegExp(`^={2,${level}}[^=\\n].*$`, 'm').exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** First and last chapter number mentioned on a volume page (in its "Chapters" section when it has one). */
export function chaptersFromVolumePage(text: string): { first: number; last: number } | null {
  const section = chaptersSection(text);
  const body = section ?? text;
  const nums: number[] = [];
  for (const m of body.matchAll(/\bChapters?\s+(\d+(?:\.\d+)?)(?:\s*[–—-]\s*(\d+(?:\.\d+)?))?/gi)) {
    nums.push(parseFloat(m[1]));
    if (m[2]) nums.push(parseFloat(m[2]));
  }
  if (section && /\bprologue\b/i.test(section)) nums.push(0);
  if (nums.length === 0) return null;
  return { first: Math.min(...nums), last: Math.max(...nums) };
}

async function fetchWikitext(api: string, title: string): Promise<{ title: string; text: string } | null> {
  const res = await fetch(`${api}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&origin=*`);
  if (!res.ok) return null;
  const j = await res.json();
  const text = j?.parse?.wikitext?.['*'];
  return typeof text === 'string' ? { title: j.parse.title as string, text } : null;
}

const MAX_VOLUMES = 90;
const BATCH = 4;

/** Read the volumes the link points at. Throws an Error with a plain message when nothing usable is there. */
export async function importVolumesFromWiki(
  url: string,
  onProgress?: (volumesFound: number) => void,
): Promise<{ ranges: VolumeRange[]; host: string }> {
  const target = parseWikiUrl(url);
  if (!target) throw new Error('Paste a link to a page on Wikipedia or a Fandom wiki (https://…/wiki/…).');
  const host = new URL(url.trim()).hostname;
  const first = await fetchWikitext(target.api, target.title);
  if (!first) throw new Error('That page could not be read. Check the link.');

  const tables = parseVolumeRanges(first.text);
  if (tables.length) return { ranges: tables, host };

  const pattern = volumePagePattern(first.title);
  if (pattern) {
    // Follow "<name> Volume N" pages from 1 upward until two in a row are missing.
    const ranges: VolumeRange[] = [];
    let misses = 0;
    for (let start = 1; start <= MAX_VOLUMES && misses < 2; start += BATCH) {
      const batch = Array.from({ length: BATCH }, (_, k) => start + k);
      const pages = await Promise.all(
        batch.map(async (n) => {
          for (const name of pattern.builds(n)) {
            const page = await fetchWikitext(target.api, name).catch(() => null);
            if (page) return page;
          }
          return null;
        }),
      );
      for (const [k, page] of pages.entries()) {
        if (misses >= 2) break;
        if (!page) {
          misses++;
          continue;
        }
        misses = 0;
        const c = chaptersFromVolumePage(page.text);
        if (c) ranges.push({ volume: batch[k], first: c.first, last: c.last });
      }
      onProgress?.(ranges.length);
    }
    if (ranges.length) return { ranges, host };
  }

  const fromText = parseVolumeText(first.text);
  if (fromText.length) return { ranges: fromText, host };
  throw new Error('No volumes with chapter numbers were found on that page. Try the link to one volume (like …/wiki/Manga_Volume_1).');
}
