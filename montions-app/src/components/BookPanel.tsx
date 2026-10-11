import { useMemo, useState } from 'react';
import type { ChainKey } from '../chains';
import { useCopy } from '../copy';
import { bookStats, useBook, type BookTarget } from '../lib/book';
import { fmtCents, fmtClock, fmtContracts } from '../lib/format';
import { Sheet } from './Sheet';

export function BookPanel({ market, compact = false, chain }: { market: BookTarget; compact?: boolean; chain?: ChainKey }) {
  const copy = useCopy();
  const { book, loading, error, reload } = useBook(market, 4000, chain);
  const stats = bookStats(book);
  const maxQty = useMemo(() => {
    if (!book) return 1;
    return Math.max(1, ...book.asks.map((l) => l.qty), ...book.bids.map((l) => l.qty));
  }, [book]);

  if (loading) {
    return (
      <div className="book glass" aria-busy="true" aria-label="Loading order book">
        <div className="book__head"><span className="skel-text" style={{ width: 120, height: 14 }} /></div>
        <div className="book__skel">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel-row" />)}</div>
      </div>
    );
  }
  if (error && !book) {
    return (
      <div className="book glass">
        <p className="book__empty">{error}</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={reload}>{copy.book.retry}</button>
      </div>
    );
  }
  if (!book || (!book.bids.length && !book.asks.length)) {
    return (
      <div className="book glass">
        <p className="book__empty">{copy.book.empty}</p>
      </div>
    );
  }

  const asks = [...book.asks].slice(0, compact ? 4 : 6).reverse();
  const bids = book.bids.slice(0, compact ? 4 : 6);
  const trades = book.trades.slice(0, compact ? 4 : 8);

  return (
    <div className={`book glass${compact ? ' book--compact' : ''}`}>
      <div className="book__head">
        <div>
          <b>{copy.book.yes}</b>
          <small className="book__hint">{copy.book.noHint}</small>
        </div>
        <dl className="book__stats">
          <div><dt>{copy.book.last}</dt><dd className="num">{stats.last != null ? fmtCents(stats.last) : '—'}</dd></div>
          <div><dt>{copy.book.mid}</dt><dd className="num">{stats.mid != null ? fmtCents(stats.mid) : '—'}</dd></div>
          <div><dt>{copy.book.spread}</dt><dd className="num">{stats.spread != null ? fmtCents(stats.spread) : '—'}</dd></div>
        </dl>
      </div>
      <table className="book__ladder">
        <caption className="sr-only">YES order book. Asks above, bids below. NO price is one minus YES.</caption>
        <thead>
          <tr>
            <th scope="col">Side</th>
            <th scope="col">Price</th>
            <th scope="col">Size</th>
            <th scope="col"><span className="sr-only">Depth</span></th>
          </tr>
        </thead>
        <tbody>
          {asks.map((l) => (
            <tr key={`a-${l.price}`} className={`book__ask${l.maker ? ' is-maker' : ''}`}>
              <td>ASK</td>
              <td className="num down">{fmtCents(l.price)}</td>
              <td className="num">{fmtContracts(l.qty)}</td>
              <td>
                <span className="book__bar book__bar--ask" style={{ width: `${(l.qty / maxQty) * 100}%` }} />
                {l.maker && <span className="book__maker">{copy.book.maker}</span>}
              </td>
            </tr>
          ))}
          <tr className="book__mid">
            <td colSpan={4}>
              mid {stats.mid != null ? fmtCents(stats.mid) : '—'}
              {stats.spread != null && <> · spread {fmtCents(stats.spread)}</>}
            </td>
          </tr>
          {bids.map((l) => (
            <tr key={`b-${l.price}`} className={`book__bid${l.maker ? ' is-maker' : ''}`}>
              <td>BID</td>
              <td className="num up">{fmtCents(l.price)}</td>
              <td className="num">{fmtContracts(l.qty)}</td>
              <td>
                <span className="book__bar book__bar--bid" style={{ width: `${(l.qty / maxQty) * 100}%` }} />
                {l.maker && <span className="book__maker">{copy.book.maker}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="book__trades">
        <h3>{copy.book.trades}</h3>
        {trades.length === 0 ? (
          <p className="book__empty">No prints yet.</p>
        ) : (
          <ol>
            {trades.map((t, i) => (
              <li key={`${t.time}-${i}`}>
                <time dateTime={new Date(t.time * 1000).toISOString()}>{fmtClock(t.time)}</time>
                <span className={`num ${t.takerBuy ? 'up' : 'down'}`}>{fmtCents(t.price)}</span>
                <span className="num">{fmtContracts(t.qty)}</span>
                <span className="book__taker">{t.takerBuy ? copy.book.buy : copy.book.sell}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function BookDisclosure({ market, chain, className }: { market: BookTarget; chain?: ChainKey; className?: string }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  return (
    <div className={`book-disc${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="book-disc__btn"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {copy.book.view}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={copy.book.yes}>
        <BookPanel market={market} chain={chain} />
      </Sheet>
    </div>
  );
}
