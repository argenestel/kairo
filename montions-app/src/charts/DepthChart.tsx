import { useMemo, useState, type KeyboardEvent as KE, type PointerEvent as RE } from 'react';
import type { BookLevel } from '../chains/types';
import { fmtCents, fmtContracts } from '../lib/format';
import { clamp } from './geom';
import { useSize } from './useSize';
import './charts.css';

export interface DepthChartProps {
  bids: BookLevel[];
  asks: BookLevel[];
  mid?: number;
  height?: number;
  className?: string;
}

interface Node { price: number; cum: number }

function accumulate(levels: BookLevel[], towardLow: boolean): Node[] {
  const ordered = towardLow
    ? [...levels].sort((a, b) => b.price - a.price) // bids: best (high) first, walk down
    : [...levels].sort((a, b) => a.price - b.price); // asks: best (low) first, walk up
  let q = 0;
  const out: Node[] = [];
  for (const l of ordered) {
    if (!(l.qty > 0) || !(l.price > 0)) continue;
    q += l.qty;
    out.push({ price: l.price, cum: q });
  }
  return out;
}

export function DepthChart({ bids, asks, mid, height = 96, className }: DepthChartProps) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ price: number; cum: number; side: 'bid' | 'ask' } | null>(null);
  const W = Math.max(size.w, 0);
  const H = height;
  const padL = 6;
  const padR = 6;
  const padT = 8;
  const padB = 16;
  const iW = Math.max(1, W - padL - padR);
  const iH = Math.max(1, H - padT - padB);

  const { bidN, askN, lo, hi, maxCum, midP } = useMemo(() => {
    const bidN = accumulate(bids, true);
    const askN = accumulate(asks, false);
    const midP = mid ?? ((bidN[0]?.price != null && askN[0]?.price != null)
      ? (bidN[0].price + askN[0].price) / 2
      : bidN[0]?.price ?? askN[0]?.price ?? 0.5);
    const prices = [...bidN.map((n) => n.price), ...askN.map((n) => n.price), midP];
    let lo = Math.min(...prices, midP - 0.08);
    let hi = Math.max(...prices, midP + 0.08);
    lo = clamp(lo, 0.01, 0.98);
    hi = clamp(hi, lo + 0.02, 0.99);
    const maxCum = Math.max(1, ...bidN.map((n) => n.cum), ...askN.map((n) => n.cum));
    return { bidN, askN, lo, hi, maxCum, midP };
  }, [bids, asks, mid]);

  if (!bidN.length && !askN.length) return null;

  const xOf = (p: number) => padL + ((p - lo) / (hi - lo)) * iW;
  const yOf = (c: number) => padT + iH - (c / maxCum) * iH;
  const pOf = (x: number) => lo + ((x - padL) / iW) * (hi - lo);

  const poly = (nodes: Node[], side: 'bid' | 'ask') => {
    if (!nodes.length) return '';
    const startP = side === 'bid' ? Math.min(midP, nodes[0]!.price) : Math.max(midP, nodes[0]!.price);
    const last = nodes[nodes.length - 1]!;
    const pts = [`${xOf(startP).toFixed(2)} ${yOf(0).toFixed(2)}`, `${xOf(startP).toFixed(2)} ${yOf(nodes[0]!.cum).toFixed(2)}`];
    let previous = nodes[0]!.cum;
    for (const n of nodes) {
      pts.push(`${xOf(n.price).toFixed(2)} ${yOf(previous).toFixed(2)}`);
      pts.push(`${xOf(n.price).toFixed(2)} ${yOf(n.cum).toFixed(2)}`);
      previous = n.cum;
    }
    pts.push(`${xOf(last.price).toFixed(2)} ${yOf(0).toFixed(2)}`);
    return `M ${pts.join(' L ')} Z`;
  };

  const pick = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const price = clamp(pOf(x), lo, hi);
    const side: 'bid' | 'ask' = price <= midP ? 'bid' : 'ask';
    const nodes = side === 'bid' ? bidN : askN;
    if (!nodes.length) { setHover(null); return; }
    let best = nodes[0]!;
    let d = Math.abs(best.price - price);
    for (const n of nodes) {
      const dd = Math.abs(n.price - price);
      if (dd < d) { best = n; d = dd; }
    }
    setHover({ price: best.price, cum: best.cum, side });
  };

  const onMove = (e: RE<HTMLDivElement>) => pick(e.clientX, e.currentTarget);
  const onKey = (e: KE<HTMLDivElement>) => {
    const levels = [...bidN.map(n => ({ ...n, side: 'bid' as const })), ...askN.map(n => ({ ...n, side: 'ask' as const }))].sort((a, b) => a.price - b.price);
    let i = levels.findIndex(n => n.price === hover?.price && n.side === hover.side);
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    i = e.key === 'Home' ? 0 : e.key === 'End' ? levels.length - 1 : clamp(i + (e.key === 'ArrowLeft' ? -1 : 1), 0, levels.length - 1);
    setHover(levels[i]);
  };
  const mx = hover ? xOf(hover.price) : 0;

  return (
    <div className={`dc${className ? ` ${className}` : ''}`}>
      <div className="dc__head">
        <span>Depth</span>
        <span className="dc__mid">mid {midP != null ? fmtCents(midP) : '—'}</span>
      </div>
      <div
        ref={wrapRef}
        className="dc__plot"
        style={{ height: H }}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onMove}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="group"
        aria-label="Cumulative order book depth"
      >
        {W > 20 && (
          <svg className="dc__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
            <path d={poly(bidN, 'bid')} className="dc__bid" />
            <path d={poly(askN, 'ask')} className="dc__ask" />
            <line x1={xOf(midP)} x2={xOf(midP)} y1={padT} y2={padT + iH} className="dc__midline" />
            {hover && (
              <>
                <line x1={mx} x2={mx} y1={padT} y2={padT + iH} className="dc__hover" />
                <circle cx={mx} cy={yOf(hover.cum)} r="3.2" className={hover.side === 'bid' ? 'dc__dot dc__dot--bid' : 'dc__dot dc__dot--ask'} />
              </>
            )}
            <text x={W - padR} y={padT + 9} className="dc__axis" textAnchor="end">{fmtContracts(maxCum)} contracts</text>
            <text x={padL} y={H - 3} className="dc__axis">{fmtCents(lo)}</text>
            <text x={W / 2} y={H - 3} className="dc__axis" textAnchor="middle">{fmtCents(midP)}</text>
            <text x={W - padR} y={H - 3} className="dc__axis" textAnchor="end">{fmtCents(hi)}</text>
          </svg>
        )}
        {hover && (
          <div className="dc__tip" style={{ left: clamp(mx, 56, Math.max(56, W - 56)) }}>
            {fmtCents(hover.price)} · {fmtContracts(hover.cum)} {hover.side === 'bid' ? 'bid' : 'ask'}
          </div>
        )}
      </div>
    </div>
  );
}
