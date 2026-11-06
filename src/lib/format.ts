export function chapterLabel(c: { name: string; chapterNumber: number }): string {
  const n = c.chapterNumber;
  const hasNumber = n > 0 || c.name.trim() === '';
  const numStr = Number.isInteger(n) ? String(n) : String(n);
  if (!hasNumber) return c.name;
  // Avoid "Chapter 12 – Chapter 12"
  const nameLower = c.name.toLowerCase();
  if (nameLower.includes(`ch. ${numStr}`) || nameLower.includes(`chapter ${numStr}`) || nameLower.endsWith(` ${numStr}`)) {
    return c.name;
  }
  return c.name && c.name !== `Chapter ${numStr}` ? `Ch. ${numStr} · ${c.name}` : `Chapter ${numStr}`;
}

/** Suwayomi sends some dates in milliseconds (uploadDate) and some in seconds (fetchedAt). Anything below 1e11 is seconds. */
export function toMs(v: string | number | null | undefined): number {
  const t = Number(v);
  return t > 0 && t < 1e11 ? t * 1000 : t;
}

export function timeAgo(ms: string | number | null | undefined): string {
  const t = toMs(ms);
  if (!t) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dayBucket(ms: string | number): string {
  const t = toMs(ms);
  if (!t) return 'Unknown';
  const d = new Date(t);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface ParsedDescription {
  /** Short facts the source puts in the text, e.g. ["★ 8.06/10", "2013", "730.7K views"]. */
  meta: string[];
  /** The synopsis (or the whole text when the source has no headings). */
  text: string;
  /** Other "**Heading**: …" sections such as alternative names. */
  extras: { label: string; text: string }[];
}

const META_LINE = /^\s*(?:\*\*)?(Rating|Year|Views)(?:\*\*)?:\s*(.+?)\s*$/i;
/** Section headings the source may write with or without the ** markers ("Synopsis: …"). */
const PLAIN_HEADING = /^\s*(?:\*\*)?(Synopsis|Notes?|Alternative Names|Alternate Names|Alt Names|Alternative Titles)(?:\*\*)?:[ \t]*(.*)$/i;

/**
 * Some sources (Atsumaru) send "**Rating**: 8/10 / **Year**: … / **Synopsis**: …". Shown raw, those lines eat the
 * space of the clamped description, so split them into a facts row, the synopsis and extra sections.
 */
export function parseDescription(raw: string | null | undefined): ParsedDescription {
  const meta: string[] = [];
  const kept: string[] = [];
  for (const line of (raw ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = META_LINE.exec(line);
    if (!m) {
      const h = PLAIN_HEADING.exec(line);
      kept.push(h ? `**${h[1]}**: ${h[2]}` : line);
      continue;
    }
    const [, label, value] = m;
    const l = label.toLowerCase();
    if (l === 'rating') meta.push(`★ ${value}`);
    else if (l === 'views') meta.push(/^\d+$/.test(value) ? `${Number(value).toLocaleString()} views` : `${value} views`);
    else meta.push(value);
  }

  // Split what is left at "**Heading**:" markers.
  const body = kept.join('\n');
  const parts = body.split(/\*\*([^*\n]+)\*\*:\s*/);
  const sections: { label: string; text: string }[] = [];
  const intro = parts[0].trim();
  for (let i = 1; i < parts.length; i += 2) sections.push({ label: parts[i].trim(), text: (parts[i + 1] ?? '').trim() });

  const tidy = (s: string) =>
    s
      .replace(/\(Source:[^)]*\)/gi, '') // publisher credit
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, '$1$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const synopsis = sections.find((s) => /^synopsis$/i.test(s.label));
  const text = tidy(synopsis ? synopsis.text : [intro, ...(sections.length && !synopsis ? [] : [])].join('\n') || body);
  const extras = sections
    .filter((s) => s !== synopsis && s.text)
    .map((s) => {
      const t = tidy(s.text);
      // "- One\n- Two" lists (alternative names) read better as one wrapped line.
      const items = t.split('\n').map((l) => l.trim());
      return { label: s.label, text: items.length > 1 && items.every((l) => l.startsWith('- ')) ? items.map((l) => l.slice(2)).join('  ·  ') : t };
    });
  return { meta, text: text || tidy(body), extras };
}
