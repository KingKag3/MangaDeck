import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { connect, parseCallback } from '../lib/tracker';

/** AniList sends you back here after you approve: the token is in the address after the #. */
export default function AniListCallbackPage() {
  const nav = useNavigate();
  const [msg, setMsg] = useState('Finishing sign-in…');
  const [failed, setFailed] = useState(false);

  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React runs effects twice in development; the address is only readable once
    ran.current = true;
    const got = parseCallback(window.location.hash);
    // Take the token out of the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!got) {
      setFailed(true);
      setMsg('AniList did not send a token. Try Connect again from Settings.');
      return;
    }
    connect(got.token, got.expiresAt)
      .then((name) => {
        setMsg(`Connected as ${name}.`);
        setTimeout(() => nav('/settings', { replace: true }), 900);
      })
      .catch((e) => {
        setFailed(true);
        setMsg(`Could not finish: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [nav]);

  return (
    <div className="page narrow">
      <h1>AniList</h1>
      <p className={failed ? 'error-text' : ''}>{msg}</p>
      {failed && (
        <Link className="btn" to="/settings">
          Back to Settings
        </Link>
      )}
    </div>
  );
}
