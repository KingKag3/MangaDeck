import { normTitle } from './recommend';
import { importVolumesFromWiki } from './wikiImport';
import { PARSER_VERSION, lookupVolumes, titleVariants, type VolumeInfo, type VolumeRange } from './volumes';

/**
 * Volumes from a series' Fandom wiki, for series Wikipedia has no list for. Fandom has one wiki per series at
 * <name>.fandom.com; its cross-wiki search is blocked for browsers, so the address is guessed from the title (and from
 * the names AniList knows the series by), checked against the wiki's own name, and the usual list pages are read with
 * the same reader as "import from a wiki link". Anything not plausible is dropped and the user can still paste a link.
 */

const ANILIST = 'https://graphql.anilist.co';
const MAX_SLUGS = 14;
/** Page names tried when the wiki's own search does not point at one. */
const LIST_PAGES = ['Volumes', 'Chapters', 'Chapters and Volumes', 'Volumes and Chapters', 'Chapter List', 'List of Chapters', 'Volume List', 'List of Volumes', 'Manga Volumes', 'Manga'];
const MAX_PAGES = 10;

/** Wiki subdomains a title could live at ("Omniscient Reader's Viewpoint" gives omniscient-readers-viewpoint). */
export function wikiSlugs(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const base = n
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (base.length < 3) continue;
    for (const f of [base, base.replace(/^the-/, ''), base.replace(/-(manga|manhwa|manhua|webtoon)$/, '')]) {
      out.push(f, f.replace(/-/g, ''));
    }
  }
  return [...new Set(out.filter((s) => s.length >= 3))].slice(0, MAX_SLUGS);
}

/** A volume list worth trusting: at least two volumes, in order, chapter ranges that do not run backwards or overlap. */
export function plausibleRanges(ranges: VolumeRange[]): boolean {
  if (ranges.length < 2 || ranges.length > 400) return false;
  const s = [...ranges].sort((a, b) => a.volume - b.volume);
  for (let i = 0; i < s.length; i++) {
    if (s[i].first > s[i].last) return false;
    if (i === 0) continue;
    if (s[i].volume === s[i - 1].volume) return false;
    if (s[i].first <= s[i - 1].first || s[i].first < s[i - 1].last) return false;
  }
  return true;
}

const timeout = () => AbortSignal.timeout(7000);

/** Other names AniList has for the series, only when its first matching entry really is this title. */
export async function aniListNames(title: string): Promise<string[]> {
  try {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: timeout(),
      body: JSON.stringify({
        query: 'query($s:String){Page(perPage:3){media(search:$s,type:MANGA){title{romaji english} synonyms}}}',
        variables: { s: title },
      }),
    });
    if (!res.ok) return [];
    const media = ((await res.json())?.data?.Page?.media ?? []) as { title: { romaji?: string; english?: string }; synonyms?: string[] }[];
    const want = normTitle(title);
    for (const m of media) {
      const names = [m.title.english, m.title.romaji, ...(m.synonyms ?? [])].filter((x): x is string => !!x && /^[\x20-\x7e’‘]+$/.test(x) && x.length >= 3);
      if (names.some((n) => normTitle(n) === want)) return [...new Set(names)].slice(0, 6);
    }
  } catch {
    /* AniList down or blocked: the title alone has to do */
  }
  return [];
}

/** Is <sub>.fandom.com a wiki about one of these names? Compares the wiki's own name. */
async function isWikiFor(sub: string, names: string[]): Promise<boolean> {
  try {
    const res = await fetch(`https://${sub}.fandom.com/api.php?action=query&meta=siteinfo&siprop=general&format=json&origin=*`, { signal: timeout() });
    if (!res.ok) return false;
    const site = normTitle(String((await res.json())?.query?.general?.sitename ?? ''));
    if (site.length < 4) return false;
    return names.some((n) => {
      const x = normTitle(n);
      return x.length >= 4 && (site.includes(x) || x.includes(site.replace(/wiki$/, '')));
    });
  } catch {
    return false;
  }
}

async function findWiki(slugs: string[], names: string[]): Promise<string | null> {
  const ok = await Promise.all(slugs.map((s) => isWikiFor(s, names)));
  return slugs.find((_, i) => ok[i]) ?? null;
}

/** Page titles on the wiki that look like a volume or chapter list: the wiki's own search first, then the usual names. */
async function listPages(sub: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const res = await fetch(`https://${sub}.fandom.com/api.php?action=query&list=search&srsearch=${encodeURIComponent('volumes chapters list')}&srlimit=8&format=json&origin=*`, { signal: timeout() });
    if (res.ok) for (const h of ((await res.json())?.query?.search ?? []) as { title: string }[]) if (/volume|chapter/i.test(h.title)) found.push(h.title);
  } catch {
    /* search is a bonus */
  }
  const lower = new Set(found.map((t) => t.toLowerCase()));
  const guessed = LIST_PAGES.filter((p) => !lower.has(p.toLowerCase()));
  // List pages from search first, then a single "Volume N" page (reading it follows the other volumes), then the usual names.
  const lists = found.filter((t) => !/\bvol(?:ume)?\.?\s*\d+\s*$/i.test(t));
  const single = found.filter((t) => /\bvol(?:ume)?\.?\s*\d+\s*$/i.test(t)).slice(0, 1);
  return [...new Set([...lists, ...single, ...guessed])].slice(0, MAX_PAGES);
}

/** Look the series up on its Fandom wiki. Null when no wiki or no usable list is found. */
export async function lookupFandom(title: string): Promise<VolumeInfo | null> {
  const names = titleVariants(title);
  const tried = wikiSlugs(names);
  let sub = await findWiki(tried, names);
  if (!sub) {
    const extra = await aniListNames(title);
    if (extra.length) {
      const all = [...names, ...extra.flatMap((n) => titleVariants(n))];
      const more = wikiSlugs(all).filter((s) => !tried.includes(s));
      sub = await findWiki(more, all);
    }
  }
  if (!sub) return null;
  for (const page of await listPages(sub)) {
    try {
      const { ranges } = await importVolumesFromWiki(`https://${sub}.fandom.com/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`);
      if (plausibleRanges(ranges)) return { source: 'fandom', v: PARSER_VERSION, page: `${sub}: ${page}`, ranges };
    } catch {
      /* that page has no usable list: try the next */
    }
  }
  return null;
}

/** Wikipedia (and the built-in rules) first, then the series' Fandom wiki. */
export async function lookupVolumesEverywhere(title: string, opts: { skipRules?: boolean } = {}): Promise<VolumeInfo | null> {
  const found = await lookupVolumes(title, opts);
  if (found) return found;
  try {
    return await lookupFandom(title);
  } catch {
    return null;
  }
}
