import { useEffect, useMemo, useRef, useState, type PointerEvent as RE, type KeyboardEvent as KE } from 'react';
import type { AssetCategory } from '../chains/types';
import { fmtPrice } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';
import { buildCone } from './history';
import { clamp, fmtAxisTime, lerp, niceTicks } from './geom';
import { usePriceHistory } from './usePriceHistory';
import { useSize } from './useSize';
import './charts.css';

export interface PriceChartProps {
  symbol: string;
  spot: number;
  vol: number;
  strike?: number;
  expiry?: number;
  category?: AssetCategory;
  compact?: boolean;
  className?: string;
}

interface View { t0: number; t1: number }

function linePath(xs: { x: number; y: number }[]): string {
  if (!xs.length) return '';
  return xs.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}

export function PriceChart({ symbol, spot, vol, strike, expiry, category, compact, className }: PriceChartProps) {
  const { snap, loading } = usePriceHistory(symbol, spot, vol, category);
  const [plotRef, size] = useSize<HTMLDivElement>();
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; t0: number; t1: number } | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; t0: number; t1: number } | null>(null);
  const reduced = useReducedMotion();
  const userView = useRef(false);

  useEffect(() => { setView(null); userView.current = false; }, [symbol]);

  const points = snap?.points ?? [];
  const last = points[points.length - 1];
  const s0 = last?.value ?? (spot > 0 ? spot : 0);
  const tNow = last?.time ?? Date.now() / 1000;
  const tExp = expiry && expiry > tNow ? expiry : tNow + 4 * 3600;
  const cone = useMemo(
    () => (s0 > 0 && expiry && expiry > tNow ? buildCone(tNow, s0, expiry, vol) : []),
    [tNow, s0, expiry, vol],
  );

  const domain = useMemo(() => {
    const tMin = points[0]?.time ?? tNow - 24 * 3600;
    const tMax = Math.max(tExp, tNow + 60);
    return { tMin, tMax };
  }, [points, tNow, tExp]);

  const vis: View = view ?? { t0: domain.tMin, t1: domain.tMax };

  const W = Math.max(size.w, 0);
  const H = compact ? 138 : 188;
  const padL = 48;
  const padR = 12;
  const padT = 18;
  const padB = 22;
  const iW = Math.max(1, W - padL - padR);
  const iH = Math.max(1, H - padT - padB);

  const yDomain = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    const consider = (v: number) => { if (v > 0 && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
    for (const p of points) if (p.time >= vis.t0 && p.time <= vis.t1) consider(p.value);
    if (strike) consider(strike);
    consider(s0);
    for (const c of cone) if (c.t >= vis.t0 && c.t <= vis.t1) { consider(c.up); consider(c.down); }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
      const mid = s0 > 0 ? s0 : 1;
      lo = mid * 0.96; hi = mid * 1.04;
    }
    const pad = (hi - lo) * 0.08 || midPad(lo);
    return { lo: Math.max(0, lo - pad), hi: hi + pad };
  }, [points, vis.t0, vis.t1, strike, s0, cone]);

  const xOf = (t: number) => padL + ((t - vis.t0) / Math.max(1e-6, vis.t1 - vis.t0)) * iW;
  const yOf = (v: number) => padT + (1 - (v - yDomain.lo) / Math.max(1e-9, yDomain.hi - yDomain.lo)) * iH;
  const tOf = (x: number) => vis.t0 + ((x - padL) / iW) * (vis.t1 - vis.t0);
  const vOf = (y: number) => yDomain.hi - ((y - padT) / iH) * (yDomain.hi - yDomain.lo);

  const line = useMemo(() => {
    const pts = points.filter((p) => p.time >= vis.t0 - 60 && p.time <= vis.t1 + 60);
    return pts.map((p) => ({ x: xOf(p.time), y: yOf(p.value), t: p.time, v: p.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, vis.t0, vis.t1, yDomain.lo, yDomain.hi, W, H]);

  const areaD = line.length
    ? `${linePath(line)} L ${line[line.length - 1]!.x.toFixed(2)} ${(padT + iH).toFixed(2)} L ${line[0]!.x.toFixed(2)} ${(padT + iH).toFixed(2)} Z`
    : '';

  const conePath = useMemo(() => {
    const cs = cone.filter((c) => c.t >= vis.t0 && c.t <= vis.t1 + 1);
    if (cs.length < 2) return '';
    const up = cs.map((c) => `${xOf(c.t).toFixed(2)} ${yOf(c.up).toFixed(2)}`);
    const dn = [...cs].reverse().map((c) => `${xOf(c.t).toFixed(2)} ${yOf(c.down).toFixed(2)}`);
    return `M ${up.join(' L ')} L ${dn.join(' L ')} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cone, vis.t0, vis.t1, yDomain.lo, yDomain.hi, W, H]);

  const applyView = (next: View, fromUser = true) => {
    const span = Math.max(5 * 60, Math.min(domain.tMax - domain.tMin, next.t1 - next.t0));
    let t0 = next.t0;
    let t1 = t0 + span;
    if (t1 > domain.tMax + 3600) { t1 = domain.tMax + 3600; t0 = t1 - span; }
    if (t0 < domain.tMin - 3600) { t0 = domain.tMin - 3600; t1 = t0 + span; }
    if (fromUser) userView.current = true;
    setView({ t0, t1 });
  };

  const zoomAt = (pivot: number, factor: number) => {
    const span = vis.t1 - vis.t0;
    const next = span * factor;
    const a = (pivot - vis.t0) / span;
    applyView({ t0: pivot - next * a, t1: pivot + next * (1 - a) });
  };

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const pivot = tOf(x);
      zoomAt(pivot, e.deltaY > 0 ? 1.12 : 0.88);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vis.t0, vis.t1, W]);

  const localXY = (e: RE<HTMLElement>) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: RE<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = localXY(e);
    ptrs.current.set(e.pointerId, p);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), t0: vis.t0, t1: vis.t1 };
      drag.current = null;
    } else {
      drag.current = { x: p.x, t0: vis.t0, t1: vis.t1 };
      pinch.current = null;
    }
  };
  const onMove = (e: RE<HTMLDivElement>) => {
    const p = localXY(e);
    setHover(p);
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, p);
    if (ptrs.current.size === 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 4 && pinch.current.dist > 4) {
        const k = pinch.current.dist / dist;
        const midT = (pinch.current.t0 + pinch.current.t1) / 2;
        const span = (pinch.current.t1 - pinch.current.t0) * k;
        applyView({ t0: midT - span / 2, t1: midT + span / 2 });
      }
      return;
    }
    if (drag.current) {
      const span = drag.current.t1 - drag.current.t0;
      const dt = -((p.x - drag.current.x) / iW) * span;
      applyView({ t0: drag.current.t0 + dt, t1: drag.current.t1 + dt });
    }
  };
  const onUp = (e: RE<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size === 0) drag.current = null;
  };
  const onDbl = () => { userView.current = false; setView(null); };

  const onKey = (e: KE<HTMLDivElement>) => {
    const span = vis.t1 - vis.t0;
    if (e.key === 'ArrowLeft') { e.preventDefault(); applyView({ t0: vis.t0 - span * 0.12, t1: vis.t1 - span * 0.12 }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); applyView({ t0: vis.t0 + span * 0.12, t1: vis.t1 + span * 0.12 }); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt((vis.t0 + vis.t1) / 2, 0.8); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt((vis.t0 + vis.t1) / 2, 1.25); }
    if (e.key === '0' || e.key === 'Home') { e.preventDefault(); onDbl(); }
  };

  const hoverT = hover ? clamp(tOf(hover.x), vis.t0, vis.t1) : null;
  const hoverPt = hoverT != null ? interp(points, hoverT) : null;
  const hx = hoverT != null ? xOf(hoverT) : 0;
  const hy = hoverPt != null ? yOf(hoverPt) : 0;

  const yTicks = niceTicks(yDomain.lo, yDomain.hi, compact ? 3 : 4);
  const xTicks = niceTicks(vis.t0, vis.t1, compact ? 3 : 5);

  const kx = strike != null && strike > 0 ? yOf(strike) : null;
  const ex = expiry != null ? xOf(expiry) : null;
  const sx = last ? xOf(last.time) : null;
  const sy = last ? yOf(last.value) : null;

  const uid = symbol.replace(/[^A-Za-z0-9]/g, '');

  return (
    <div className={`pc glass${compact ? ' pc--compact' : ''}${className ? ` ${className}` : ''}`}>
      <div className="pc__head">
        <span className="pc__title">{symbol} · USD</span>
        <span className="pc__src">{loading && !snap ? 'Loading…' : snap?.label ?? '—'}</span>
      </div>
      <div
        ref={plotRef}
        className="pc__plot"
        style={{ height: H }}
        tabIndex={0}
        role="img"
        aria-label={`${symbol} price chart. Drag to pan, scroll to zoom.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { if (!drag.current) setHover(null); }}
        onDoubleClick={onDbl}
        onKeyDown={onKey}
      >
        {W > 40 && (
          <svg className="pc__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
            <defs>
              <linearGradient id={`pc-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--up)" stopOpacity="0.28" />
                <stop offset="1" stopColor="var(--up)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`pc-cone-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--play)" stopOpacity="0.22" />
                <stop offset="1" stopColor="var(--play)" stopOpacity="0.05" />
              </linearGradient>
              <clipPath id={`pc-clip-${uid}`}>
                <rect x={padL} y={padT} width={iW} height={iH} />
              </clipPath>
            </defs>
            {yTicks.map((v) => (
              <g key={`y-${v}`}>
                <line x1={padL} x2={padL + iW} y1={yOf(v)} y2={yOf(v)} className="pc__grid" />
                <text x={padL - 6} y={yOf(v) + 3} className="pc__lbl" textAnchor="end">{fmtPrice(v)}</text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x-${t}`} x={xOf(t)} y={H - 6} className="pc__lbl" textAnchor="middle">{fmtAxisTime(t)}</text>
            ))}
            <g clipPath={`url(#pc-clip-${uid})`}>
              {conePath && <path d={conePath} fill={`url(#pc-cone-${uid})`} className="pc__cone" />}
              {cone.length > 1 && (
                <>
                  <path d={linePath(cone.map((c) => ({ x: xOf(c.t), y: yOf(c.up) })))} className="pc__cone-edge" />
                  <path d={linePath(cone.map((c) => ({ x: xOf(c.t), y: yOf(c.down) })))} className="pc__cone-edge" />
                </>
              )}
              {areaD && <path d={areaD} fill={`url(#pc-fill-${uid})`} />}
              {line.length > 1 && (
                <path d={linePath(line)} className="pc__line" style={reduced ? undefined : { transition: 'none' }} />
              )}
              {kx != null && (
                <line x1={padL} x2={padL + iW} y1={kx} y2={kx} className="pc__strike" />
              )}
              {ex != null && expiry != null && expiry >= vis.t0 && expiry <= vis.t1 + 120 && (
                <line x1={ex} x2={ex} y1={padT} y2={padT + iH} className="pc__expiry" />
              )}
              {sx != null && sy != null && (
                <circle cx={sx} cy={sy} r="4.2" className="pc__spot" />
              )}
              {hover && hoverPt != null && (
                <>
                  <line x1={hx} x2={hx} y1={padT} y2={padT + iH} className="pc__cross" />
                  <line x1={padL} x2={padL + iW} y1={hy} y2={hy} className="pc__cross" />
                  <circle cx={hx} cy={hy} r="4" className="pc__cross-dot" />
                </>
              )}
            </g>
            {kx != null && strike != null && (
              <text x={padL + iW - 2} y={kx - 4} className="pc__tag pc__tag--k" textAnchor="end">K {fmtPrice(strike)}</text>
            )}
            {ex != null && expiry != null && expiry >= vis.t0 && expiry <= vis.t1 + 120 && (
              <text x={ex + 4} y={padT + 10} className="pc__tag pc__tag--exp">expiry</text>
            )}
          </svg>
        )}
        {hover && hoverPt != null && hoverT != null && (
          <div
            className="pc__tip"
            style={{
              left: clamp(hx, 72, Math.max(72, W - 72)),
              top: clamp(hy - 14, 18, H - 36),
            }}
          >
            {fmtPrice(hoverPt)} <span>· {fmtAxisTime(hoverT)}</span>
          </div>
        )}
        {loading && !points.length && <div className="pc__skel" aria-hidden />}
      </div>
      <p className="pc__hint">Drag to pan · scroll or pinch to zoom · double-click to reset{strike ? ' · gold = strike' : ''}{expiry ? ' · dashed = expiry · cone = ±1σ' : ''}</p>
    </div>
  );
}

function midPad(lo: number): number {
  return Math.max(lo * 0.02, 0.01);
}

function interp(points: { time: number; value: number }[], t: number): number | null {
  if (!points.length) return null;
  if (t <= points[0]!.time) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (t >= last.time) return last.value;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (points[m]!.time <= t) lo = m; else hi = m;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const u = (t - a.time) / Math.max(1e-9, b.time - a.time);
  return lerp(a.value, b.value, u);
}
