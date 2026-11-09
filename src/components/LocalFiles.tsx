import { useCallback, useEffect, useMemo, useState } from 'react';
import { canPickFolder, pickFolder, type FolderHandle } from '../lib/export';
import { folderAccess, forgetFolder, getMerged, listCbz, loadFolder, markMerged, saveFolder, type FolderFile } from '../lib/folderStore';
import { nameMatchesSeries, pageVolumes, volumesInName } from '../lib/merge';
import { readZip } from '../lib/zipRead';
import MergeDialog from './MergeDialog';
import { errorToast } from './ui';

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

/** "1, 2, 4–6" from a list of numbers. */
function ranges(nums: number[]): string {
  const v = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < v.length; ) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++;
    out.push(j > i ? `${v[i]}–${v[j]}` : String(v[i]));
    i = j + 1;
  }
  return out.join(', ');
}

type Row = FolderFile & { volumes: number[]; mergedInto?: string };

/** What each file holds: from its name, or from its page names for a "complete" or unnumbered file. */
function buildRows(files: FolderFile[], covers: Record<string, number[]>, merged: Record<string, string>, title: string, showAll: boolean): Row[] {
  return files
    .filter((f) => showAll || nameMatchesSeries(f.name, title))
    .map((f) => ({ ...f, volumes: covers[f.name] ?? volumesInName(f.name), mergedInto: merged[f.name] }));
}

/**
 * A file that already holds several volumes (the complete series, or an earlier merge) plus single-volume files it does
 * not have yet: those are the new volumes to add to it.
 */
function updateFor(rows: Row[]): { base: Row; fresh: Row[] } | null {
  const bases = rows.filter((r) => r.volumes.length > 1 && !r.mergedInto);
  const base = bases.find((r) => /complete/i.test(r.name)) ?? [...bases].sort((a, b) => b.volumes.length - a.volumes.length)[0];
  if (!base) return null;
  // New volumes (one volume the base lacks) and "New chapters" files made from the series page (chapters after the base ends).
  const fresh = rows.filter(
    (r) => r !== base && !r.mergedInto && (/new chapters/i.test(r.name) || (r.volumes.length === 1 && !base.volumes.includes(r.volumes[0]))),
  );
  return fresh.length ? { base, fresh } : null;
}

/**
 * The .cbz files saved for this series, read from a folder the browser remembers. Shows which volumes you have and
 * which are missing, and merges the ones you tick into one file in the same folder. Chrome / Edge only.
 */
export default function LocalFiles({ id, title, knownVolumes }: { id: number; title: string; knownVolumes: number[] }) {
  const [folder, setFolder] = useState<FolderHandle | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'ask' | 'ready'>('loading');
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [merged, setMerged] = useState<Record<string, string>>({});
  const [covers, setCovers] = useState<Record<string, number[]>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [merging, setMerging] = useState(false);

  const refresh = useCallback(async (dir: FolderHandle) => {
    const list = await listCbz(dir);
    const m = getMerged(id);
    // Files with no volume in the name, or called "complete", are opened (only the directory is read) to see which volumes they hold.
    const cov: Record<string, number[]> = {};
    for (const f of list) {
      if (!nameMatchesSeries(f.name, title) || (volumesInName(f.name).length > 0 && !/complete/i.test(f.name))) continue;
      try {
        const v = pageVolumes((await readZip(f.file)).map((e) => e.name));
        if (v.length) cov[f.name] = v;
      } catch {
        /* not readable: it just shows without volumes */
      }
    }
    setFiles(list);
    setMerged(m);
    setCovers(cov);
    // Tick the new volumes together with the file they belong to; otherwise the single-volume files not merged yet.
    const rows = buildRows(list, cov, m, title, false);
    const upd = updateFor(rows);
    setPicked(new Set(upd ? [upd.base.name, ...upd.fresh.map((r) => r.name)] : rows.filter((r) => r.volumes.length === 1 && !r.mergedInto).map((r) => r.name)));
    setState('ready');
  }, [id, title]);

  useEffect(() => {
    let live = true;
    setState('loading');
    void (async () => {
      const dir = await loadFolder(id);
      if (!live) return;
      if (!dir) return setState('none');
      setFolder(dir);
      if (await folderAccess(dir, false)) await refresh(dir);
      else setState('ask');
    })();
    return () => {
      live = false;
    };
  }, [id, refresh]);

  async function choose() {
    try {
      const dir = await pickFolder();
      if (!dir) return;
      await saveFolder(id, dir);
      setFolder(dir);
      await refresh(dir);
    } catch (e) {
      errorToast(e);
    }
  }

  async function reconnect() {
    if (!folder) return;
    if (await folderAccess(folder, true)) await refresh(folder).catch(errorToast);
    else errorToast(new Error('Access to the folder was not allowed.'));
  }

  async function forget() {
    await forgetFolder(id);
    setFolder(null);
    setFiles([]);
    setState('none');
  }

  const rows: Row[] = useMemo(() => buildRows(files, covers, merged, title, showAll), [files, covers, merged, title, showAll]);
  const update = useMemo(() => updateFor(rows), [rows]);
  const hidden = files.length - files.filter((f) => nameMatchesSeries(f.name, title)).length;
  const have = rows.flatMap((r) => r.volumes);
  const missing = knownVolumes.filter((v) => !have.includes(v));
  const chosen = rows.filter((r) => picked.has(r.name));

  if (!canPickFolder) return null;

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(name)) n.add(name);
      return n;
    });

  return (
    <section className="linked-sources local-files">
      <div className="row gap wrap">
        <h3>Your .cbz files</h3>
        {folder && <span className="muted small">in the folder “{folder.name}”</span>}
        <span className="grow" />
        {state === 'ready' && (
          <button className="link-btn" onClick={() => folder && void refresh(folder)}>
            Refresh
          </button>
        )}
        {folder && (
          <button className="link-btn" onClick={() => void choose()}>
            Change folder
          </button>
        )}
        {folder && (
          <button className="link-btn" onClick={() => void forget()}>
            Forget
          </button>
        )}
      </div>

      {state === 'loading' && <p className="muted small">Looking…</p>}
      {state === 'none' && (
        <>
          <p className="muted small">
            Tell Mangadeck which folder you save this series' .cbz files in. It then shows which volumes you have and can merge them into one file. Exporting
            “each volume” also sets this folder for you.
          </p>
          <button className="btn" onClick={() => void choose()}>
            Choose folder…
          </button>
        </>
      )}
      {state === 'ask' && (
        <>
          <p className="muted small">The browser needs your OK to look in that folder again.</p>
          <button className="btn" onClick={() => void reconnect()}>
            Reconnect folder
          </button>
        </>
      )}

      {state === 'ready' && (
        <>
          <p className="small">
            {rows.length === 0
              ? 'No .cbz files for this series in the folder yet.'
              : `${rows.length} file${rows.length === 1 ? '' : 's'} · volumes ${ranges(have) || 'none known'}${missing.length ? ` · not in the folder: ${ranges(missing)}` : knownVolumes.length ? ' · nothing missing' : ''}`}
          </p>
          {rows.length > 0 && (
            <ul className="merge-list">
              {rows.map((r) => (
                <li key={r.name} className="row gap">
                  <input type="checkbox" checked={picked.has(r.name)} onChange={() => toggle(r.name)} aria-label={`Include ${r.name}`} />
                  <span className="merge-vol muted small">{r.volumes.length ? (r.volumes.length > 1 ? `Vols. ${ranges(r.volumes)}` : `Vol. ${r.volumes[0]}`) : '–'}</span>
                  <span className="grow merge-name" title={r.name}>
                    {r.name}
                  </span>
                  <span className="muted small">{r.mergedInto ? `merged into ${r.mergedInto}` : mb(r.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {update && (
            <div className="row gap wrap update-hint">
              <span className="small">
                New since <b>{update.base.name}</b>: {update.fresh.map((r) => (/new chapters/i.test(r.name) ? r.name.replace(/\.cbz$/i, '').replace(/^.* - /, '') : `Vol. ${r.volumes[0]}`)).join(', ')}.
              </span>
              <button
                className="btn primary"
                onClick={() => {
                  setPicked(new Set([update.base.name, ...update.fresh.map((r) => r.name)]));
                  setMerging(true);
                }}
              >
                Add to it
              </button>
            </div>
          )}
          <div className="row gap wrap">
            <button className="btn" disabled={chosen.length < 2} onClick={() => setMerging(true)}>
              {chosen.length < 2 ? 'Tick at least 2 files to merge' : `Merge ${chosen.length} selected`}
            </button>
            {hidden > 0 && (
              <button className="link-btn" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Only this series' : `Show ${hidden} other file${hidden === 1 ? '' : 's'} in the folder`}
              </button>
            )}
          </div>
        </>
      )}

      {merging && folder && (
        <MergeDialog
          series={title}
          folder={folder}
          initialFiles={chosen.map((r) => r.file)}
          onMerged={(sources, into) => {
            markMerged(id, sources, into);
            void refresh(folder);
          }}
          onClose={() => setMerging(false)}
        />
      )}
    </section>
  );
}
