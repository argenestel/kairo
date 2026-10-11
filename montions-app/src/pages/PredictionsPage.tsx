import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { EventCategory, EventInfo } from '../chains/types';
import { ChainGlyph, Search } from '../components/Icons';
import { useCopy } from '../copy';
import { eventSource, noAsk, yesAsk } from '../lib/events';
import { fmtCents, fmtCountdown, fmtDayLong, fmtPct, fmtVolume } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useChain } from '../state/chain';
import { Link } from '../state/route';
import './predictions/predictions.css';

const CATEGORIES: Array<EventCategory | 'all'> = ['all', 'crypto', 'macro', 'politics', 'sports', 'tech', 'culture', 'other'];
type SortMode = 'trending' | 'closing' | 'new';

function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

/** The displayed chance is the midpoint when both sides of the book exist. */
function eventProbability(event: EventInfo): number | undefined {
  const midpoint = event.bestBid != null && event.bestAsk != null
    ? (event.bestBid + event.bestAsk) / 2
    : event.lastPrice ?? yesAsk(event) ?? (event.bestBid != null ? event.bestBid : undefined);
  return midpoint == null ? undefined : clampProbability(midpoint);
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function DemoBadge() {
  return <span className="predictions-page__demo"><span className="predictions-page__demo-dot" />Demo only</span>;
}

function ChainBadge({ label, chain }: { label: string; chain: ReturnType<typeof useChain>['key'] }) {
  return <span className="chain-badge"><ChainGlyph chain={chain} size={13} />{label}</span>;
}

function Probability({ event, feature = false }: { event: EventInfo; feature?: boolean }) {
  const yes = eventProbability(event);
  const no = yes == null ? undefined : 1 - yes;
  const style = yes == null ? undefined : { '--yes-share': `${yes * 100}%` } as CSSProperties;
  return (
    <div className={`probability-readout${feature ? ' probability-readout--feature' : ''}`}>
      <div className="probability-readout__line">
        <b>{yes == null ? '—' : fmtPct(yes)}</b>
        <span>YES probability</span>
      </div>
      <div className={`probability-bar${yes == null ? ' is-unknown' : ''}`} style={style} aria-label={yes == null ? 'Probability unavailable' : `YES ${fmtPct(yes)}, NO ${fmtPct(no!)}`}>
        <span className="probability-bar__yes" />
        <span className="probability-bar__no" />
      </div>
      <div className="probability-readout__ends"><b>YES {yes == null ? '—' : fmtPct(yes)}</b><b>NO {no == null ? '—' : fmtPct(no)}</b></div>
    </div>
  );
}

function FeaturedEvent({ event, chain, demo, now, copy }: {
  event: EventInfo;
  chain: ReturnType<typeof useChain>;
  demo: boolean;
  now: number;
  copy: ReturnType<typeof useCopy>;
}) {
  const yes = yesAsk(event);
  const no = noAsk(event);
  return (
    <article className="predictions-feature">
      <div className="predictions-feature__copy">
        <div>
          <div className="predictions-feature__meta">
            <span className="category-badge">Featured · {titleCase(event.category)}</span>
            <ChainBadge chain={chain.key} label={chain.entry.short} />
            {demo && <DemoBadge />}
          </div>
          <h2>{event.question}</h2>
          <p>{copy.predictions.rules} are the contract. Read the source, choose a side, and print a fully collateralised ticket.</p>
        </div>
        <div className="predictions-feature__footer">
          <span>{copy.predictions.closes} {fmtDayLong(event.closeTime, now)} · <strong>{fmtCountdown(event.closeTime, now)}</strong></span>
          <span>{fmtVolume(event.volume)} traded</span>
        </div>
      </div>
      <div className="predictions-feature__quote">
        <span className="predictions-feature__quote-label">Market probability</span>
        <Probability event={event} feature />
        <div className="predictions-feature__prices">
          <span className="price-chip price-chip--yes">{copy.predictions.yes} {yes != null ? fmtCents(yes) : '—'}</span>
          <span className="price-chip price-chip--no">{copy.predictions.no} {no != null ? fmtCents(no) : '—'}</span>
        </div>
        <Link className="predictions-feature__cta" to={`/predictions/${encodeURIComponent(event.key)}`}>
          View market <span aria-hidden>↗</span>
        </Link>
      </div>
    </article>
  );
}

function EventCard({ event, chain, demo, now, copy }: {
  event: EventInfo;
  chain: ReturnType<typeof useChain>;
  demo: boolean;
  now: number;
  copy: ReturnType<typeof useCopy>;
}) {
  const yes = yesAsk(event);
  const no = noAsk(event);
  const probability = eventProbability(event);
  const style = probability == null ? undefined : { '--yes-share': `${probability * 100}%` } as CSSProperties;
  return (
    <li>
      <article className="predictions-card">
        <div className="predictions-card__top">
          <span className="predictions-card__icon" aria-hidden>{event.icon ?? '◈'}</span>
          <span className="category-badge">{titleCase(event.category)}</span>
          <ChainBadge chain={chain.key} label={chain.entry.short} />
          {demo && <span className="status-badge">Demo</span>}
          <span className={`status-badge status-badge--${event.status}`}>{event.status}</span>
        </div>
        <h2><Link className="predictions-card__question-link" to={`/predictions/${encodeURIComponent(event.key)}`}>{event.question}</Link></h2>
        <div className="predictions-card__probability">
          <div className="predictions-card__probability-line"><span>YES probability</span><strong>{probability == null ? '—' : fmtPct(probability)}</strong></div>
          <div className={`probability-bar${probability == null ? ' is-unknown' : ''}`} style={style} aria-hidden><span className="probability-bar__yes" /><span className="probability-bar__no" /></div>
        </div>
        <div className="predictions-card__prices">
          <Link className="price-chip price-chip--yes" to={`/predictions/${encodeURIComponent(event.key)}?outcome=yes`} aria-label={`Buy YES on ${event.question}`}>{copy.predictions.yes} {yes != null ? fmtCents(yes) : '—'}</Link>
          <Link className="price-chip price-chip--no" to={`/predictions/${encodeURIComponent(event.key)}?outcome=no`} aria-label={`Buy NO on ${event.question}`}>{copy.predictions.no} {no != null ? fmtCents(no) : '—'}</Link>
        </div>
        <div className="predictions-card__bottom">
          <span><strong>{fmtVolume(event.volume)}</strong> volume</span>
          <span>{copy.predictions.closes} <strong>{fmtCountdown(event.closeTime, now)}</strong></span>
        </div>
      </article>
    </li>
  );
}

export default function PredictionsPage() {
  const copy = useCopy();
  const chain = useChain();
  const now = useNow(1000);
  const source = eventSource(chain.adapter);
  const sourceAdapter = source.adapter;
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [sort, setSort] = useState<SortMode>('trending');

  useEffect(() => {
    let live = true;
    setEvents(null);
    setError(null);
    const load = sourceAdapter.listEvents?.() ?? Promise.resolve([]);
    load.then(
      (list) => { if (live) setEvents(list); },
      (reason) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { live = false; };
  }, [sourceAdapter, chain.epoch]);

  const demo = source.demo || Boolean(chain.demo) || sourceAdapter.meta.id === 'mock';

  const featured = useMemo(() => {
    if (!events?.length) return null;
    const candidates = events.filter((event) => event.status === 'open' && event.closeTime > now);
    return [...(candidates.length ? candidates : events)].sort((a, b) => b.volume - a.volume || a.closeTime - b.closeTime)[0] ?? null;
  }, [events, now]);

  const filtered = useMemo(() => {
    if (!events) return [];
    const needle = query.trim().toLowerCase();
    const sourceIndex = new Map(events.map((event, index) => [event.id, index]));
    const list = events.filter((event) => {
      if (category !== 'all' && event.category !== category) return false;
      if (!needle) return true;
      return `${event.question} ${event.key} ${event.category}`.toLowerCase().includes(needle);
    });
    return list.sort((a, b) => {
      if (sort === 'closing') return a.closeTime - b.closeTime;
      if (sort === 'new') return (sourceIndex.get(b.id) ?? 0) - (sourceIndex.get(a.id) ?? 0);
      return b.volume - a.volume || a.closeTime - b.closeTime;
    });
  }, [events, query, category, sort]);

  return (
    <div className="page predictions-page">
      <header className="predictions-page__header">
        <span className="predictions-page__eyebrow">Outcome markets</span>
        <h1>{copy.predictions.title}</h1>
        <p>{copy.predictions.sub} Every contract settles to $1 or $0, with the order book in view.</p>
      </header>

      {demo && (
        <div className="predictions-page__status glass" role="status">
          <div className="predictions-page__status-copy">
            <b>{copy.predictions.coming}</b>
            <span>{chain.demo?.reason ?? 'Demo questions are clearly marked — nothing is sent onchain.'}</span>
          </div>
          <DemoBadge />
        </div>
      )}

      {featured && <FeaturedEvent event={featured} chain={chain} demo={demo} now={now} copy={copy} />}

      <section className="predictions-toolbar" aria-label="Filter predictions">
        <label className="predictions-search">
          <Search size={16} />
          <span className="sr-only">{copy.predictions.search}</span>
          <input type="search" value={query} placeholder={copy.predictions.search} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="predictions-filters" role="tablist" aria-label="Categories">
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              className="predictions-filter"
              role="tab"
              aria-selected={category === value}
              onClick={() => setCategory(value)}
            >
              {value === 'all' ? copy.predictions.all : titleCase(value)}
            </button>
          ))}
        </div>
      </section>

      <div className="predictions-toolbar__bottom">
        <span className="predictions-results">{events ? `${filtered.length} question${filtered.length === 1 ? '' : 's'}` : 'Loading questions…'}</span>
        <div className="predictions-sort" role="tablist" aria-label="Sort predictions">
          <span className="predictions-sort__label">Sort</span>
          {(['trending', 'closing', 'new'] as SortMode[]).map((value) => (
            <button key={value} type="button" title={value === 'new' ? 'Uses adapter order because event creation time is not part of the adapter contract' : undefined} className={`predictions-sort__option${sort === value ? ' is-on' : ''}`} aria-selected={sort === value} onClick={() => setSort(value)}>
              {value === 'closing' ? 'Closing soon' : titleCase(value)}
            </button>
          ))}
          {sort === 'new' && <span className="predictions-sort__note">adapter order</span>}
        </div>
      </div>

      {error && <div className="predictions-error"><b>Questions unavailable</b><span>{error}</span></div>}
      {!events && !error && (
        <div className="predictions-skeleton" aria-busy="true" aria-label="Loading predictions">
          {[0, 1, 2, 3].map((index) => <div className="predictions-skeleton__card skel-card" key={index} />)}
        </div>
      )}
      {events && events.length === 0 && <div className="predictions-empty"><b>No prediction markets on {chain.entry.label} yet</b><span>Markets will appear here when this venue lists its first event.</span></div>}
      {events && events.length > 0 && filtered.length === 0 && <div className="predictions-empty"><b>{copy.predictions.empty}</b><span>Try another category or search term.</span></div>}
      {events && filtered.length > 0 && (
        <ul className="predictions-grid">
          {filtered.map((event) => <EventCard key={event.id} event={event} chain={chain} demo={demo} now={now} copy={copy} />)}
        </ul>
      )}
    </div>
  );
}
