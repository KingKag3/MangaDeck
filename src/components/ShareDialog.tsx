import { useEffect, useMemo, useState } from 'react';
import { saveBlob } from '../lib/export';
import { COMMUNITY_ENABLED } from '../lib/community';
import { sendSubmission } from '../lib/remoteRules';
import { makeSubmission, submissionFileName, submissionText, validateRanges } from '../lib/volumeShare';
import type { VolumeRange } from '../lib/volumes';
import { errorToast, toast } from './ui';

/**
 * Send a hand-made volume list in, so it can join the shared list everyone gets. Only the title and the chapter ranges
 * are included; the user sees exactly what will be sent before anything leaves their machine.
 */
export default function ShareDialog({ title, ranges, onClose }: { title: string; ranges: VolumeRange[]; onClose: () => void }) {
  const [source, setSource] = useState('');
  const problems = useMemo(() => validateRanges(ranges), [ranges]);
  const submission = useMemo(() => makeSubmission(title, ranges, source.trim() || 'Shared by a user'), [title, ranges, source]);
  const text = useMemo(() => submissionText(submission), [submission]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    setSending(true);
    try {
      await sendSubmission(submission);
      setSent(true);
      toast('Sent. Thank you! It shows up for everyone once it is approved.');
    } catch (e) {
      errorToast(e);
    } finally {
      setSending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied. Send it to whoever looks after the shared list.');
    } catch (e) {
      errorToast(e);
    }
  }

  function download() {
    saveBlob(new Blob([text], { type: 'application/json' }), submissionFileName(submission));
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-dialog" role="dialog" aria-modal="true" aria-label="Share these volumes">
        <h2>Share the volumes for {title}</h2>
        <p className="muted small">
          Help everyone who uses Mangadeck: once this list is added to the shared one, the series fills in by itself for them. This sends only the
          title and the chapter numbers of each volume below, nothing about you or your library.
        </p>

        {problems.length > 0 ? (
          <div className="share-problems small">
            <b>Fix these first (use Edit volumes):</b>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Where did the list come from? (optional, e.g. a wiki name)</span>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Shared by a user" maxLength={80} />
            </label>
            <textarea className="input volume-text" readOnly value={text} rows={9} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          </>
        )}

        <div className="row gap wrap share-actions">
          {COMMUNITY_ENABLED && (
            <button className="btn primary" disabled={problems.length > 0 || sending || sent} onClick={send}>
              {sent ? 'Sent' : sending ? 'Sending…' : 'Send'}
            </button>
          )}
          <button className={COMMUNITY_ENABLED ? 'btn' : 'btn primary'} disabled={problems.length > 0} onClick={copy}>
            Copy
          </button>
          <button className="btn" disabled={problems.length > 0} onClick={download}>
            Download file
          </button>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {!COMMUNITY_ENABLED && (
          <p className="muted small">Sending is not switched on yet, so send the copied text or the file to the person who gave you the app.</p>
        )}
      </div>
    </div>
  );
}
