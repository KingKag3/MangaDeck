import { useEffect, useMemo, useRef, useState } from 'react';
import { canSaveToDisk, fileSizeIn, pickSaveFile, safeFileName, saveBlob, type FolderHandle, type SaveHandle } from '../lib/export';
import { checkParts, loadPart, mergeParts, sortParts, suggestName, type MergePart } from '../lib/merge';
import { errorToast, toast } from './ui';

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

/**
 * Merge several .cbz files (usually volumes) into one. The files are only read; the result is a new file.
 * Pages are copied without recompressing, so it is quick even for several GB.
 */
export default function MergeDialog({
  series: seriesHint,
  initialFiles,
  folder,
  onMerged,
  onClose,
}: {
  series?: string;
  /** Files to start with (e.g. the ones chosen on the manga page). */
  initialFiles?: File[];
  /** Save the result into this folder instead of asking where. */
  folder?: FolderHandle;
  /** Called after a successful merge with the source file names and the new file's name. */
  onMerged?: (sources: string[], into: string) => void;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<MergePart[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState(seriesHint ?? '');
  const [fileName, setFileName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [progress, setProgress] = useState<{ part: number; parts: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const working = progress !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !working && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, working]);

  // The series name comes from the files unless the dialog was opened for a particular series or the user typed one.
  const seriesFromFiles = parts.map((p) => p.meta.series).find(Boolean) ?? '';
  const seriesName = series || seriesFromFiles || 'Merged';
  useEffect(() => {
    if (!nameEdited && parts.length) setFileName(suggestName(seriesName, parts));
  }, [parts, seriesName, nameEdited]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initialFiles?.length) return;
    started.current = true;
    void add(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const warnings = useMemo(() => checkParts(parts), [parts]);
  const totalSize = parts.reduce((n, p) => n + p.file.size, 0);
  const totalPages = parts.reduce((n, p) => n + p.pages.length, 0);

  async function add(files: FileList | File[] | null) {
    if (!files?.length) return;
    setLoading(true);
    const fresh: MergePart[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      if (parts.some((p) => p.file.name === f.name && p.file.size === f.size)) continue; // already in the list
      try {
        fresh.push(await loadPart(f));
      } catch (e) {
        bad.push(e instanceof Error ? e.message : `${f.name}: could not be read`);
      }
    }
    setParts((cur) => sortParts([...cur, ...fresh]));
    setErrors(bad);
    setLoading(false);
    if (input.current) input.current.value = '';
  }

  const move = (i: number, d: number) =>
    setParts((cur) => {
      const n = [...cur];
      const j = i + d;
      if (j < 0 || j >= n.length) return cur;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function run() {
    if (parts.length < 2 || working) return;
    let name = (safeFileName(fileName.replace(/\.cbz$/i, '')) || 'Merged') + '.cbz';
    if (folder) {
      // Never overwrite a file that is already in the folder.
      const base = name.replace(/\.cbz$/i, '');
      for (let n = 2; (await fileSizeIn(folder, name)) > 0; n++) name = `${base} (${n}).cbz`;
    }
    if (
      !folder &&
      !canSaveToDisk &&
      totalSize > 1.5 * 1024 ** 3 &&
      !confirm(`This browser can't save straight to disk, so the whole ${mb(totalSize)} file is built in memory first. That can run out of memory. Continue?`)
    )
      return;
    // The save dialog has to open straight from the click.
    let handle: SaveHandle | null = null;
    if (folder) {
      const dir = folder;
      const fname = name;
      handle = { name: fname, createWritable: async () => (await (await dir.getFileHandle(fname, { create: true })).createWritable()) };
    } else if (canSaveToDisk) {
      try {
        handle = await pickSaveFile(name);
      } catch (e) {
        return errorToast(e);
      }
      if (!handle) return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setProgress({ part: 0, parts: parts.length });
    setResult(null);
    const writable = handle ? await handle.createWritable() : null;
    try {
      const { blob, pages, skipped } = await mergeParts({
        parts,
        series: seriesName,
        sink: writable ? (b) => writable.write(b) : undefined,
        onProgress: setProgress,
        signal: ac.signal,
      });
      if (writable) await writable.close();
      else if (blob) saveBlob(blob, name);
      setResult(`Saved ${handle?.name ?? name}${folder ? ` in the folder “${folder.name}”` : ''}: ${parts.length} files, ${pages} pages.${skipped ? ` ${skipped} repeated page${skipped === 1 ? ' was' : 's were'} skipped.` : ''} The original files were not changed.`);
      onMerged?.(parts.map((p) => p.file.name), name);
      toast('Merged into one .cbz');
    } catch (e) {
      if (writable) await writable.abort().catch(() => undefined);
      if (ac.signal.aborted) toast('Merge cancelled');
      else errorToast(e);
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !working && onClose()}>
      <div className="modal merge-dialog" role="dialog" aria-modal="true" aria-label="Merge .cbz files">
        <h2>Merge .cbz files</h2>
        <p className="muted small">
          Pick the volumes you downloaded and they are joined, in volume order, into one new .cbz. The files you pick are only read, never changed or
          deleted.
        </p>

        <input ref={input} type="file" accept=".cbz,.zip,application/vnd.comicbook+zip" multiple hidden onChange={(e) => void add(e.target.files)} />
        <div className="row gap wrap">
          <button className="btn" disabled={loading || working} onClick={() => input.current?.click()}>
            {parts.length ? 'Add more files…' : 'Choose .cbz files…'}
          </button>
          {parts.length > 1 && (
            <button className="btn ghost" disabled={working} onClick={() => setParts((p) => sortParts(p))}>
              Sort by volume
            </button>
          )}
          {loading && <span className="muted small">Reading…</span>}
        </div>

        {errors.length > 0 && (
          <div className="share-problems small">
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {parts.length > 0 && (
          <ul className="merge-list">
            {parts.map((p, i) => (
              <li key={`${p.file.name}-${p.file.size}`} className="row gap">
                <span className="merge-vol muted small">{p.volume !== null ? `Vol. ${p.volume}` : '–'}</span>
                <span className="grow merge-name" title={p.file.name}>
                  {p.file.name}
                </span>
                <span className="muted small">
                  {p.pages.length} pages · {mb(p.file.size)}
                </span>
                <button className="btn ghost" aria-label="Move up" disabled={working || i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="btn ghost" aria-label="Move down" disabled={working || i === parts.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="btn ghost" aria-label="Remove" disabled={working} onClick={() => setParts((cur) => cur.filter((x) => x !== p))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {warnings.length > 0 && (
          <div className="share-problems small">
            <b>Worth a look (you can still merge):</b>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {parts.length > 0 && (
          <>
            <label className="field">
              <span>Series name (goes into the file's details)</span>
              <input value={series || seriesFromFiles} onChange={(e) => setSeries(e.target.value)} disabled={working} />
            </label>
            <label className="field">
              <span>File name</span>
              <input
                value={fileName}
                onChange={(e) => {
                  setFileName(e.target.value);
                  setNameEdited(true);
                }}
                disabled={working}
              />
            </label>
            <p className="muted small">
              {parts.length} files, {totalPages} pages, about {mb(totalSize)} in total.
            </p>
          </>
        )}

        {progress && (
          <div className="progress" aria-label="progress">
            <div className="progress-bar" style={{ width: `${Math.round((progress.part / progress.parts) * 100)}%` }} />
          </div>
        )}
        {result && <p className="small merge-result">{result}</p>}

        <div className="row gap wrap share-actions">
          {working ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          ) : (
            <button className="btn primary" disabled={parts.length < 2} onClick={() => void run()}>
              {parts.length < 2 ? 'Choose at least 2 files' : `Merge ${parts.length} files`}
            </button>
          )}
          <button className="btn ghost" disabled={working} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
