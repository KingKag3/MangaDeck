import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const READER: [string, string][] = [
  ['← →', 'Previous / next page (swapped for right-to-left)'],
  ['Space, Shift+Space', 'Next / previous page'],
  ['Page Down, Page Up', 'Next / previous page'],
  [']  [', 'Next / previous chapter'],
  ['M', 'Show or hide the controls'],
  ['F', 'Full screen'],
  ['Esc', 'Close the panel, or back to the series'],
];
const EVERYWHERE: [string, string][] = [
  ['?', 'Show this list'],
  ['/', 'Jump to the search box (library, Find)'],
];

/** `?` opens a list of the keys; `/` focuses the page's search box. Ignored while typing in a field. */
export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const inReader = useLocation().pathname.startsWith('/read/');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open && e.key === 'Escape') {
        e.stopImmediatePropagation(); // the reader would otherwise also leave the chapter
        setOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !open) {
        const box = document.querySelector<HTMLInputElement>('input[type="search"], input.search');
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
      }
    }
    window.addEventListener('keydown', onKey, true); // capture: runs before the reader's own handler
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  const rows = (list: [string, string][]) =>
    list.map(([k, d]) => (
      <tr key={k}>
        <td>
          <kbd>{k}</kbd>
        </td>
        <td>{d}</td>
      </tr>
    ));
  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="modal shortcuts" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table>
          <tbody>
            {rows(EVERYWHERE)}
            {inReader && (
              <>
                <tr>
                  <th colSpan={2}>In the reader</th>
                </tr>
                {rows(READER)}
              </>
            )}
          </tbody>
        </table>
        {!inReader && <p className="muted small">Open a chapter and press ? again to see the reader keys.</p>}
        <button className="btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
