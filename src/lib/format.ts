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
