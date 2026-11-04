import { useSyncExternalStore } from 'react';
import type { GroupPref } from './groups';
import type { LinkedSource } from './sourceLinks';
import type { VolumeInfo } from './volumes';
import type { PaceConfig, PacePreset } from './pacer';

export type ReaderMode = 'paged' | 'webtoon';
export type Direction = 'ltr' | 'rtl';
export type Fit = 'width' | 'height' | 'screen' | 'original';

export interface ReaderPrefs {
  mode: ReaderMode;
  direction: Direction;
  fit: Fit;
}

export interface Settings extends ReaderPrefs {
  preload: number; // pages to preload ahead
  gridWidth: number; // min cover width in px
  autoDownloadNext: number; // queue N unread chapters ahead when reading (0 = off)
  showBadges: boolean;
  pacePreset: PacePreset; // wait between chapters of a bulk download
  paceCustom: PaceConfig;
  showAllLanguages: boolean; // list sources in every language, not just English
  perManga: Record<string, Partial<ReaderPrefs>>;
  groups: Record<string, GroupPref>; // chosen scanlation group per manga
  volumes: Record<string, VolumeInfo>; // official volume map found for a manga
  links: Record<string, LinkedSource[]>; // other sources carrying the same series, per manga
}

const KEY = 'mangadeck.settings';

const defaults: Settings = {
  mode: 'paged',
  direction: 'rtl',
  fit: 'screen',
  preload: 4,
  gridWidth: 150,
  autoDownloadNext: 0,
  showBadges: true,
  pacePreset: 'normal',
  paceCustom: { delay: 20, jitter: 0.3, breakEvery: 15, breakSecs: 120 },
  showAllLanguages: false,
  perManga: {},
  groups: {},
  volumes: {},
  links: {},
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaults;
}

let state: Settings = load();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getSettings(): Settings {
  return state;
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  emit();
}

export function updateMangaPrefs(mangaId: number, patch: Partial<ReaderPrefs> | null) {
  const perManga = { ...state.perManga };
  if (patch === null) delete perManga[String(mangaId)];
  else perManga[String(mangaId)] = { ...perManga[String(mangaId)], ...patch };
  updateSettings({ perManga });
}

export function setGroupPref(mangaId: number, pref: GroupPref | null) {
  const groups = { ...state.groups };
  if (pref === null || !pref.group) delete groups[String(mangaId)];
  else groups[String(mangaId)] = pref;
  updateSettings({ groups });
}

export function setVolumeInfo(mangaId: number, info: VolumeInfo | null) {
  const volumes = { ...state.volumes };
  if (info === null) delete volumes[String(mangaId)];
  else volumes[String(mangaId)] = info;
  updateSettings({ volumes });
}

export function setLinks(mangaId: number, list: LinkedSource[]) {
  const links = { ...state.links };
  if (list.length === 0) delete links[String(mangaId)];
  else links[String(mangaId)] = list;
  updateSettings({ links });
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function effectivePrefs(s: Settings, mangaId?: number): ReaderPrefs {
  const o = mangaId !== undefined ? s.perManga[String(mangaId)] : undefined;
  return {
    mode: o?.mode ?? s.mode,
    direction: o?.direction ?? s.direction,
    fit: o?.fit ?? s.fit,
  };
}
