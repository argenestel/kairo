import { useMemo, useRef, useState } from 'react';
import { Ruler } from '../components/Ruler';
import { Calendar, Spinner } from '../components/Icons';
import { fmtCents, fmtClock, fmtDayLong, fmtIn, fmtPct, utcDayStart } from '../lib/format';
import { useQuote } from '../lib/hooks';
import { buildTimeline } from '../lib/timeline';
import { BookDisclosure } from '../components/BookPanel';
import { effective, type StepProps } from './common';

export function ExpiryStep({ flow, dispatch, asset, expiries, compact }: StepProps) {
  const d = flow.draft;
  const [todayZoom, setTodayZoom] = useState(false);
  const all = expiries.data ?? [];
  const today = all.filter((e) => utcDayStart(e.expiry) === utcDayStart(Date.now() / 1000));
  const list = todayZoom && today.length ? today : all;
  const model = useMemo(() => buildTimeline(list, Date.now() / 1000, compact), [list, compact]);
  const idx = d.expiry != null && list.length ? nearestExpiry(list.map((e) => e.expiry), d.expiry) : 0;
  const sel = list[idx];
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { quote, stale, loading } = useQuote(
    d.symbol && d.strike != null && d.expiry != null ? { symbol: d.symbol, strike: d.strike, expiry: d.expiry, direction: d.direction, budget: d.budget } : null,
  );
  const eff = effective(quote, stale, asset, d.direction, d.strike, d.expiry, d.budget);

  if (expiries.error) {
    return (
      <div className="expiry-step">
        <div className="card-error glass">
          <p>Couldn't load expiries: {expiries.error}</p>
          <button className="btn btn--ghost btn--sm" onClick={expiries.reload}>Retry</button>
        </div>
      </div>
    );
  }
  if (!list.length || !sel) {
    return (
      <div className="expiry-step">
        <div className="big-date skel-text" aria-busy="true">Loading dates…</div>
        {expiries.data && !expiries.loading && <p className="hint">No expiries are open for {d.symbol} right now.</p>}
      </div>
    );
  }

  const inn = fmtIn(sel.expiry);
  const pick = (dateStr: string) => {
    if (!dateStr) return;
    const day = Date.parse(`${dateStr}T00:00:00Z`) / 1000;
    if (!isFinite(day)) return;
    const sameDay = list.filter((e) => utcDayStart(e.expiry) === day);
    const target = sameDay.length ? sameDay[sameDay.length - 1].expiry : day + 16 * 3600;
    const i = nearestExpiry(list.map((e) => e.expiry), target);
    dispatch({ type: 'set', patch: { expiry: list[i].expiry }, user: true });
    setTyping(false);
  };
  const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  return (
    <div className="expiry-step">
      {typing ? (
        <div className="big-date-input">
          <label className="sr-only" htmlFor="expiry-date">Expiry date (UTC)</label>
          <input
            id="expiry-date"
            ref={inputRef}
            type="date"
            autoFocus
            defaultValue={isoDay(sel.expiry)}
            min={isoDay(list[0].expiry)}
            max={isoDay(list[list.length - 1].expiry)}
            onChange={(e) => pick(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTyping(false); } if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick((e.target as HTMLInputElement).value); } }}
            onBlur={() => setTyping(false)}
          />
        </div>
      ) : (
        <button className="big-date" onClick={() => setTyping(true)} aria-label={`Expiry ${fmtDayLong(sel.expiry)}. Click to type a date.`}>
          {fmtDayLong(sel.expiry)}
          <Calendar size={18} className="big-date__icon" />
        </button>
      )}
      <p className="big-sub">
        in <b>{inn.n}</b> {inn.unit}
        <span className="sep">·</span>
        {eff ? <><b>{eff.estimated ? '~' : ''}{fmtCents(eff.price)}</b> per contract</> : '—'}
        <span className="sep">·</span>
        {eff ? <><b>{fmtPct(eff.chance)}</b> chance</> : '—'}
        {loading && <Spinner size={11} />}
      </p>

      <div className="timeline-zoom" role="group" aria-label="Timeline zoom">
        <button aria-pressed={todayZoom} disabled={!today.length} onClick={() => { setTodayZoom(true); dispatch({ type: 'set', patch: { expiry: today[0].expiry }, user: true }); }}>Today</button>
        <button aria-pressed={!todayZoom} onClick={() => setTodayZoom(false)}>All dates</button>
      </div>
      <Ruler
        length={model.length}
        ticks={model.ticks}
        stops={model.stops}
        markers={model.markers}
        index={idx}
        onChange={(i) => dispatch({ type: 'set', patch: { expiry: list[i].expiry }, user: true })}
        height={compact ? 128 : 150}
        curve={compact ? 18 : 34}
        ariaLabel="Expiry date"
        valueText={(i) => `${fmtDayLong(list[i].expiry)}, ${fmtIn(list[i].expiry).text}`}
        autoFocus
        pageStep={7}
        className="ruler--timeline"
        playheadLabel={
          <span className={`ph-badge${sel.hasMarkets ? ' is-live' : ''}`}>
            <span className="ph-badge__glyph" aria-hidden />
            {sel.tag ? `${sel.tag} expiry` : `${fmtClock(sel.expiry)} UTC`}
            <small>{sel.hasMarkets ? 'market live' : 'new market'}</small>
          </span>
        }
      />
      <p className="hint">Drag or scroll the timeline · click the date to type one</p>
      {eff && !eff.tradable && eff.reason && <p className="info-warn center">{eff.reason}</p>}
      {d.symbol && d.strike != null && d.expiry != null && (
        <BookDisclosure market={{ symbol: d.symbol, strike: d.strike, expiry: d.expiry }} />
      )}
    </div>
  );
}

export function nearestExpiry(xs: number[], t: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - t) < Math.abs(xs[best] - t)) best = i;
  return best;
}
