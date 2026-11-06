import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type Chapter } from '../api/queries';
import { ErrorBox, Spinner, toast } from '../components/ui';
import { chapterLabel } from '../lib/format';
import { groupPrefFor, visibleChapters } from '../lib/groups';
import { removeIfAuto, startSaving } from '../lib/offline';
import { trackRead } from '../lib/tracker';
import { preloadImage, useImage } from '../lib/useImage';
import {
  effectivePrefs,
  getSettings,
  updateMangaPrefs,
  updateSettings,
  useSettings,
  type Direction,
  type Fit,
  type ReaderMode,
} from '../lib/settings';

export default function ReaderPage() {
  const { mangaId, chapterId } = useParams();
  // key = chapterId so moving to the next chapter fully resets reader state
  return <ReaderInner key={chapterId} mangaId={Number(mangaId)} chapterId={Number(chapterId)} />;
}

function PageImage({
  path,
  enabled,
  className,
  alt,
}: {
  path: string;
  enabled: boolean;
  className?: string;
  alt: string;
}) {
  const [attempt, setAttempt] = useState(0);
  return <PageImageInner key={attempt} path={path} enabled={enabled} className={className} alt={alt} onRetry={() => setAttempt(attempt + 1)} />;
}

function PageImageInner({
  path,
  enabled,
  className,
  alt,
  onRetry,
}: {
  path: string;
  enabled: boolean;
  className?: string;
  alt: string;
  onRetry: () => void;
}) {
  const { src, failed } = useImage(path, enabled);
  const [errored, setErrored] = useState(false);
  if (failed || errored) {
    return (
      <button
        className="page-failed"
        onClick={(e) => {
          e.stopPropagation();
          onRetry();
        }}
      >
        Page failed to load — tap to retry
      </button>
    );
  }
  if (!src) return <div className="page-skeleton" />;
  return <img className={className} src={src} alt={alt} draggable={false} onError={() => setErrored(true)} />;
}

function ReaderInner({ mangaId, chapterId }: { mangaId: number; chapterId: number }) {
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const settings = useSettings();
  const prefs = effectivePrefs(settings, mangaId);

  const manga = useQuery({ queryKey: ['manga', mangaId], queryFn: () => Q.manga(mangaId) });
  const chapters = useQuery({ queryKey: ['chapters', mangaId], queryFn: () => Q.chapters(mangaId) });
  const pagesQ = useQuery({
    queryKey: ['pages', chapterId],
    queryFn: () => M.fetchPages(chapterId),
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
  });

  const pages = pagesQ.data ?? [];
  const total = pages.length;

  // newest first; follows the scanlation group picked on the manga page, so next/previous skip duplicates
  const everything = chapters.data ?? [];
  const groupPref = groupPrefFor(settings, mangaId);
  const list = useMemo(() => visibleChapters(everything, groupPref, chapterId), [everything, groupPref, chapterId]);
  const idx = list.findIndex((c) => c.id === chapterId);
  const chapter: Chapter | undefined = idx >= 0 ? list[idx] : undefined;
  const nextChapter = idx > 0 ? list[idx - 1] : undefined; // newer
  const prevChapter = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : undefined; // older

  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  /* ----- resume position once we know both chapter state and pages ----- */
  const startedRef = useRef(false);
  const startAt = useMemo(() => {
    if (!total) return 0;
    if ((location.state as { startAt?: string } | null)?.startAt === 'last') return total - 1;
    if (chapter && !chapter.isRead && chapter.lastPageRead > 0) return Math.min(chapter.lastPageRead, total - 1);
    return 0;
  }, [total, chapter, location.state]);

  useEffect(() => {
    if (startedRef.current || !total || !chapter) return;
    startedRef.current = true;
    setCurrent(startAt);
    setReady(true);
  }, [total, chapter, startAt]);

  /* ----- progress saving ----- */
  const dirty = useRef(false);
  const numRef = useRef(-1); // chapter number of the open chapter, for AniList
  numRef.current = chapter?.chapterNumber ?? -1;
  const finished = useRef(false); // reached the last page
  const timer = useRef<number | undefined>(undefined);
  const live = useRef({ current: 0, total: 0 });
  live.current = { current, total };

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !live.current.total) return Promise.resolve();
    dirty.current = false;
    const { current: cur, total: tot } = live.current;
    const done = cur >= tot - 1;
    if (done) {
      trackRead(mangaId, numRef.current);
      finished.current = true;
    }
    return M.updateChapter(chapterId, done ? { isRead: true, lastPageRead: cur } : { lastPageRead: cur }).catch(() => undefined);
  }, [chapterId, mangaId]);

  const go = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(live.current.total - 1, i));
      setCurrent(clamped);
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  useEffect(
    () => () => {
      void flush().then(() => {
        if (finished.current && getSettings().clearReadSaved) void removeIfAuto(chapterId).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ['chapters', mangaId] });
        qc.invalidateQueries({ queryKey: ['manga', mangaId] });
        qc.invalidateQueries({ queryKey: ['library'] });
        qc.invalidateQueries({ queryKey: ['updates'] });
        qc.invalidateQueries({ queryKey: ['history'] });
      });
    },
    [flush, qc, mangaId],
  );

  // Reaching the last page counts as finishing the chapter: save immediately.
  useEffect(() => {
    if (ready && total && current === total - 1 && dirty.current) void flush();
  }, [ready, current, total, flush]);

  /* ----- auto-download upcoming chapters ----- */
  const autoDl = useRef(false);
  useEffect(() => {
    if (autoDl.current || !settings.autoDownloadNext || idx < 0) return;
    autoDl.current = true;
    const upcoming = list
      .slice(Math.max(0, idx - settings.autoDownloadNext), idx)
      .filter((c) => !c.isDownloaded && !c.isRead)
      .map((c) => c.id);
    if (upcoming.length) {
      M.enqueueDownloads(upcoming)
        .then(() => M.startDownloader())
        .catch(() => undefined);
    }
  }, [idx, list, settings.autoDownloadNext]);

  /* ----- save upcoming chapters on this device (offline reading) ----- */
  const savedAhead = useRef(false);
  const mangaTitle = manga.data?.title;
  useEffect(() => {
    if (savedAhead.current || !settings.saveAhead || !ready || idx < 0 || !mangaTitle || !navigator.onLine) return;
    savedAhead.current = true;
    const upcoming = list
      .slice(Math.max(0, idx - settings.saveAhead), idx)
      .reverse() // nearest chapter first
      .filter((c) => !c.isRead)
      .map((c) => ({ id: c.id, mangaId, name: c.name, chapterNumber: c.chapterNumber, isDownloaded: c.isDownloaded }));
    if (upcoming.length) void startSaving(upcoming, mangaTitle, true).catch(() => undefined);
  }, [ready, idx, list, mangaId, mangaTitle, settings.saveAhead]);

  /* ----- preloading ----- */
  useEffect(() => {
    if (!ready) return;
    for (let i = 1; i <= settings.preload; i++) if (pages[current + i]) preloadImage(pages[current + i]);
    if (pages[current - 1]) preloadImage(pages[current - 1]);
  }, [ready, current, pages, settings.preload]);

  /* ----- navigation helpers ----- */
  const goNextChapter = useCallback(() => {
    if (!nextChapter) {
      toast('You reached the latest chapter');
      return;
    }
    nav(`/read/${mangaId}/${nextChapter.id}`, { replace: true });
  }, [nav, mangaId, nextChapter]);

  const goPrevChapter = useCallback(() => {
    if (!prevChapter) {
      toast('This is the first chapter');
      return;
    }
    nav(`/read/${mangaId}/${prevChapter.id}`, { replace: true, state: { startAt: 'last' } });
  }, [nav, mangaId, prevChapter]);

  const nextPage = useCallback(() => {
    if (live.current.current >= live.current.total - 1) goNextChapter();
    else go(live.current.current + 1);
  }, [go, goNextChapter]);

  const prevPage = useCallback(() => {
    if (live.current.current <= 0) goPrevChapter();
    else go(live.current.current - 1);
  }, [go, goPrevChapter]);

  /* ----- keyboard ----- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      // The page slider keeps focus after you use it; it must not swallow the reader's keys
      // (otherwise you can't step past the last page into the next chapter).
      const isRange = tag === 'INPUT' && (t as HTMLInputElement).type === 'range';
      if (t && (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && !isRange)) && e.key !== 'Escape') return;
      const rtl = prefs.direction === 'rtl' && prefs.mode === 'paged';
      switch (e.key) {
        case 'ArrowRight':
          if (prefs.mode === 'paged') {
            e.preventDefault(); // stop the focused slider from also stepping natively
            (rtl ? prevPage : nextPage)();
          }
          break;
        case 'ArrowLeft':
          if (prefs.mode === 'paged') {
            e.preventDefault();
            (rtl ? nextPage : prevPage)();
          }
          break;
        case ' ':
          if (prefs.mode === 'paged') {
            e.preventDefault();
            (e.shiftKey ? prevPage : nextPage)();
          }
          break;
        case 'PageDown':
          if (prefs.mode === 'paged') nextPage();
          break;
        case 'PageUp':
          if (prefs.mode === 'paged') prevPage();
          break;
        case ']':
          goNextChapter();
          break;
        case '[':
          goPrevChapter();
          break;
        case 'm':
          setUiVisible((v) => !v);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'Escape':
          if (panelOpen) setPanelOpen(false);
          else nav(`/manga/${mangaId}`);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prefs.direction, prefs.mode, nextPage, prevPage, goNextChapter, goPrevChapter, panelOpen, nav, mangaId]);

  /* ----- render ----- */
  if (pagesQ.isLoading || chapters.isLoading) return <Spinner label="Loading chapter…" />;
  if (pagesQ.error) return <ErrorBox error={pagesQ.error} retry={() => pagesQ.refetch()} />;
  if (!total) return <ErrorBox error={new Error('This chapter has no pages')} />;
  if (!ready) return <Spinner label="Opening chapter…" />;

  const title = manga.data?.title ?? '';

  return (
    <div className={`reader fit-${prefs.fit} mode-${prefs.mode}`} data-ui={uiVisible ? 'on' : 'off'}>
      <header className="reader-bar top">
        <button className="btn ghost" onClick={() => nav(`/manga/${mangaId}`)} aria-label="Back to manga">
          ←
        </button>
        <div className="reader-title">
          <div className="row-title">{title}</div>
          <div className="muted small">{chapter ? chapterLabel(chapter) : ''}</div>
        </div>
        <button className="btn ghost" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
          ⛶
        </button>
        <button className="btn ghost" onClick={() => setPanelOpen(!panelOpen)} aria-label="Reader settings">
          ⚙
        </button>
      </header>

      {panelOpen && (
        <div className="reader-panel" onClick={(e) => e.stopPropagation()}>
          <label className="field">
            <span>Mode</span>
            <select className="input" value={prefs.mode} onChange={(e) => updateMangaPrefs(mangaId, { mode: e.target.value as ReaderMode })}>
              <option value="paged">Paged</option>
              <option value="webtoon">Webtoon</option>
            </select>
          </label>
          <label className="field">
            <span>Direction</span>
            <select
              className="input"
              value={prefs.direction}
              disabled={prefs.mode === 'webtoon'}
              onChange={(e) => updateMangaPrefs(mangaId, { direction: e.target.value as Direction })}
            >
              <option value="rtl">Right to left</option>
              <option value="ltr">Left to right</option>
            </select>
          </label>
          <label className="field">
            <span>Fit</span>
            <select className="input" value={prefs.fit} onChange={(e) => updateMangaPrefs(mangaId, { fit: e.target.value as Fit })}>
              <option value="screen">Fit screen</option>
              <option value="width">Fit width</option>
              <option value="height">Fit height</option>
              <option value="original">Original</option>
            </select>
          </label>
          <div className="row gap wrap">
            <button
              className="btn"
              onClick={() => {
                updateSettings({ mode: prefs.mode, direction: prefs.direction, fit: prefs.fit });
                updateMangaPrefs(mangaId, null);
                toast('Saved as your default');
              }}
            >
              Use as default
            </button>
            <button className="btn ghost" onClick={() => setPanelOpen(false)}>
              Close
            </button>
          </div>
          <p className="muted small">Changes here apply to this manga only. Keys: ←/→ pages, [ ] chapters, M menu, F fullscreen.</p>
        </div>
      )}

      {prefs.mode === 'paged' ? (
        <PagedView
          pages={pages}
          current={current}
          direction={prefs.direction}
          onNext={nextPage}
          onPrev={prevPage}
          onToggleUi={() => setUiVisible((v) => !v)}
        />
      ) : (
        <WebtoonView
          pages={pages}
          current={current}
          ready={ready}
          startAt={startAt}
          preload={settings.preload}
          onPage={go}
          onToggleUi={() => setUiVisible((v) => !v)}
          nextChapter={nextChapter}
          onNextChapter={goNextChapter}
        />
      )}

      <footer className="reader-bar bottom">
        <button className="btn ghost" onClick={goPrevChapter} disabled={!prevChapter} aria-label="Previous chapter">
          ⏮
        </button>
        <input
          className="slider"
          type="range"
          min={0}
          max={total - 1}
          value={current}
          style={{ direction: prefs.mode === 'paged' && prefs.direction === 'rtl' ? 'rtl' : 'ltr' }}
          onChange={(e) => go(Number(e.target.value))}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="Page"
        />
        <span className="page-count">
          {current + 1} / {total}
        </span>
        <button className="btn ghost" onClick={goNextChapter} disabled={!nextChapter} aria-label="Next chapter">
          ⏭
        </button>
      </footer>
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

/* ---------------- Paged ---------------- */

function PagedView({
  pages,
  current,
  direction,
  onNext,
  onPrev,
  onToggleUi,
}: {
  pages: string[];
  current: number;
  direction: Direction;
  onNext: () => void;
  onPrev: () => void;
  onToggleUi: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    box.current?.scrollTo({ top: 0, left: 0 });
  }, [current]);

  function onClick(e: React.MouseEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.3) (direction === 'rtl' ? onNext : onPrev)();
    else if (x > 0.7) (direction === 'rtl' ? onPrev : onNext)();
    else onToggleUi();
  }

  return (
    <div
      ref={box}
      className="paged"
      onClick={onClick}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          e.preventDefault();
          const forward = direction === 'rtl' ? dx > 0 : dx < 0;
          (forward ? onNext : onPrev)();
        }
      }}
    >
      <PageImage key={current} path={pages[current]} enabled alt={`Page ${current + 1}`} className="page-img" />
    </div>
  );
}

/* ---------------- Webtoon ---------------- */

function WebtoonView({
  pages,
  current,
  ready,
  startAt,
  preload,
  onPage,
  onToggleUi,
  nextChapter,
  onNextChapter,
}: {
  pages: string[];
  current: number;
  ready: boolean;
  startAt: number;
  preload: number;
  onPage: (i: number) => void;
  onToggleUi: () => void;
  nextChapter?: Chapter;
  onNextChapter: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const resumed = useRef(false);
  const programmatic = useRef(false);

  // Resume to the saved page once.
  useEffect(() => {
    if (!ready || resumed.current) return;
    resumed.current = true;
    if (startAt > 0) {
      programmatic.current = true;
      requestAnimationFrame(() => {
        els.current[startAt]?.scrollIntoView({ block: 'start' });
        setTimeout(() => (programmatic.current = false), 200);
      });
    }
  }, [ready, startAt]);

  // Track which page is at the top of the viewport.
  useEffect(() => {
    const c = container.current;
    if (!c) return;
    let raf = 0;
    function measure() {
      raf = 0;
      if (programmatic.current) return;
      const line = window.innerHeight * 0.35;
      let found = 0;
      for (let i = 0; i < els.current.length; i++) {
        const el = els.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= line) found = i;
        else break;
      }
      const atBottom = window.innerHeight + c!.scrollTop >= c!.scrollHeight - 8;
      onPage(atBottom ? els.current.length - 1 : found);
    }
    function onScroll() {
      if (!raf) raf = requestAnimationFrame(measure);
    }
    c.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      c.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onPage]);

  // Jumping with the slider scrolls the strip.
  const lastJump = useRef(current);
  useEffect(() => {
    if (!ready) return;
    const el = els.current[current];
    const c = container.current;
    if (!el || !c || Math.abs(current - lastJump.current) < 1) {
      lastJump.current = current;
      return;
    }
    const r = el.getBoundingClientRect();
    const onScreen = r.top <= window.innerHeight * 0.35 + 2 && r.bottom > window.innerHeight * 0.35;
    if (!onScreen) {
      programmatic.current = true;
      el.scrollIntoView({ block: 'start' });
      setTimeout(() => (programmatic.current = false), 200);
    }
    lastJump.current = current;
  }, [current, ready]);

  return (
    <div ref={container} className="webtoon" onClick={onToggleUi}>
      <div className="webtoon-strip">
        {pages.map((p, i) => (
          <div key={p} ref={(el) => (els.current[i] = el)} className="webtoon-page">
            <PageImage
              path={p}
              enabled={i >= current - 3 && i <= current + preload + 3}
              alt={`Page ${i + 1}`}
              className="page-img"
            />
          </div>
        ))}
        <div className="webtoon-end">
          {nextChapter ? (
            <button
              className="btn primary big"
              onClick={(e) => {
                e.stopPropagation();
                onNextChapter();
              }}
            >
              Next: {chapterLabel(nextChapter)}
            </button>
          ) : (
            <div className="muted">You're all caught up.</div>
          )}
        </div>
      </div>
    </div>
  );
}
