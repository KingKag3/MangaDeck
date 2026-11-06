import { gql, isNetworkError } from './client';
import { getSavedPages } from '../lib/offlineDb';
import { queueProgress } from '../lib/offlineQueue';

/* ---------- Types (hand-written to match the fields we request) ---------- */

export interface Category {
  id: number;
  name: string;
  order: number;
  default: boolean;
  isDefaultCategory: boolean;
  mangas: { totalCount: number };
}

export interface SourceRef {
  id: string;
  name: string;
  displayName: string;
  lang: string;
  iconUrl: string;
}

export interface MangaBase {
  id: number;
  title: string;
  thumbnailUrl: string | null;
  inLibrary: boolean;
  sourceId: string;
}

export interface LibraryManga extends MangaBase {
  unreadCount: number;
  downloadCount: number;
  bookmarkCount: number;
  inLibraryAt: string;
  lastFetchedAt: string | null;
  status: string;
  source: { displayName: string } | null;
  categories: { nodes: { id: number }[] };
  chapters: { totalCount: number };
  lastReadChapter: { id: number; lastReadAt: string } | null;
  firstUnreadChapter: { id: number; name: string; chapterNumber: number } | null;
  latestFetchedChapter: { id: number; fetchedAt: string } | null;
  latestUploadedChapter: { id: number; uploadDate: string } | null;
}

export interface MangaDetail extends MangaBase {
  description: string | null;
  author: string | null;
  artist: string | null;
  genre: string[];
  status: string;
  realUrl: string | null;
  initialized: boolean;
  unreadCount: number;
  downloadCount: number;
  source: SourceRef | null;
  categories: { nodes: { id: number }[] };
  firstUnreadChapter: { id: number; name: string; chapterNumber: number } | null;
  lastReadChapter: { id: number; lastReadAt: string } | null;
  /** Free-form key/value pairs the server keeps for this manga (Mangadeck stores its volume map here). */
  meta: { key: string; value: string }[];
}

export interface Chapter {
  id: number;
  name: string;
  mangaId: number;
  chapterNumber: number;
  scanlator: string | null;
  sourceOrder: number;
  uploadDate: string;
  fetchedAt: string;
  lastReadAt: string;
  lastPageRead: number;
  pageCount: number;
  isRead: boolean;
  isDownloaded: boolean;
  isBookmarked: boolean;
  realUrl: string | null;
}

export interface UpdateChapter extends Chapter {
  manga: MangaBase;
}

export interface DownloadItem {
  progress: number;
  state: 'QUEUED' | 'DOWNLOADING' | 'FINISHED' | 'ERROR';
  tries: number;
  position: number;
  chapter: { id: number; name: string; chapterNumber: number; pageCount: number };
  manga: { id: number; title: string; thumbnailUrl: string | null };
}

export interface DownloadStatus {
  state: 'STARTED' | 'STOPPED';
  queue: DownloadItem[];
}

export interface Extension {
  pkgName: string;
  name: string;
  lang: string;
  versionName: string;
  iconUrl: string;
  isInstalled: boolean;
  isObsolete: boolean;
  hasUpdate: boolean;
}

export interface Source extends SourceRef {
  isConfigurable: boolean;
  supportsLatest: boolean;
  extension: { pkgName: string } | null;
}

/* ---------- Field sets ---------- */

const CHAPTER_FIELDS = `
  id name mangaId chapterNumber scanlator sourceOrder uploadDate fetchedAt lastReadAt
  lastPageRead pageCount isRead isDownloaded isBookmarked realUrl
`;

const MANGA_BASE = `id title thumbnailUrl inLibrary sourceId`;

/* ---------- Queries ---------- */

export const Q = {
  async categories(): Promise<Category[]> {
    const d = await gql(`{
      categories { nodes { id name order default isDefaultCategory mangas { totalCount } } }
    }`);
    return [...d.categories.nodes].sort((a: Category, b: Category) => a.order - b.order);
  },

  async library(): Promise<LibraryManga[]> {
    const d = await gql(`{
      mangas(condition: { inLibrary: true }) {
        nodes {
          ${MANGA_BASE}
          unreadCount downloadCount bookmarkCount inLibraryAt lastFetchedAt status
          source { displayName }
          categories { nodes { id } }
          chapters { totalCount }
          lastReadChapter { id lastReadAt }
          firstUnreadChapter { id name chapterNumber }
          latestFetchedChapter { id fetchedAt }
          latestUploadedChapter { id uploadDate }
        }
      }
    }`);
    return d.mangas.nodes;
  },

  /** Chapter numbers and upload dates of every library title (heavy: only asked for when sorting by latest chapter). */
  async chapterDates(): Promise<{ id: number; chapters: { nodes: { chapterNumber: number; uploadDate: string }[] } }[]> {
    const d = await gql(`{
      mangas(condition: { inLibrary: true }) {
        nodes { id chapters { nodes { chapterNumber uploadDate } } }
      }
    }`);
    return d.mangas.nodes;
  },

  /** The scanlator of every chapter in the library (heavy: only asked for from Settings). */
  async libraryGroups(): Promise<{ chapters: { nodes: { scanlator: string | null }[] } }[]> {
    const d = await gql(`{
      mangas(condition: { inLibrary: true }) {
        nodes { chapters { nodes { scanlator } } }
      }
    }`);
    return d.mangas.nodes;
  },

  async manga(id: number): Promise<MangaDetail> {
    const d = await gql(
      `query($id: Int!) {
        manga(id: $id) {
          ${MANGA_BASE}
          description author artist genre status realUrl initialized unreadCount downloadCount
          source { id name displayName lang iconUrl }
          categories { nodes { id } }
          firstUnreadChapter { id name chapterNumber }
          lastReadChapter { id lastReadAt }
          meta { key value }
        }
      }`,
      { id },
    );
    return d.manga;
  },

  async chapters(mangaId: number): Promise<Chapter[]> {
    const d = await gql(
      `query($id: Int!) {
        chapters(condition: { mangaId: $id }, order: [{ by: SOURCE_ORDER, byType: DESC }]) {
          nodes { ${CHAPTER_FIELDS} }
        }
      }`,
      { id: mangaId },
    );
    return d.chapters.nodes;
  },

  /** Whether one chapter is on the server's disk now (a chapter that left the download queue either finished or was removed). */
  async chapterDownloaded(id: number): Promise<boolean> {
    const d = await gql(`query($id: Int!) { chapter(id: $id) { isDownloaded } }`, { id });
    return !!d.chapter?.isDownloaded;
  },

  async updates(first = 150): Promise<UpdateChapter[]> {
    const d = await gql(
      `query($first: Int) {
        chapters(
          filter: { inLibrary: { equalTo: true } }
          order: [{ by: FETCHED_AT, byType: DESC }]
          first: $first
        ) {
          nodes { ${CHAPTER_FIELDS} manga { ${MANGA_BASE} } }
        }
      }`,
      { first },
    );
    return d.chapters.nodes;
  },

  async history(first = 100): Promise<UpdateChapter[]> {
    const d = await gql(
      `query($first: Int) {
        chapters(
          filter: { lastReadAt: { greaterThan: "0" } }
          order: [{ by: LAST_READ_AT, byType: DESC }]
          first: $first
        ) {
          nodes { ${CHAPTER_FIELDS} manga { ${MANGA_BASE} } }
        }
      }`,
      { first },
    );
    return d.chapters.nodes;
  },

  async downloads(): Promise<DownloadStatus> {
    const d = await gql(`{
      downloadStatus {
        state
        queue {
          progress state tries position
          chapter { id name chapterNumber pageCount }
          manga { id title thumbnailUrl }
        }
      }
    }`);
    return d.downloadStatus;
  },

  async sources(): Promise<Source[]> {
    const d = await gql(`{
      sources { nodes { id name displayName lang iconUrl isConfigurable supportsLatest extension { pkgName } } }
    }`);
    return d.sources.nodes;
  },

  async extensions(): Promise<Extension[]> {
    const d = await gql(`{
      extensions { nodes { pkgName name lang versionName iconUrl isInstalled isObsolete hasUpdate } }
    }`);
    return d.extensions.nodes;
  },

  async updaterStatus(): Promise<{ isRunning: boolean; totalJobs: number; finishedJobs: number }> {
    const d = await gql(`{
      libraryUpdateStatus { jobsInfo { isRunning totalJobs finishedJobs } }
    }`);
    return d.libraryUpdateStatus.jobsInfo;
  },

  async maxSourcesInParallel(): Promise<number> {
    const d = await gql(`{ settings { maxSourcesInParallel } }`);
    return d.settings.maxSourcesInParallel;
  },

  async serverInfo(): Promise<{ name: string; version: string; buildType: string }> {
    const d = await gql(`{ aboutServer { name version buildType } }`);
    return d.aboutServer;
  },
};

/* ---------- Mutations ---------- */

export const M = {
  async fetchPages(chapterId: number): Promise<string[]> {
    try {
      const d = await gql(
        `mutation($id: Int!) {
          fetchChapterPages(input: { chapterId: $id }) { pages chapter { id pageCount } }
        }`,
        { id: chapterId },
      );
      return d.fetchChapterPages.pages;
    } catch (e) {
      // Server out of reach: a chapter saved for offline reading still has its page list.
      const saved = isNetworkError(e) ? await getSavedPages(chapterId) : null;
      if (saved) return saved;
      throw e;
    }
  },

  updateChapters(ids: number[], patch: { isRead?: boolean; isBookmarked?: boolean; lastPageRead?: number }) {
    return gql(
      `mutation($ids: [Int!]!, $patch: UpdateChapterPatchInput!) {
        updateChapters(input: { ids: $ids, patch: $patch }) { chapters { id isRead isBookmarked lastPageRead } }
      }`,
      { ids, patch },
    );
  },

  /** Reading progress made while the server is out of reach is queued and sent later (unless `queue: false`). */
  async updateChapter(id: number, patch: { isRead?: boolean; isBookmarked?: boolean; lastPageRead?: number }, o: { queue?: boolean } = {}) {
    try {
      return await gql(
        `mutation($id: Int!, $patch: UpdateChapterPatchInput!) {
          updateChapter(input: { id: $id, patch: $patch }) { chapter { id isRead lastPageRead } }
        }`,
        { id, patch },
      );
    } catch (e) {
      const progressOnly = Object.keys(patch).every((k) => k === 'isRead' || k === 'lastPageRead');
      if (o.queue !== false && progressOnly && isNetworkError(e)) {
        queueProgress(id, patch as { isRead?: boolean; lastPageRead?: number });
        return null;
      }
      throw e;
    }
  },

  setMangaMeta(mangaId: number, key: string, value: string) {
    return gql(
      `mutation($mangaId: Int!, $key: String!, $value: String!) {
        setMangaMeta(input: { meta: { mangaId: $mangaId, key: $key, value: $value } }) { meta { key value } }
      }`,
      { mangaId, key, value },
    );
  },

  deleteMangaMeta(mangaId: number, key: string) {
    return gql(
      `mutation($mangaId: Int!, $key: String!) {
        deleteMangaMeta(input: { mangaId: $mangaId, key: $key }) { meta { key value } }
      }`,
      { mangaId, key },
    );
  },

  setInLibrary(id: number, inLibrary: boolean) {
    return gql(
      `mutation($id: Int!, $v: Boolean!) {
        updateManga(input: { id: $id, patch: { inLibrary: $v } }) { manga { id inLibrary } }
      }`,
      { id, v: inLibrary },
    );
  },

  setMangaCategories(id: number, add: number[], remove: number[]) {
    return gql(
      `mutation($id: Int!, $add: [Int!], $remove: [Int!]) {
        updateMangaCategories(input: { id: $id, patch: { addToCategories: $add, removeFromCategories: $remove } }) {
          manga { id categories { nodes { id } } }
        }
      }`,
      { id, add, remove },
    );
  },

  refreshManga(id: number, fetchManga = true, fetchChapters = true) {
    return gql(
      `mutation($id: Int!, $m: Boolean!, $c: Boolean!) {
        fetchMangaAndChapters(input: { id: $id, fetchManga: $m, fetchChapters: $c }) {
          manga @include(if: $m) { id }
          chapters @include(if: $c) { id }
        }
      }`,
      { id, m: fetchManga, c: fetchChapters },
    );
  },

  enqueueDownloads(ids: number[]) {
    return gql(
      `mutation($ids: [Int!]!) {
        enqueueChapterDownloads(input: { ids: $ids }) { downloadStatus { state } }
      }`,
      { ids },
    );
  },

  dequeueDownloads(ids: number[]) {
    return gql(
      `mutation($ids: [Int!]!) {
        dequeueChapterDownloads(input: { ids: $ids }) { downloadStatus { state } }
      }`,
      { ids },
    );
  },

  deleteDownloads(ids: number[]) {
    return gql(
      `mutation($ids: [Int!]!) {
        deleteDownloadedChapters(input: { ids: $ids }) { chapters { id isDownloaded } }
      }`,
      { ids },
    );
  },

  startDownloader() {
    return gql(`mutation { startDownloader(input: {}) { downloadStatus { state } } }`);
  },
  stopDownloader() {
    return gql(`mutation { stopDownloader(input: {}) { downloadStatus { state } } }`);
  },
  clearDownloader() {
    return gql(`mutation { clearDownloader(input: {}) { downloadStatus { state } } }`);
  },

  async setMaxSourcesInParallel(n: number): Promise<number> {
    const d = await gql(
      `mutation($n: Int!) { setSettings(input: { settings: { maxSourcesInParallel: $n } }) { settings { maxSourcesInParallel } } }`,
      { n },
    );
    return d.setSettings.settings.maxSourcesInParallel;
  },

  updateLibrary() {
    return gql(`mutation { updateLibrary(input: {}) { updateStatus { jobsInfo { isRunning } } } }`);
  },

  async fetchSourceManga(
    source: string,
    type: 'POPULAR' | 'LATEST' | 'SEARCH',
    page: number,
    query?: string,
  ): Promise<{ hasNextPage: boolean; mangas: MangaBase[] }> {
    const d = await gql(
      `mutation($input: FetchSourceMangaInput!) {
        fetchSourceManga(input: $input) { hasNextPage mangas { ${MANGA_BASE} } }
      }`,
      { input: { source, type, page, query: type === 'SEARCH' ? query : undefined } },
    );
    return d.fetchSourceManga;
  },

  async fetchExtensions(): Promise<Extension[]> {
    const d = await gql(`mutation {
      fetchExtensions(input: {}) {
        extensions { pkgName name lang versionName iconUrl isInstalled isObsolete hasUpdate }
      }
    }`);
    return d.fetchExtensions.extensions;
  },

  updateExtension(pkgName: string, patch: { install?: boolean; update?: boolean; uninstall?: boolean }) {
    return gql(
      `mutation($id: String!, $patch: UpdateExtensionPatchInput!) {
        updateExtension(input: { id: $id, patch: $patch }) { extension { pkgName isInstalled hasUpdate } }
      }`,
      { id: pkgName, patch },
    );
  },
};
