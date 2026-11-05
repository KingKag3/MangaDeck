import { useCallback, useEffect, useMemo, useState } from 'react';
import { canPickFolder, pickFolder, type FolderHandle } from '../lib/export';
import { folderAccess, forgetFolder, getMerged, listCbz, loadFolder, markMerged, saveFolder, type FolderFile } from '../lib/folderStore';
import { nameMatchesSeries, volumesInName } from '../lib/merge';
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

/**
 * The .cbz files saved for this series, read from a folder the browser remembers. Shows which volumes you have and
 * which are missing, and merges the ones you tick into one file in the same folder. Chrome / Edge only.
 */
export default function LocalFiles({ id, title, knownVolumes }: { id: number; title: string; knownVolumes: number[] }) {
  const [folder, setFolder] = useState<FolderHandle | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'ask' | 'ready'>('loading');
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [merged, setMerged] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [merging, setMerging] = useState(false);

  const refresh = useCallback(async (dir: FolderHandle) => {
    const list = await listCbz(dir);
    const m = getMerged(id);
    setFiles(list);
    setMerged(m);
    // Start with the single-volume files that have not been merged yet ticked.
    setPicked(new Set(list.filter((f) => volumesInName(f.name).length === 1 && !m[f.name]).map((f) => f.name)));
    setState('ready');
  }, [id]);

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

  const rows: Row[] = useMemo(
    () =>
      files
        .filter((f) => showAll || nameMatchesSeries(f.name, title))
        .map((f) => ({ ...f, volumes: volumesInName(f.name), mergedInto: merged[f.name] })),
    [files, merged, title, showAll],
  );
  const hidden = files.length - files.filter((f) => nameMatchesSeries(f.name, title)).length;
  const have = rows.filter((r) => !r.mergedInto || files.some((f) => f.name === r.mergedInto)).flatMap((r) => r.volumes);
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
