import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import SourceResults from '../components/SourceResults';

/** A title looked up in every English source at once (where recommendations and "What's popular" lead). */
export default function FindPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);

  return (
    <div className="page">
      <PageHeader title={q ? `Find “${q}”` : 'Find a title'}>
        <input
          className="input search"
          placeholder="Search all your sources…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setParams({ q: text.trim() }, { replace: true })}
        />
        <Link className="btn ghost" to="/browse">
          Browse sources
        </Link>
      </PageHeader>
      {q.trim().length >= 2 ? <SourceResults query={q} /> : <p className="muted">Type a title and press Enter.</p>}
    </div>
  );
}
