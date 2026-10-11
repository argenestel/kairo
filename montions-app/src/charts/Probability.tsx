import { useMemo } from 'react';
import type { Direction } from '../chains/types';
import { useAsset } from '../state/chain';
import { bookStats, useBook } from '../lib/book';
import { chanceFor } from '../lib/model';
import { fmtPct } from '../lib/format';
import './charts.css';

export interface ProbabilityReadoutProps {
  symbol: string;
  strike: number;
  expiry: number;
  direction?: Direction;
  /** YES mid in [0,1] when the caller already has a book. */
  bookMid?: number;
  compact?: boolean;
  className?: string;
}

export function ProbabilityReadout({
  symbol, strike, expiry, direction = 'above', bookMid, compact, className,
}: ProbabilityReadoutProps) {
  const asset = useAsset(symbol);
  const needBook = bookMid == null;
  const { book } = useBook(
    needBook && symbol && strike != null && expiry != null
      ? { symbol, strike, expiry }
      : null,
    6000,
  );
  const mid = bookMid ?? bookStats(book).mid;
  const modelYes = useMemo(() => {
    if (!asset || !(asset.price > 0) || !(strike > 0) || !expiry) return null;
    return chanceFor('above', asset.price, strike, asset.vol, expiry - Date.now() / 1000);
  }, [asset, strike, expiry]);

  const up = direction === 'above';
  const bookP = mid != null ? (up ? mid : 1 - mid) : null;
  const modelP = modelYes != null ? (up ? modelYes : 1 - modelYes) : null;
  if (bookP == null && modelP == null) return null;

  const side = up ? 'YES' : 'NO';
  return (
    <div className={`odds${compact ? ' odds--compact' : ''}${className ? ` ${className}` : ''}`}>
      <div className="odds__col">
        <span className="odds__k">Book {side}</span>
        <b className="odds__v num">{bookP != null ? fmtPct(bookP) : '—'}</b>
        <small>implied from mid</small>
      </div>
      <div className="odds__col">
        <span className="odds__k">Model {side}</span>
        <b className="odds__v num">{modelP != null ? fmtPct(modelP) : '—'}</b>
        <small>lognormal fair</small>
      </div>
      <div className="odds__track" aria-hidden>
        {modelP != null && <i className="odds__mark odds__mark--model" style={{ left: `${clamp01(modelP) * 100}%` }} />}
        {bookP != null && <i className="odds__mark odds__mark--book" style={{ left: `${clamp01(bookP) * 100}%` }} />}
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
