import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clearTokens, getAccessToken, getServer, setServer } from '../api/client';
import { M, Q } from '../api/queries';
import { PageHeader, errorToast, toast } from '../components/ui';
import { PRESET_LABELS, type PaceConfig, type PacePreset } from '../lib/pacer';
import LoginDialog from '../components/LoginDialog';
import { Link } from 'react-router-dom';
import { authorizeUrl, disconnect, isConnected, redirectUrl, setClientId, useTracker } from '../lib/tracker';
import { groupsAcrossLibrary } from '../lib/groups';
import { applyBackup, buildBackup, describeBackup, parseBackup } from '../lib/backup';
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

  const tracker = useTracker();
  const [showGroups, setShowGroups] = useState(false);
  const groupList = useQuery({
    queryKey: ['libraryGroups'],
    queryFn: async () => groupsAcrossLibrary(await Q.libraryGroups()),
    enabled: showGroups,
    staleTime: 5 * 60_000,
  });

  function downloadBackup() {
    const file = buildBackup(localStorage);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    a.download = `mangadeck-backup-${file.savedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup saved');
  }

  async function restoreBackup(file: File | undefined) {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const when = backup.savedAt ? ` from ${backup.savedAt.slice(0, 10)}` : '';
      if (!window.confirm(`Restore the backup${when}?

It holds ${describeBackup(backup)}.
This replaces those settings in this browser (the server and your sign-in are not touched).`)) return;
      applyBackup(localStorage, backup);
      toast('Backup restored. Reloading…');
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      errorToast(e);
    }
  }

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
          <label className="field">
            <span>Save next chapters on this device while reading: {s.saveAhead || 'off'}</span>
            <input type="range" min={0} max={5} value={s.saveAhead} onChange={(e) => updateSettings({ saveAhead: Number(e.target.value) })} />
          </label>
          {s.saveAhead > 0 && (
            <label className="check">
              <input type="checkbox" checked={s.clearReadSaved} onChange={(e) => updateSettings({ clearReadSaved: e.target.checked })} /> Remove them again once I have read them
            </label>
          )}
        </div>
        <p className="muted small">
          Saving ahead keeps the next unread chapters readable offline (see Offline library). It uses storage on this device, so it is off by default.
        </p>
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
          <span>Preferred scanlation group (for every series that has it)</span>
          <input
            value={s.defaultGroup}
            onChange={(e) => updateSettings({ defaultGroup: e.target.value.trim() === '' ? '' : e.target.value })}
            placeholder="Leave empty to show all groups. Type a name exactly as the group bar shows it, e.g. Delta"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.defaultFill} onChange={(e) => updateSettings({ defaultFill: e.target.checked })} />
          <span>With it, fill chapters it lacks from the other groups</span>
        </label>
        <div className="row gap wrap">
          <button className="btn ghost" onClick={() => (showGroups ? void groupList.refetch() : setShowGroups(true))} disabled={showGroups && groupList.isLoading}>
            {showGroups ? (groupList.isLoading ? 'Reading your library…' : 'Refresh the list') : 'Show the groups in my library'}
          </button>
          <Link className="btn ghost" to="/duplicates">
            Find duplicate series
          </Link>
        </div>
        {showGroups && groupList.data && (
          <ul className="merge-list group-list">
            {groupList.data.slice(0, 25).map((g) => (
              <li key={g.name} className="row gap">
                <span className="grow merge-name" title={g.name}>
                  {g.name}
                </span>
                <span className="muted small">
                  {g.series} series · {g.chapters} chapters
                </span>
                {g.name !== 'Unknown group' && (
                  <button className={`link-btn ${s.defaultGroup === g.name ? 'on' : ''}`} onClick={() => updateSettings({ defaultGroup: s.defaultGroup === g.name ? '' : g.name })}>
                    {s.defaultGroup === g.name ? 'Preferred ✓' : 'Prefer'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          A group chosen on a manga's own page wins over this. Series that never had the preferred group show every group, as before.
        </p>
        <label className="field">
          <span>Cover size: {s.gridWidth}px</span>
          <input type="range" min={100} max={260} step={10} value={s.gridWidth} onChange={(e) => updateSettings({ gridWidth: Number(e.target.value) })} />
        </label>
      </section>

      <section className="panel">
        <h2>AniList tracking</h2>
        <p className="muted small">
          Finish a chapter (or mark it read) and your AniList list moves forward, never back. AniList needs a small "client" of your own to sign you in:
          create one at <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">anilist.co/settings/developer</a> (Create New Client), set
          its <b>Redirect URL</b> to the address below, and paste its <b>Client ID</b> here. The sign-in token stays in this browser and is sent only to AniList.
        </p>
        <label className="field">
          <span>Redirect URL to give AniList (use the address you open Mangadeck at)</span>
          <input readOnly value={redirectUrl()} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <label className="field">
          <span>Client ID</span>
          <input value={tracker.clientId} onChange={(e) => setClientId(e.target.value)} placeholder="a number, shown on your AniList client" inputMode="numeric" />
        </label>
        <div className="row gap wrap">
          {isConnected(tracker) ? (
            <>
              <span className="small">Connected as <b>{tracker.name || 'AniList user'}</b>.</span>
              <button className="btn ghost" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn" disabled={!/^[0-9]+$/.test(tracker.clientId.trim())} onClick={() => window.location.assign(authorizeUrl(tracker.clientId))}>
              Connect AniList
            </button>
          )}
        </div>
        <p className="muted small">
          Each series is linked to the AniList entry with exactly its title (or one you pick on the series page, under "Track on AniList"). Sign-in lasts about a year.
          Each address you open Mangadeck at (for example localhost:8080 and localhost:5173) is signed in on its own, and the redirect URL above must match the one you register.
        </p>
      </section>

      <section className="panel">
        <h2>Backup</h2>
        <p className="muted small">
          Your reader options, scanlation group choices, linked sources, volume lists, download history and library view live in this
          browser. Save them to a file to move them to another computer or keep a copy before clearing browser data. Your series, reading
          progress and downloads stay on the Suwayomi server and are not part of this file. The folder you chose for a series' .cbz files
          cannot be saved and is picked again.
        </p>
        <div className="row gap wrap">
          <button className="btn" onClick={downloadBackup}>
            Download backup
          </button>
          <label className="btn ghost file-btn">
            Restore from file…
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void restoreBackup(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
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
