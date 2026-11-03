import { useEffect, useMemo, useState } from 'react';
import { parseVolumeText, volumeRangesToText, type VolumeRange } from '../lib/volumes';

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
          One line per volume, like <code>1: 0-12</code> and <code>2: 13-26</code>. Or paste a volume list copied from a
          wiki or the publisher&apos;s page (lines such as &quot;Volume 1 … Chapter 1 … Chapter 12&quot;) and the chapter
          numbers are read out of it.
        </p>
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
