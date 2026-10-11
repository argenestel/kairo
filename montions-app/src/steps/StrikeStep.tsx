import { useCallback, useMemo, useRef } from 'react';
import { Wheel } from '../components/Wheel';
import { Info, Spinner } from '../components/Icons';
import { fmtCents, fmtExpiryNote, fmtPct, fmtSignedPct, fmtSignedPrice, fmtStrike, decimalsOf } from '../lib/format';
import { useQuote } from '../lib/hooks';
import { BookDisclosure } from '../components/BookPanel';
import { effective, type StepProps } from './common';

export function nearestIndex(list: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
  return best;
}

/** Point on the quadratic arc used by the curved scroll indicator. */
function arcPoint(t: number, h: number): [number, number] {
  const p0 = [34, 6];
  const p1 = [-14, h / 2];
  const p2 = [34, h - 6];
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
}

export function StrikeStep({ flow, dispatch, asset, strikes, compact }: StepProps) {
  const d = flow.draft;
  const list = strikes.data ?? [];
  // highest price at the top
  const items = useMemo(() => [...list].reverse(), [list]);
  const n = items.length;
  const di = d.strike != null && n ? nearestIndex(items, d.strike) : Math.floor(n / 2);
  const step = asset?.strikeStep ?? 1;
  const spot = asset?.price ?? 0;
  const up = d.direction === 'above';
  const { quote, stale, loading } = useQuote(
    d.symbol && d.strike != null && d.expiry != null ? { symbol: d.symbol, strike: d.strike, expiry: d.expiry, direction: d.direction, budget: d.budget } : null,
  );
  const eff = effective(quote, stale, asset, d.direction, d.strike, d.expiry, d.budget);

  const arcH = compact ? 210 : 240;
  const thumbRef = useRef<SVGGElement | null>(null);
  const onPos = useCallback((pos: number) => {
    const el = thumbRef.current;
    if (!el || n < 2) return;
    const t = Math.max(0, Math.min(1, pos / (n - 1)));
    const [x, y] = arcPoint(t, arcH);
    el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  }, [n, arcH]);

  // where "now" sits on the arc (fractional index in display order)
  let spotT: number | null = null;
  if (n > 1 && spot > 0 && spot <= items[0] && spot >= items[n - 1]) {
    for (let i = 0; i < n - 1; i++) {
      if (spot <= items[i] && spot >= items[i + 1]) {
        spotT = (i + (items[i] - spot) / (items[i] - items[i + 1] || 1)) / (n - 1);
        break;
      }
    }
  }

  if (strikes.error) {
    return (
      <div className="strike-step">
        <div className="card-error glass">
          <p>Couldn't load price levels: {strikes.error}</p>
          <button className="btn btn--ghost btn--sm" onClick={strikes.reload}>Retry</button>
        </div>
      </div>
    );
  }
  if (!n || d.strike == null) {
    return (
      <div className="strike-step">
        <div className="wheel-skeleton wheel-skeleton--strike" aria-busy="true" aria-label="Loading price levels">
          {[0, 1, 2].map((i) => <div key={i} className={`skel-row${i === 1 ? ' is-mid' : ''}`} />)}
        </div>
      </div>
    );
  }

  const pct = spot > 0 ? d.strike / spot - 1 : 0;
  const diff = d.strike - spot;
  const dp = Math.max(decimalsOf(step), spot >= 1000 ? 0 : 2);
  const spacing = compact ? 70 : 84;
  const [sx, sy] = spotT != null ? arcPoint(spotT, arcH) : [0, 0];

  return (
    <div className="strike-step">
      <div className="strike-wheel-wrap">
        <svg className="arc" width="48" height={arcH} viewBox={`-20 0 68 ${arcH}`} aria-hidden>
          <path d={`M 34 6 Q -14 ${arcH / 2} 34 ${arcH - 6}`} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          {spotT != null && (
            <g transform={`translate(${sx} ${sy})`}>
              <circle r="3" fill="var(--play)" />
              <text x="-8" y="3.5" textAnchor="end" className="arc__now">now</text>
            </g>
          )}
          <g ref={thumbRef}>
            <rect x="-11" y="-7" width="22" height="14" rx="7" fill="#f4f6fb" />
          </g>
        </svg>
        <Wheel
          items={items}
          index={di}
          onChange={(i) => dispatch({ type: 'set', patch: { strike: items[i] }, user: true })}
          itemKey={(k) => String(k)}
          itemLabel={(k) => fmtStrike(k, step)}
          spacing={spacing}
          lensHeight={compact ? 92 : 104}
          angleStep={compact ? 24 : 22}
          range={2}
          fade={0.42}
          height={compact ? 230 : 268}
          ariaLabel="Price level"
          role="slider"
          valueText={(i) => `${fmtStrike(items[i], step)}, ${fmtSignedPct(spot > 0 ? items[i] / spot - 1 : 0)} from now`}
          autoFocus
          onPos={onPos}
          className={`wheel--strikes ${up ? 'is-up' : 'is-down'}`}
          lens={
            <div className={`lens lens--strike ${up ? 'is-up' : 'is-down'}`}>
              <span className="lens__kicker">Price level <span title="The price your sentence is about. Settles on the first oracle print at expiry."><Info size={12} /></span></span>
              <span className={`lens__delta ${pct >= 0 ? 'up' : 'down'}`}>{fmtSignedPct(pct)} {pct >= 0 ? 'increase' : 'decrease'}</span>
            </div>
          }
          renderItem={(k) => <span className="strike-item num">{fmtStrike(k, step)}</span>}
        />
      </div>

      <div className="info-card glass">
        <div className="info-row">
          <span>Price per contract</span>
          <span className={`chip-val ${up ? 'chip-val--up' : 'chip-val--down'}`}>
            {loading && eff?.estimated ? <Spinner size={11} /> : null}
            {eff ? `${eff.estimated ? '~' : ''}${fmtCents(eff.price)}` : '—'}
          </span>
        </div>
        <div className="info-row"><span>Pays if right</span><span className="chip-val">$1 per contract</span></div>
        <div className="info-row"><span>Chance <small>(model)</small></span><span className="chip-val">{eff ? fmtPct(eff.chance) : '—'}</span></div>
        <div className="info-row"><span>From current price</span><span className="chip-val chip-val--plain">{fmtSignedPrice(diff, dp)}</span></div>
        <p className="info-note">
          You win if {d.symbol} is {up ? 'at or above' : 'below'} <b>{fmtStrike(d.strike, step)}</b>
          {d.expiry != null ? <> on {fmtExpiryNote(d.expiry)}</> : null}.
        </p>
        {eff && !eff.tradable && eff.reason && <p className="info-warn">{eff.reason}</p>}
        {eff?.needsMarket && eff.tradable && <p className="info-soft">First trade creates this market onchain.</p>}
      </div>
      {d.symbol && d.strike != null && d.expiry != null && (
        <BookDisclosure market={{ symbol: d.symbol, strike: d.strike, expiry: d.expiry }} />
      )}
    </div>
  );
}
