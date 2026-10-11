import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Direction } from '../chains/types';
import { fmtMoney, fmtMultiple, fmtPrice, fmtSignedMoney, fmtStrike } from '../lib/format';
import { haptic, useReducedMotion } from '../lib/hooks';
import { clamp, niceTicks } from '../charts/geom';
import { useSize } from '../charts/useSize';
import { Info } from './Icons';
import '../charts/charts.css';

/** Binary payoff in miniature: flat loss, a jump at the strike, flat fixed payout. */
export function PayoffMini({ direction, active }: { direction: Direction; active: boolean }) {
  const gid = useId().replace(/:/g, '');
  const up = direction === 'above';
  const color = up ? 'var(--up)' : 'var(--down)';
  const W = 260;
  const H = 104;
  const lossY = 76;
  const winY = 16;
  const k = W * 0.55;
  const path = up
    ? `M 0 ${lossY} H ${k} V ${winY} H ${W}`
    : `M 0 ${winY} H ${W - k} V ${lossY} H ${W}`;
  const area = up
    ? `M ${k} ${H} V ${winY} H ${W} V ${H} Z`
    : `M 0 ${H} V ${winY} H ${W - k} V ${H} Z`;
  const kx = up ? k : W - k;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`payoff-mini${active ? ' is-active' : ''}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`pm-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.55" />
          <stop offset="1" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={lossY} y2={lossY} stroke="var(--line)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <path d={area} fill={`url(#pm-${gid})`} className="payoff-mini__area" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="payoff-mini__line" pathLength={1} />
      <circle cx={kx} cy={lossY} r="5.5" fill="var(--bg)" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" className="payoff-mini__dot" />
    </svg>
  );
}

interface SimProps {
  symbol: string;
  direction: Direction;
  spot: number;
  strike: number;
  strikeStep: number;
  cost: number;
  payout: number;
  sigma: number;          // 1-sigma move fraction to expiry
  expiryLabel: string;
  value?: number | null;  // simulated final price
  onValue?: (v: number) => void;
  compact?: boolean;
}

function useSmooth(n: number, ms = 180): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(n);
  const cur = useRef(n);
  useEffect(() => {
    if (reduced) { cur.current = n; setV(n); return; }
    const from = cur.current;
    if (Math.abs(from - n) < 1e-9) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - p) ** 3;
      const next = from + (n - from) * e;
      cur.current = next;
      setV(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, reduced, ms]);
  return v;
}

export function PayoutSimulator(p: SimProps) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const [internal, setInternal] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const snapped = useRef(false);
  const uid = useId().replace(/:/g, '');
  const W = Math.max(240, size.w);
  const H = p.compact ? 124 : 168;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const up = p.direction === 'above';
  const setValue = p.onValue ?? setInternal;

  const { lo, hi } = useMemo(() => {
    const m = Math.min(0.6, Math.max(0.045, p.sigma * 2.2));
    let lo = p.strike * (1 - m);
    let hi = p.strike * (1 + m);
    lo = Math.min(lo, p.spot * 0.97);
    hi = Math.max(hi, p.spot * 1.03);
    return { lo: Math.max(0, lo), hi };
  }, [p.strike, p.spot, p.sigma]);

  const cost = useSmooth(p.cost);
  const payout = useSmooth(p.payout);
  const strike = useSmooth(p.strike);

  const xOf = (v: number) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
  const vOf = (x: number) => lo + ((x - padL) / (W - padL - padR)) * (hi - lo);

  const fallback = p.strike * (up ? 1.04 : 0.96);
  const raw = p.value ?? internal ?? fallback;
  const committed = clamp(raw, lo, hi);

  const iW = W - padL - padR;
  const snapPx = Math.max(10, iW * 0.028);
  const snap = (v: number, x?: number) => {
    const dx = Math.abs((x ?? xOf(v)) - xOf(p.strike));
    if (dx <= snapPx) return p.strike;
    return v;
  };

  const previewX = hoverX;
  const previewV = previewX != null ? snap(clamp(vOf(previewX), lo, hi), previewX) : committed;
  const shown = dragging || hoverX != null ? previewV : committed;
  const isSnap = Math.abs(shown - p.strike) < (hi - lo) * 1e-6;

  const wins = up ? shown >= p.strike : shown < p.strike;
  const profit = payout - cost;
  const pnlWin = profit;
  const pnlLoss = -cost;
  const span = Math.max(1e-6, pnlWin - pnlLoss);
  const top = padT;
  const bottom = H - padB;
  const yOfPnl = (pnl: number) => top + ((pnlWin - pnl) / span) * (bottom - top);
  const zeroY = yOfPnl(0);
  const winY = yOfPnl(pnlWin);
  const lossY = yOfPnl(pnlLoss);
  const kx = xOf(strike);
  const sx = xOf(clamp(p.spot, lo, hi));
  const fx = xOf(shown);
  const fy = wins ? winY : lossY;
  const ret = wins ? payout : 0;
  const pnl = wins ? pnlWin : pnlLoss;

  const lossPath = up ? `M ${padL} ${lossY} H ${kx}` : `M ${kx} ${lossY} H ${W - padR}`;
  const winPath = up ? `M ${kx} ${winY} H ${W - padR}` : `M ${padL} ${winY} H ${kx}`;
  const winArea = up
    ? `M ${kx} ${zeroY} V ${winY} H ${W - padR} V ${zeroY} Z`
    : `M ${padL} ${zeroY} V ${winY} H ${kx} V ${zeroY} Z`;
  const lossArea = up
    ? `M ${padL} ${zeroY} V ${lossY} H ${kx} V ${zeroY} Z`
    : `M ${kx} ${zeroY} V ${lossY} H ${W - padR} V ${zeroY} Z`;

  const commitFromClient = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const v = snap(clamp(vOf(x), lo, hi), x);
    if (Math.abs(v - p.strike) < 1e-9) {
      if (!snapped.current) { snapped.current = true; haptic(6); }
    } else snapped.current = false;
    setValue(v);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    commitFromClient(e.clientX, e.currentTarget);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHoverX(x);
    if (dragging) commitFromClient(e.clientX, e.currentTarget);
  };
  const onUp = () => setDragging(false);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (hi - lo) / 100;
    if (e.key === 'Home') { e.preventDefault(); setValue(lo); }
    if (e.key === 'End') { e.preventDefault(); setValue(hi); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setValue(Math.max(lo, committed - step)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setValue(Math.min(hi, committed + step)); }
    if (e.key === 'PageDown') { e.preventDefault(); setValue(Math.max(lo, committed - step * 10)); }
    if (e.key === 'PageUp') { e.preventDefault(); setValue(Math.min(hi, committed + step * 10)); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); setValue(p.strike); }
  };

  const xTicks = useMemo(() => {
    const ticks = niceTicks(lo, hi, 4);
    const extra = [p.spot, p.strike];
    const all = [...ticks];
    for (const v of extra) {
      if (v >= lo && v <= hi && all.every((t) => Math.abs(xOf(t) - xOf(v)) > 36)) all.push(v);
    }
    return all.sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi, p.spot, p.strike, W]);

  const closeLabels = Math.abs(sx - kx) < 46;
  const tip = `${p.symbol} at ${fmtPrice(shown)} → you get ${fmtMoney(ret, ret % 1 ? 2 : 0)} (${fmtSignedMoney(pnl, Math.abs(pnl) % 1 ? 2 : 0)})`;
  const showTip = dragging || hoverX != null;

  return (
    <div className={`sim glass${p.compact ? ' sim--compact' : ''}${isSnap ? ' is-snap' : ''}`}>
      <div className="sim__head">
        <span className="sim__title">Payout simulator <span title="Drag the marker to see what this ticket returns at any final price. Binary: you get the full payout or nothing."><Info size={13} /></span></span>
        <span className="sim__at">{p.symbol} at <b className="num">{fmtPrice(shown)}</b> on {p.expiryLabel}</span>
      </div>
      <div
        ref={wrapRef}
        className="sim__chart"
        tabIndex={0}
        role="slider"
        aria-label={`Simulated ${p.symbol} price at expiry`}
        aria-valuemin={Math.round(lo * 1e8) / 1e8}
        aria-valuemax={Math.round(hi * 1e8) / 1e8}
        aria-valuenow={Math.round(committed * 1e8) / 1e8}
        aria-valuetext={`${fmtPrice(committed)}: return ${fmtMoney(up ? (committed >= p.strike ? payout : 0) : (committed < p.strike ? payout : 0))}`}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { if (!dragging) setHoverX(null); }}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <svg className="sim__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <defs>
            <linearGradient id={`sw-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--up)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--up)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`sl-${uid}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="var(--down)" stopOpacity="0.3" />
              <stop offset="1" stopColor="var(--down)" stopOpacity="0.03" />
            </linearGradient>
            <clipPath id={`sc-${uid}`}>
              <rect x={padL} y={padT - 2} width={Math.max(1, W - padL - padR)} height={Math.max(1, H - padT - padB + 4)} />
            </clipPath>
          </defs>
          <g clipPath={`url(#sc-${uid})`}>
            <path d={winArea} fill={`url(#sw-${uid})`} />
            <path d={lossArea} fill={`url(#sl-${uid})`} />
          </g>
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} className="sim__zero" />
          <text x={4} y={winY + 3} className="sim__axis sim__axis--pnl">{fmtSignedMoney(pnlWin, 0)}</text>
          <text x={4} y={lossY + 3} className="sim__axis sim__axis--pnl">{fmtSignedMoney(pnlLoss, 0)}</text>
          <line x1={sx} x2={sx} y1={padT} y2={H - padB} className="sim__guide" />
          <line x1={kx} x2={kx} y1={winY} y2={lossY} className="sim__step" />
          <path d={lossPath} stroke="var(--down)" strokeWidth="2.6" fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={winPath} stroke="var(--up)" strokeWidth="2.6" fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {xTicks.map((t) => {
            const x = xOf(t);
            const isK = Math.abs(t - p.strike) < 1e-6 * Math.max(1, p.strike);
            const isS = Math.abs(t - p.spot) < 1e-6 * Math.max(1, p.spot);
            const label = isK ? `K ${fmtStrike(p.strike, p.strikeStep)}` : isS ? 'spot' : fmtPrice(t);
            const dx = isK && closeLabels ? (kx < sx ? -18 : 18) : isS && closeLabels ? (sx < kx ? -16 : 16) : 0;
            return (
              <text
                key={t}
                x={x + dx}
                y={H - 6}
                className={`sim__axis${isK ? ' sim__axis--strong' : ''}`}
                textAnchor="middle"
              >
                {isS && !isK ? 'spot' : label}
              </text>
            );
          })}
          <line x1={fx} x2={fx} y1={padT - 4} y2={H - padB} stroke="var(--text)" strokeOpacity="0.35" />
          <circle cx={fx} cy={fy} r={dragging ? 8 : 7} fill="var(--bg)" stroke={wins ? 'var(--up)' : 'var(--down)'} strokeWidth="2.6" className="sim__knob" />
        </svg>
        {showTip && (
          <div className="sim__tip" style={{ left: clamp((fx / W) * 100, 18, 82) + '%' }}>
            {tip}
          </div>
        )}
      </div>
      <div className="sim__foot">
        <div>
          <div className="sim__label">Your return would be</div>
          <div className={`sim__pl ${wins ? 'up' : 'down'}`}>{wins ? `${fmtSignedMoney(profit, profit % 1 ? 2 : 0)} profit` : `${fmtSignedMoney(-p.cost, p.cost % 1 ? 2 : 0)} loss`}</div>
        </div>
        <div className={`sim__badge${wins ? ' is-win' : ''}`}>
          <span className="num">{fmtMoney(ret, ret % 1 ? 2 : 0)}</span>
          {wins && <span className="sim__mult">{fmtMultiple(p.payout / Math.max(p.cost, 1e-9))}</span>}
        </div>
      </div>
    </div>
  );
}
