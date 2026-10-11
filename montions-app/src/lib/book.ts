import { useEffect, useState } from 'react';
import type { ChainKey } from '../chains';
import type { BookLevel, ChainAdapter } from '../chains/types';
import { useChain } from '../state/chain';
import { eventSource } from './events';
import { loadVenue } from './venues';

export interface BookTarget {
  id?: string;
  symbol: string;
  strike: number;
  expiry: number;
  /** When set, load the book from the predictions event adapter (may be the demo mock). */
  kind?: 'price' | 'event';
}

export interface BookTrade {
  time: number;
  price: number;
  qty: number;
  takerBuy: boolean;
}

export type BookLevelEx = BookLevel & { maker?: boolean };

export interface BookSnap {
  bids: BookLevelEx[];
  asks: BookLevelEx[];
  trades: BookTrade[];
  lastPrice?: number;
  volume?: number;
}

function markMaker(levels: BookLevel[]): BookLevelEx[] {
  return levels.map((l, i) => {
    const extra = l as BookLevelEx;
    if (extra.maker) return extra;
    return i === 0 ? { ...l, maker: true } : { ...l };
  });
}

async function snapFrom(adapter: ChainAdapter, target: BookTarget): Promise<BookSnap> {
  if (target.id && typeof adapter.getBook === 'function') {
    try {
      const g = await adapter.getBook(target.id);
      return {
        bids: markMaker(g.bids),
        asks: markMaker(g.asks),
        trades: g.trades ?? [],
        lastPrice: g.trades?.[0]?.price ?? g.asks[0]?.price ?? g.bids[0]?.price,
      };
    } catch { /* fall through to getMarket */ }
  }
  const m = await adapter.getMarket(target.symbol, target.strike, target.expiry);
  if (!m) throw new Error('No book for this market yet');
  if (typeof adapter.getBook === 'function') {
    try {
      const g = await adapter.getBook(m.id);
      return {
        bids: markMaker(g.bids.length ? g.bids : m.bids),
        asks: markMaker(g.asks.length ? g.asks : m.asks),
        trades: g.trades ?? [],
        lastPrice: g.trades?.[0]?.price ?? m.lastPrice,
        volume: m.volume,
      };
    } catch { /* use getMarket levels */ }
  }
  return { bids: markMaker(m.bids), asks: markMaker(m.asks), trades: [], lastPrice: m.lastPrice, volume: m.volume };
}

/** Live YES book. Keeps the last snapshot while refreshing so the ladder never flickers. */
export function useBook(target: BookTarget | null, refreshMs = 4000, chain?: ChainKey): {
  book: BookSnap | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const { adapter, epoch } = useChain();
  const [book, setBook] = useState<BookSnap | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const ident = target
    ? `${epoch}:${chain ?? 'current'}:${target.id ?? ''}:${target.symbol}:${target.strike}:${target.expiry}`
    : null;

  useEffect(() => {
    if (!ident || !target) { setLoading(false); return; }
    let live = true;
    const first = key !== ident;
    if (first) setLoading(true);
    (async () => {
      try {
        const a = chain
          ? (await loadVenue(chain)).adapter
          : target.kind === 'event'
            ? eventSource(adapter).adapter
            : adapter;
        if (!a) throw new Error('No adapter');
        const snap = await snapFrom(a, target);
        if (!live) return;
        setBook(snap);
        setKey(ident);
        setError(null);
        setLoading(false);
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ident, n, adapter]);

  useEffect(() => {
    if (!ident || !refreshMs) return;
    const iv = setInterval(() => setN((x) => x + 1), refreshMs);
    return () => clearInterval(iv);
  }, [ident, refreshMs]);

  return { book: key === ident || !ident ? book : book, loading: loading && !book, error, reload: () => setN((x) => x + 1) };
}

export function bookStats(book: BookSnap | null): { mid?: number; spread?: number; last?: number } {
  if (!book) return {};
  const ask = book.asks[0]?.price;
  const bid = book.bids[0]?.price;
  const mid = ask != null && bid != null ? (ask + bid) / 2 : ask ?? bid ?? book.lastPrice;
  const spread = ask != null && bid != null ? Math.max(0, ask - bid) : undefined;
  return { mid, spread, last: book.lastPrice ?? book.trades[0]?.price ?? mid };
}
