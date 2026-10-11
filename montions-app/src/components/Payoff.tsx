import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Direction } from '../chains/types';
import { fmtMoney, fmtMultiple, fmtPrice, fmtSignedMoney, fmtStrike } from '../lib/format';
import { useElementWidth } from '../lib/hooks';
import { Info } from './Icons';

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
      <line x1="0" x2={W} y1={lossY} y2={lossY} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
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
  value: number | null;   // simulated final price
  onValue: (v: number) => void;
}

export function PayoutSimulator(p: SimProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const uid = useId().replace(/:/g, '');
  const W = Math.max(240, width);
  const H = 116;
  const padX = 10;
  const up = p.direction === 'above';

  const { lo, hi } = useMemo(() => {
    const m = Math.min(0.6, Math.max(0.045, p.sigma * 2.2));
    let lo = p.strike * (1 - m);
    let hi = p.strike * (1 + m);
    lo = Math.min(lo, p.spot * 0.97);
    hi = Math.max(hi, p.spot * 1.03);
    return { lo: Math.max(0, lo), hi };
  }, [p.strike, p.spot, p.sigma]);

  const xOf = (v: number) => padX + ((v - lo) / (hi - lo)) * (W - padX * 2);
  const vOf = (x: number) => lo + ((x - padX) / (W - padX * 2)) * (hi - lo);
  const final = Math.min(hi, Math.max(lo, p.value ?? p.strike * (up ? 1.04 : 0.96)));
  const wins = up ? final >= p.strike : final < p.strike;
  const profit = p.payout - p.cost;
  const top = 22;
  const bottom = H - 26;
  const span = profit + p.cost || 1;
  const zeroY = top + (profit / span) * (bottom - top);
  const winY = top;
  const lossY = bottom;
  const kx = xOf(p.strike);
  const sx = xOf(p.spot);
  const fx = xOf(final);
  const fy = wins ? winY : lossY;
  const ret = wins ? p.payout : 0;

  const lossPath = up ? `M ${padX} ${lossY} H ${kx}` : `M ${kx} ${lossY} H ${W - padX}`;
  const winPath = up ? `M ${kx} ${winY} H ${W - padX}` : `M ${padX} ${winY} H ${kx}`;
  const winArea = up ? `M ${kx} ${zeroY} V ${winY} H ${W - padX} V ${zeroY} Z` : `M ${padX} ${zeroY} V ${winY} H ${kx} V ${zeroY} Z`;
  const lossArea = up ? `M ${padX} ${zeroY} V ${lossY} H ${kx} V ${zeroY} Z` : `M ${kx} ${zeroY} V ${lossY} H ${W - padX} V ${zeroY} Z`;

  const setFromClient = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    p.onValue(Math.min(hi, Math.max(lo, vOf(((clientX - r.left) / r.width) * W))));
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    setDragging(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setFromClient(e.clientX);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => { if (dragging) setFromClient(e.clientX); };
  const onUp = () => setDragging(false);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (hi - lo) / 100;
    if (e.key === 'Home') { e.preventDefault(); p.onValue(lo); }
    if (e.key === 'End') { e.preventDefault(); p.onValue(hi); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); p.onValue(Math.max(lo, final - step)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); p.onValue(Math.min(hi, final + step)); }
    if (e.key === 'PageDown') { e.preventDefault(); p.onValue(Math.max(lo, final - step * 10)); }
    if (e.key === 'PageUp') { e.preventDefault(); p.onValue(Math.min(hi, final + step * 10)); }
  };
  const closeLabels = Math.abs(sx - kx) < 46;

  return (
    <div className="sim glass">
      <div className="sim__head">
        <span className="sim__title">Payout simulator <span title="Drag the marker to see what this ticket returns at any final price. Binary: you get the full payout or nothing."><Info size={13} /></span></span>
        <span className="sim__at">{p.symbol} at <b className="num">{fmtPrice(final)}</b> on {p.expiryLabel}</span>
      </div>
      <div
        ref={wrapRef}
        className="sim__chart"
        tabIndex={0}
        role="slider"
        aria-label={`Simulated ${p.symbol} price at expiry`}
        aria-valuemin={Math.round(lo * 1e8) / 1e8}
        aria-valuemax={Math.round(hi * 1e8) / 1e8}
        aria-valuenow={Math.round(final * 1e8) / 1e8}
        aria-valuetext={`${fmtPrice(final)}: return ${fmtMoney(ret)}`}
        onKeyDown={onKey}
      >
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-hidden>
          <defs>
            <linearGradient id={`sw-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--up)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--up)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`sl-${uid}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="var(--down)" stopOpacity="0.3" />
              <stop offset="1" stopColor="var(--down)" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <path d={winArea} fill={`url(#sw-${uid})`} />
          <path d={lossArea} fill={`url(#sl-${uid})`} />
          <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 4" />
          <text x={padX + 2} y={zeroY - 5} className="sim__axis">Profit</text>
          <text x={W - padX - 2} y={zeroY + 13} className="sim__axis" textAnchor="end">Loss</text>
          {/* now + strike guides */}
          <line x1={sx} x2={sx} y1={top - 6} y2={H - 18} stroke="rgba(255,255,255,0.22)" strokeDasharray="2 3" />
          <text x={sx} y={H - 4} className="sim__axis" textAnchor="middle" dx={closeLabels ? (sx < kx ? -16 : 16) : 0}>Now</text>
          <line x1={kx} x2={kx} y1={winY} y2={lossY} stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeDasharray="3 3" />
          <text x={kx} y={H - 4} className="sim__axis sim__axis--strong" textAnchor="middle" dx={closeLabels ? (kx < sx ? -22 : 22) : 0}>{fmtStrike(p.strike, p.strikeStep)}</text>
          <path d={lossPath} stroke="var(--down)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d={winPath} stroke="var(--up)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* marker */}
          <line x1={fx} x2={fx} y1={top - 8} y2={H - 18} stroke="rgba(255,255,255,0.35)" />
          <circle cx={fx} cy={fy} r={dragging ? 8 : 7} fill="var(--bg)" stroke={wins ? 'var(--up)' : 'var(--down)'} strokeWidth="2.6" className="sim__knob" />
          <rect x={0} y={0} width={W} height={H} fill="transparent" style={{ cursor: dragging ? 'grabbing' : 'grab' }} />
        </svg>
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
