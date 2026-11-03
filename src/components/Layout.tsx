import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Q } from '../api/queries';

const NAV = [
  { to: '/', label: 'Library', icon: 'M4 5h4v14H4zM10 5h4v14h-4zM16.5 6l3.7 1-3 12-3.7-1z' },
  { to: '/updates', label: 'Updates', icon: 'M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-2-4.5L13 11h7V4l-2.6 2.6A8 8 0 0 0 12 4z' },
  { to: '/downloads', label: 'Downloads', icon: 'M11 4h2v8.2l3.1-3.1 1.4 1.4L12 16l-5.5-5.5 1.4-1.4 3.1 3.1zM5 18h14v2H5z' },
  { to: '/browse', label: 'Browse', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.9 5.1-1.7 5.1-5.1 1.7 1.7-5.1z' },
  { to: '/settings', label: 'Settings', icon: 'M19.4 13a7.7 7.7 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 3a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 3h4l.4-3c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z' },
];

export default function Layout() {
  const { data: dl } = useQuery({
    queryKey: ['downloads'],
    queryFn: Q.downloads,
    refetchInterval: 5000,
    retry: false,
  });
  const queued = dl?.queue.length ?? 0;

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Mangadeck" width="48" height="48" />
          <span className="brand-name">Mangadeck</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d={n.icon} fill="currentColor" />
            </svg>
            <span>{n.label}</span>
            {n.to === '/downloads' && queued > 0 && <span className="nav-badge">{queued}</span>}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
