import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clearTokens, getAccessToken, getServer, setServer } from '../api/client';
import { Q } from '../api/queries';
import { PageHeader, toast } from '../components/ui';
import LoginDialog from '../components/LoginDialog';
import { updateSettings, useSettings, type Direction, type Fit, type ReaderMode } from '../lib/settings';

export default function SettingsPage() {
  const s = useSettings();
  const qc = useQueryClient();
  const [server, setServerInput] = useState(getServer());
  const [showLogin, setShowLogin] = useState(false);
  const [signedIn, setSignedIn] = useState(!!getAccessToken());

  const info = useQuery({ queryKey: ['server-info'], queryFn: Q.serverInfo, retry: false });

  function saveServer() {
    setServer(server);
    qc.invalidateQueries();
    toast(server ? `Using ${server}` : 'Using same-origin /api');
  }

  return (
    <div className="page narrow">
      <PageHeader title="Settings" />

      <section className="panel">
        <h2>Connection</h2>
        <label className="field">
          <span>Server URL</span>
          <input
            value={server}
            onChange={(e) => setServerInput(e.target.value)}
            placeholder="Leave empty to use this site's /api (recommended with the bundled proxy)"
          />
        </label>
        <div className="row gap wrap">
          <button className="btn primary" onClick={saveServer}>
            Save &amp; reconnect
          </button>
          {signedIn ? (
            <button
              className="btn ghost"
              onClick={() => {
                clearTokens();
                setSignedIn(false);
                qc.invalidateQueries();
              }}
            >
              Sign out
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setShowLogin(true)}>
              Sign in
            </button>
          )}
        </div>
        <p className="muted small">
          {info.isLoading && 'Checking server…'}
          {info.data && `Connected to ${info.data.name} ${info.data.version} (${info.data.buildType}).`}
          {info.error && `Can't reach the server: ${(info.error as Error).message}`}
        </p>
        <p className="muted small">
          Direct URLs to another origin need CORS enabled on the server. The Docker setup proxies <code>/api</code> for
          you, so there is nothing to configure.
        </p>
      </section>

      <section className="panel">
        <h2>Reader defaults</h2>
        <div className="form-grid">
          <label className="field">
            <span>Mode</span>
            <select className="input" value={s.mode} onChange={(e) => updateSettings({ mode: e.target.value as ReaderMode })}>
              <option value="paged">Paged</option>
              <option value="webtoon">Webtoon (vertical scroll)</option>
            </select>
          </label>
          <label className="field">
            <span>Reading direction (paged)</span>
            <select className="input" value={s.direction} onChange={(e) => updateSettings({ direction: e.target.value as Direction })}>
              <option value="rtl">Right to left (manga)</option>
              <option value="ltr">Left to right</option>
            </select>
          </label>
          <label className="field">
            <span>Image fit</span>
            <select className="input" value={s.fit} onChange={(e) => updateSettings({ fit: e.target.value as Fit })}>
              <option value="screen">Fit screen</option>
              <option value="width">Fit width</option>
              <option value="height">Fit height</option>
              <option value="original">Original size</option>
            </select>
          </label>
          <label className="field">
            <span>Preload pages ahead: {s.preload}</span>
            <input type="range" min={0} max={10} value={s.preload} onChange={(e) => updateSettings({ preload: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Auto-download next chapters while reading: {s.autoDownloadNext || 'off'}</span>
            <input
              type="range"
              min={0}
              max={5}
              value={s.autoDownloadNext}
              onChange={(e) => updateSettings({ autoDownloadNext: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="muted small">Each manga can override mode, direction and fit from the reader's settings panel.</p>
      </section>

      <section className="panel">
        <h2>Library</h2>
        <label className="check">
          <input type="checkbox" checked={s.showBadges} onChange={(e) => updateSettings({ showBadges: e.target.checked })} />
          <span>Show unread and download badges on covers</span>
        </label>
        <label className="field">
          <span>Cover size: {s.gridWidth}px</span>
          <input type="range" min={100} max={260} step={10} value={s.gridWidth} onChange={(e) => updateSettings({ gridWidth: Number(e.target.value) })} />
        </label>
      </section>

      {showLogin && (
        <LoginDialog
          onDone={() => {
            setShowLogin(false);
            setSignedIn(true);
            qc.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}
