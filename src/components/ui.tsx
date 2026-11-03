import { useEffect, useState, type ReactNode } from 'react';

/* ---------- Toasts ---------- */

type ToastItem = { id: number; text: string; kind: 'info' | 'error' };
let toasts: ToastItem[] = [];
let nextId = 1;
const subs = new Set<() => void>();

export function toast(text: string, kind: 'info' | 'error' = 'info') {
  const item = { id: nextId++, text, kind };
  toasts = [...toasts, item];
  subs.forEach((s) => s());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    subs.forEach((s) => s());
  }, 3800);
}

export function errorToast(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), 'error');
}

export function ToastHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((n) => n + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- Small shared pieces ---------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-note">
      <div className="spinner" />
      {label && <div className="muted">{label}</div>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="center-note">
      <div className="error-title">Couldn't reach the server</div>
      <div className="muted small">{msg}</div>
      <div className="row gap">
        {retry && (
          <button className="btn" onClick={retry}>
            Retry
          </button>
        )}
        <a className="btn ghost" href="/settings">
          Connection settings
        </a>
      </div>
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="center-note">
      <div className="empty-title">{title}</div>
      {hint && <div className="muted">{hint}</div>}
      {children}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <div className="row gap wrap">{children}</div>
    </header>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          className={`tab ${value === i.value ? 'active' : ''}`}
          onClick={() => onChange(i.value)}
        >
          {i.label}
          {i.count !== undefined && <span className="tab-count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}
