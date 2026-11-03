import { useEffect, useMemo, useState } from 'react';
import { parseVolumeText, volumeRangesToText, type VolumeRange } from '../lib/volumes';
import { importVolumesFromWiki } from '../lib/wikiImport';

/**
 * Enter official volumes by hand: one line per volume ("1: 0-12"), or paste a volume list copied from a wiki or
 * publisher page and let Mangadeck pick the chapter numbers out of it.
 */
export default function VolumeDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: VolumeRange[] | undefined;
  onSave: (ranges: VolumeRange[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial ? volumeRangesToText(initial) : '');
  const ranges = useMemo(() => parseVolumeText(text), [text]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  async function importLink() {
    setBusy(true);
    setStatus({ text: 'Reading the wiki…', error: false });
    try {
      const { ranges: found, host } = await importVolumesFromWiki(link, (n) => setStatus({ text: `Reading the wiki… ${n} volumes so far`, error: false }));
      setText(volumeRangesToText(found));
      setStatus({ text: `Read ${found.length} volume${found.length === 1 ? '' : 's'} from ${host}. Check them, then save.`, error: false });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal volume-dialog" role="dialog" aria-modal="true" aria-label="Set volumes">
        <h2>Volumes for {title}</h2>
        <p className="muted small">
          One line per volume, like <code>1: 0-12</code> and <code>2: 13-26</code>. Or import them from a wiki link (a Wikipedia list, or one volume page of a Fandom wiki: the other volumes are
          followed automatically), or paste a volume list copied from any page and the chapter numbers are read out of it.
        </p>
        <div className="row gap volume-import">
          <input
            className="input grow"
            type="url"
            placeholder="Or paste a wiki link, e.g. https://….fandom.com/wiki/Manga_Volume_1"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && link.trim() && !busy && importLink()}
          />
          <button className="btn" disabled={busy || !link.trim()} onClick={importLink}>
            {busy ? 'Reading…' : 'Import'}
          </button>
        </div>
        {status && <div className={`small volume-status ${status.error ? 'error-text' : 'muted'}`}>{status.text}</div>}
        <textarea
          className="input volume-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'1: 0-12\n2: 13-26\n3: 27-40'}
          rows={10}
          spellCheck={false}
          autoFocus
        />
        <div className="muted small volume-preview">
          {ranges.length === 0
            ? 'No volumes found yet.'
            : `${ranges.length} volume${ranges.length === 1 ? '' : 's'}: ${ranges
                .slice(0, 6)
                .map((r) => `${r.volume} (ch. ${r.first}–${r.last})`)
                .join(', ')}${ranges.length > 6 ? ', …' : ''}`}
        </div>
        <div className="row gap wrap">
          <button className="btn primary" disabled={ranges.length === 0} onClick={() => onSave(ranges)}>
            Save volumes
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
