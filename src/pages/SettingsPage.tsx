import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clearTokens, getAccessToken, getServer, setServer } from '../api/client';
import { M, Q } from '../api/queries';
import { PageHeader, errorToast, toast } from '../components/ui';
import { PRESET_LABELS, type PaceConfig, type PacePreset } from '../lib/pacer';
import LoginDialog from '../components/LoginDialog';
import { updateSettings, useSettings, type Direction, type Fit, type ReaderMode } from '../lib/settings';

export default function SettingsPage() {
  const s = useSettings();
  const qc = useQueryClient();
  const [server, setServerInput] = useState(getServer());
  const [showLogin, setShowLogin] = useState(false);
  const [signedIn, setSignedIn] = useState(!!getAccessToken());

  const info = useQuery({ queryKey: ['server-info'], queryFn: Q.serverInfo, retry: false });
  const parallel = useQuery({ queryKey: ['max-sources-parallel'], queryFn: Q.maxSourcesInParallel, retry: false });
  const setParallel = useMutation({
    mutationFn: M.setMaxSourcesInParallel,
    onSuccess: (n) => qc.setQueryData(['max-sources-parallel'], n),
    onError: errorToast,
  });
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const setCustom = (p: Partial<PaceConfig>) => updateSettings({ paceCustom: { ...s.paceCustom, ...p } });

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
        <h2>Bulk downloads</h2>
        <p className="muted small">
          Downloading many chapters at once can get you blocked by a source. Bulk downloads go one chapter at a time with a
          pause in between; the pause is randomised a little so it does not look like a robot.
        </p>
        <label className="field">
          <span>Speed</span>
          <select className="input" value={s.pacePreset} onChange={(e) => updateSettings({ pacePreset: e.target.value as PacePreset })}>
            {(Object.keys(PRESET_LABELS) as PacePreset[]).map((p) => (
              <option key={p} value={p}>
                {PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        {s.pacePreset === 'custom' && (
          <div className="grid-3">
            <label className="field">
              <span>Wait between chapters (seconds)</span>
              <input type="number" min={0} max={600} value={s.paceCustom.delay} onChange={(e) => setCustom({ delay: num(e.target.value) })} />
            </label>
            <label className="field">
              <span>Long break every N chapters (0 = never)</span>
              <input type="number" min={0} max={200} value={s.paceCustom.breakEvery} onChange={(e) => setCustom({ breakEvery: num(e.target.value) })} />
            </label>
            <label className="field">
              <span>Long break length (seconds)</span>
              <input type="number" min={0} max={3600} value={s.paceCustom.breakSecs} onChange={(e) => setCustom({ breakSecs: num(e.target.value) })} />
            </label>
          </div>
        )}
        <label className="field">
          <span>
            Sources downloading at the same time (server setting): {parallel.data === undefined ? '…' : parallel.data}
          </span>
          <input
            type="range"
            min={1}
            max={6}
            value={parallel.data ?? 6}
            disabled={parallel.data === undefined || setParallel.isPending}
            onChange={(e) => setParallel.mutate(Number(e.target.value))}
          />
        </label>
        <p className="muted small">
          Lower is gentler when a bulk job mixes several sources. Waits only run while Mangadeck is open in a browser tab.
        </p>
      </section>

      <section className="panel">
        <h2>Library</h2>
        <label className="check">
          <input type="checkbox" checked={s.showBadges} onChange={(e) => updateSettings({ showBadges: e.target.checked })} />
          <span>Show unread and download badges on covers</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.showAllLanguages} onChange={(e) => updateSettings({ showAllLanguages: e.target.checked })} />
          <span>Show sources in other languages (default: English only)</span>
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
