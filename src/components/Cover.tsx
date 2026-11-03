import { Link } from 'react-router-dom';
import { useImage } from '../lib/useImage';

export function Cover({ path, alt, className = '' }: { path: string | null | undefined; alt: string; className?: string }) {
  const { src, failed } = useImage(path);
  return (
    <div className={`cover ${className}`}>
      {src && !failed ? <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} /> : <div className="cover-fallback" />}
    </div>
  );
}

export function MangaCard({
  id,
  title,
  thumbnailUrl,
  unread,
  downloaded,
  inLibrary,
  subtitle,
  selected,
  fresh,
  onClick,
}: {
  id: number;
  title: string;
  thumbnailUrl: string | null;
  unread?: number;
  downloaded?: number;
  inLibrary?: boolean;
  subtitle?: string;
  selected?: boolean;
  /** Chapters gained in the last update check: highlights the card. */
  fresh?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link
      to={`/manga/${id}`}
      className={`card ${selected ? 'selected' : ''} ${fresh ? 'fresh' : ''}`}
      onClick={onClick}
      title={fresh ? `${title} · ${fresh} new chapter${fresh === 1 ? '' : 's'}` : title}
    >
      <div className="card-art">
        <Cover path={thumbnailUrl} alt={title} />
        <div className="badges">
          {!!fresh && <span className="badge fresh">+{fresh} new</span>}
          {!!unread && unread > 0 && <span className="badge unread">{unread}</span>}
          {!!downloaded && downloaded > 0 && <span className="badge dl">{downloaded}</span>}
          {inLibrary && <span className="badge lib">In library</span>}
        </div>
        <div className="card-gradient" />
        <div className="card-title">{title}</div>
      </div>
      {subtitle && <div className="card-sub">{subtitle}</div>}
    </Link>
  );
}
