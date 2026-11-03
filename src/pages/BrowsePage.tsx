import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type Extension } from '../api/queries';
import { Empty, ErrorBox, PageHeader, Spinner, Tabs, errorToast, toast } from '../components/ui';
import { resolveUrl } from '../api/client';
import { useImage } from '../lib/useImage';

type Tab = 'sources' | 'extensions';

function Icon({ path, alt }: { path: string; alt: string }) {
  const { src } = useImage(path);
  return src ? <img className="icon" src={src} alt={alt} loading="lazy" /> : <div className="icon placeholder" />;
}

export default function BrowsePage() {
  const [tab, setTab] = useState<Tab>('sources');
  const [lang, setLang] = useState('all');
  const [search, setSearch] = useState('');

  return (
    <div className="page narrow">
      <PageHeader title="Browse">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'sources', label: 'Sources' },
            { value: 'extensions', label: 'Extensions' },
          ]}
        />
        <input className="input search" type="search" placeholder="Filter" value={search} onChange={(e) => setSearch(e.target.value)} />
      </PageHeader>
      {tab === 'sources' ? (
        <SourcesList lang={lang} setLang={setLang} search={search} />
      ) : (
        <ExtensionsList lang={lang} setLang={setLang} search={search} />
      )}
    </div>
  );
}

function LangSelect({ langs, value, onChange }: { langs: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Language">
      <option value="all">All languages</option>
      {langs.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

function SourcesList({ lang, setLang, search }: { lang: string; setLang: (v: string) => void; search: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['sources'], queryFn: Q.sources });
  const langs = useMemo(() => [...new Set((data ?? []).map((s) => s.lang))].sort(), [data]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? [])
      .filter((s) => (lang === 'all' || s.lang === lang) && (!q || s.displayName.toLowerCase().includes(q)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [data, lang, search]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;

  return (
    <>
      <div className="row gap">
        <LangSelect langs={langs} value={lang} onChange={setLang} />
      </div>
      {list.length === 0 ? (
        <Empty title="No sources" hint="Install an extension from the Extensions tab to get sources." />
      ) : (
        <ul className="list">
          {list.map((s) => (
            <li key={s.id} className="list-row">
              <Icon path={s.iconUrl} alt="" />
              <Link className="row-main" to={`/browse/${s.id}`}>
                <div className="row-title">{s.name}</div>
                <div className="muted small">{s.lang.toUpperCase()}</div>
              </Link>
              <Link className="btn ghost" to={`/browse/${s.id}`}>
                Browse
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ExtensionsList({ lang, setLang, search }: { lang: string; setLang: (v: string) => void; search: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['extensions'], queryFn: Q.extensions });

  const refreshRepo = useMutation({
    mutationFn: M.fetchExtensions,
    onSuccess: (exts) => {
      qc.setQueryData(['extensions'], exts);
      toast('Extension list refreshed');
    },
    onError: errorToast,
  });

  const act = useMutation({
    mutationFn: ({ pkg, patch }: { pkg: string; patch: { install?: boolean; update?: boolean; uninstall?: boolean } }) =>
      M.updateExtension(pkg, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['extensions'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: errorToast,
  });

  const langs = useMemo(() => [...new Set((data ?? []).map((e) => e.lang))].sort(), [data]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = (data ?? []).filter(
      (e) => (lang === 'all' || e.lang === lang) && (!q || e.name.toLowerCase().includes(q)) && !e.isObsolete,
    );
    const by = (f: (e: Extension) => boolean) => items.filter(f).sort((a, b) => a.name.localeCompare(b.name));
    return [
      { title: 'Updates available', items: by((e) => e.isInstalled && e.hasUpdate) },
      { title: 'Installed', items: by((e) => e.isInstalled && !e.hasUpdate) },
      { title: 'Available', items: by((e) => !e.isInstalled) },
    ].filter((g) => g.items.length);
  }, [data, lang, search]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;

  const busyPkg = act.isPending ? act.variables?.pkg : null;

  return (
    <>
      <div className="row gap">
        <LangSelect langs={langs} value={lang} onChange={setLang} />
        <button className="btn" onClick={() => refreshRepo.mutate()} disabled={refreshRepo.isPending}>
          {refreshRepo.isPending ? 'Refreshing…' : 'Refresh from repository'}
        </button>
      </div>
      {groups.length === 0 && (
        <Empty title="No extensions found" hint="Add an extension repository in your Suwayomi server settings, then refresh." />
      )}
      {groups.map((g) => (
        <section key={g.title} className="day">
          <h3 className="day-title">
            {g.title} <span className="muted">({g.items.length})</span>
          </h3>
          <ul className="list">
            {g.items.map((e) => (
              <li key={e.pkgName} className="list-row">
                <Icon path={e.iconUrl || resolveUrl('')} alt="" />
                <div className="row-main">
                  <div className="row-title">{e.name.replace(/^Tachiyomi: /, '')}</div>
                  <div className="muted small">
                    {e.lang.toUpperCase()} · v{e.versionName}
                  </div>
                </div>
                {busyPkg === e.pkgName ? (
                  <span className="muted small">Working…</span>
                ) : e.isInstalled ? (
                  <div className="row gap">
                    {e.hasUpdate && (
                      <button className="btn" onClick={() => act.mutate({ pkg: e.pkgName, patch: { update: true } })}>
                        Update
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => act.mutate({ pkg: e.pkgName, patch: { uninstall: true } })}>
                      Uninstall
                    </button>
                  </div>
                ) : (
                  <button className="btn primary" onClick={() => act.mutate({ pkg: e.pkgName, patch: { install: true } })}>
                    Install
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
