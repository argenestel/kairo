import { useEffect, useMemo, useState } from 'react';
import type { EventCategory, EventInfo } from '../chains/types';
import { useChain } from '../state/chain';
import { Link } from '../state/route';
import { useCopy } from '../copy';
import { eventSource, noAsk, yesAsk } from '../lib/events';
import { fmtCents, fmtCountdown } from '../lib/format';
import { useNow } from '../lib/hooks';
import { Search } from '../components/Icons';

const CATS: EventCategory[] = ['crypto', 'macro', 'politics', 'sports', 'tech', 'culture', 'other'];

export default function PredictionsPage() {
  const copy = useCopy();
  const chain = useChain();
  const now = useNow(1000);
  const src = eventSource(chain.adapter);
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<EventCategory | 'all'>('all');

  useEffect(() => {
    let live = true;
    setEvents(null);
    src.adapter.listEvents!().then(
      (xs) => { if (live) { setEvents(xs); setError(null); } },
      (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [src.adapter, chain.epoch]);

  const filtered = useMemo(() => {
    if (!events) return [];
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (cat !== 'all' && e.category !== cat) return false;
      if (!needle) return true;
      return `${e.question} ${e.key} ${e.category}`.toLowerCase().includes(needle);
    });
  }, [events, q, cat]);

  return (
    <div className="page page--preds">
      <header className="page__intro">
        <h1 className="title">{copy.predictions.title}</h1>
        <p className="subtitle">{copy.predictions.sub}</p>
      </header>
      {src.demo && (
        <div className="coming-banner glass" role="status">
          <div>
            <b>{copy.predictions.coming}</b>
            <p>Showing mock questions, clearly marked demo — nothing is sent onchain.</p>
          </div>
          <span className="demo-pill">{copy.predictions.demo}</span>
        </div>
      )}
      <div className="pred-toolbar">
        <label className="pred-search">
          <Search size={16} />
          <span className="sr-only">{copy.predictions.search}</span>
          <input
            type="search"
            placeholder={copy.predictions.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="page__filters" role="tablist" aria-label="Category">
          <button type="button" role="tab" aria-selected={cat === 'all'} className={`chip${cat === 'all' ? ' is-on' : ''}`} onClick={() => setCat('all')}>{copy.predictions.all}</button>
          {CATS.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cat === c} className={`chip${cat === c ? ' is-on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>
      {error && (
        <div className="card-error glass">
          <p>{error}</p>
        </div>
      )}
      {!events && !error && (
        <div className="page__skel" aria-busy="true" aria-label="Loading predictions">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel-card skel-text" />)}
        </div>
      )}
      {events && filtered.length === 0 && <p className="empty">{copy.predictions.empty}</p>}
      <ul className="pred-list">
        {filtered.map((e) => {
          const y = yesAsk(e);
          const n = noAsk(e);
          return (
            <li key={e.id}>
              <Link to={`/predictions/${encodeURIComponent(e.key)}`} className="pred-card glass">
                <div className="pred-card__top">
                  <span className="pred-card__icon" aria-hidden>{e.icon ?? '◈'}</span>
                  <span className="chip chip--cat">{e.category}</span>
                  {src.demo && <span className="demo-pill">{copy.predictions.demo}</span>}
                  <span className={`status status--${e.status === 'open' ? 'live' : 'muted'}`}>{e.status}</span>
                </div>
                <h2 className="pred-card__q">{e.question}</h2>
                <div className="pred-card__foot">
                  <span className="pred-odds">
                    <span className="up">{copy.predictions.yes} {y != null ? fmtCents(y) : '—'}</span>
                    <span className="down">{copy.predictions.no} {n != null ? fmtCents(n) : '—'}</span>
                  </span>
                  <span className="pred-close">{copy.predictions.closes} {fmtCountdown(e.closeTime, now)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
