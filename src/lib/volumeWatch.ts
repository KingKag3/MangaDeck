import { useSyncExternalStore } from 'react';
import { toast } from '../components/ui';
import { lookupVolumesEverywhere } from './fandom';
import { getSettings } from './settings';
import { saveVolumes } from './volumeStore';
import { mergeNewVolumes, type VolumeRange } from './volumes';

/**
 * After a library update, look again for volumes released since the saved list, for every series that has one, and tell
 * the person. Each series is looked up at most once a day (Wikipedia and wikis are called from the browser), one at a
 * time with a pause, and the run stops quietly if a lookup fails.
 */

const NEWS_KEY = 'mangadeck.volumeNews';
const CHECKED_KEY = 'mangadeck.volumeChecked';
const DAY_MS = 24 * 3_600_000;
const GAP_MS = 1500;

export interface VolumeNews {
  mangaId: number;
  title: string;
  /** "Vol. 29" or "Vols. 29, 30". */
  what: string;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

let news: VolumeNews[] = read<VolumeNews[]>(NEWS_KEY, []);
const listeners = new Set<() => void>();

function setNews(next: VolumeNews[]) {
  news = next;
  write(NEWS_KEY, news);
  listeners.forEach((l) => l());
}

export function dismissVolumeNews() {
  setNews([]);
}

export function useVolumeNews(): VolumeNews[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => news,
  );
}

const volLabel = (vols: number[]) => (vols.length === 1 ? `Vol. ${vols[0]}` : `Vols. ${vols.join(', ')}`);

/** Volumes in `found` that `cur` does not have yet (higher than its last one). Pure, for tests. */
export function newVolumeNumbers(cur: VolumeRange[], found: VolumeRange[]): number[] {
  const top = cur.reduce((m, r) => Math.max(m, r.volume), 0);
  return found.filter((r) => r.volume > top).map((r) => r.volume);
}

let running = false;

/** Look for new volumes of these library titles. `force` ignores the once-a-day limit (the button was pressed). */
export async function checkNewVolumes(library: { id: number; title: string }[], force = false) {
  if (running) return;
  running = true;
  try {
    const checked = read<Record<string, number>>(CHECKED_KEY, {});
    let found = 0;
    for (const m of library) {
      const cur = getSettings().volumes[String(m.id)];
      if (!cur || !cur.ranges.length) continue;
      if (!force && Date.now() - (checked[String(m.id)] ?? 0) < DAY_MS) continue;
      let latest;
      try {
        latest = await lookupVolumesEverywhere(m.title, { skipRules: true });
      } catch {
        break; // a source is unreachable or limiting us: stop quietly, the next update tries again
      }
      checked[String(m.id)] = Date.now();
      write(CHECKED_KEY, checked);
      if (latest) {
        const added = newVolumeNumbers(cur.ranges, latest.ranges);
        if (added.length) {
          // A list read from the web is replaced; one typed by hand or from the built-in rules only gains the newer volumes.
          if (cur.source === 'wikipedia' || cur.source === 'fandom') saveVolumes(m.id, latest);
          else saveVolumes(m.id, { ...cur, ranges: mergeNewVolumes(cur.ranges, latest.ranges).ranges });
          const item: VolumeNews = { mangaId: m.id, title: m.title, what: volLabel(added), at: Date.now() };
          setNews([item, ...news.filter((n) => n.mangaId !== m.id)].slice(0, 50));
          toast(`${m.title}: ${item.what} ${added.length === 1 ? 'is' : 'are'} out`);
          found++;
        }
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    if (force && found === 0) toast('Checked volumes: nothing new.');
  } finally {
    running = false;
  }
}
