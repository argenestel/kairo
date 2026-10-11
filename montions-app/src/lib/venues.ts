import { CHAINS, ROUTABLE, chainEntry, fallbackFor, registry, withTimeout, type ChainKey } from '../chains';
import type { AssetInfo, ChainAdapter, ExpiryOption, MarketInfo } from '../chains/types';
import { canonicalMarketKey } from '../chains/types';

const adapterCache = new Map<ChainKey, Promise<{ adapter: ChainAdapter; demo: boolean }>>();

export function loadVenue(key: ChainKey): Promise<{ adapter: ChainAdapter; demo: boolean }> {
  let p = adapterCache.get(key);
  if (!p) {
    const entry = chainEntry(key);
    p = (async () => {
      if (entry.paused || entry.status !== 'live') {
        return { adapter: fallbackFor(key), demo: true };
      }
      try {
        const adapter = await withTimeout(registry[key](), 8000, `${entry.label} adapter`);
        return { adapter, demo: adapter.meta.id === 'mock' };
      } catch {
        return { adapter: fallbackFor(key), demo: true };
      }
    })();
    adapterCache.set(key, p);
  }
  return p;
}

export interface VenueMarket extends MarketInfo {
  chain: ChainKey;
  chainLabel: string;
  oracleName: string;
  demo: boolean;
  canonical: string;
  category?: AssetInfo['category'];
  oracleNote?: string;
  marketClosed?: boolean;
}

export const COMPARE_VENUES: ChainKey[] = ROUTABLE.map((c) => c.key);

async function pool<T>(n: number, items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) || 1 }, async () => {
    while (q.length) {
      const item = q.shift();
      if (item === undefined) return;
      await fn(item);
    }
  }));
}

function aroundAtm(strikes: number[], spot: number, take = 5): number[] {
  if (!strikes.length) return [];
  if (!(spot > 0)) {
    const mid = Math.floor(strikes.length / 2);
    return strikes.slice(Math.max(0, mid - 2), mid + 3);
  }
  let i = 0;
  for (let k = 1; k < strikes.length; k++) if (Math.abs(strikes[k] - spot) < Math.abs(strikes[i] - spot)) i = k;
  const out: number[] = [];
  const half = Math.floor(take / 2);
  for (let d = -half; d <= half; d++) {
    const v = strikes[i + d];
    if (v != null) out.push(v);
  }
  return out;
}

function pickExpiries(list: ExpiryOption[], now: number, n = 2): ExpiryOption[] {
  const live = list.filter((e) => e.hasMarkets && e.expiry > now + 60);
  const weekly = live.filter((e) => /week/i.test(e.tag ?? ''));
  const pool = (weekly.length ? weekly : live.length ? live : list).filter((e) => e.expiry > now + 60);
  return pool.slice(0, n);
}

export interface CatalogProgress {
  rows: VenueMarket[];
  loading: boolean;
  error: string | null;
}

/** Pull a bounded slice of books across routable venues (ATM ±2 strikes, 1–2 expiries). */
export async function collectMarkets(
  keys: ChainKey[] = COMPARE_VENUES,
  onChunk?: (rows: VenueMarket[]) => void,
): Promise<VenueMarket[]> {
  const now = Date.now() / 1000;
  const all: VenueMarket[] = [];

  await Promise.all(keys.map(async (key) => {
    const entry = CHAINS.find((c) => c.key === key);
    if (!entry || entry.paused) return;
    let adapter: ChainAdapter;
    let demo = false;
    try {
      const loaded = await withTimeout(loadVenue(key), 9000, `${entry.label}`);
      adapter = loaded.adapter;
      demo = loaded.demo;
    } catch (e) {
      console.warn('[kairo] venue', key, e);
      return;
    }
    let assets: AssetInfo[] = [];
    try {
      assets = await withTimeout(adapter.listAssets(), 8000, `${entry.label} assets`);
    } catch (e) {
      console.warn('[kairo] assets', key, e);
      return;
    }
    const jobs: Array<() => Promise<void>> = assets.map((a) => async () => {
      let expiries: ExpiryOption[] = [];
      let strikes: number[] = [];
      try {
        [expiries, strikes] = await Promise.all([
          withTimeout(adapter.expiries(a.symbol), 6000, 'expiries'),
          withTimeout(adapter.strikes(a.symbol, a.price), 6000, 'strikes'),
        ]);
      } catch { return; }
      const pickedE = pickExpiries(expiries, now, 2);
      const pickedK = aroundAtm(strikes, a.price, 5);
      for (const e of pickedE) {
        for (const k of pickedK) {
          try {
            const m = await withTimeout(adapter.getMarket(a.symbol, k, e.expiry), 5000, 'market');
            if (!m) continue;
            const row: VenueMarket = {
              ...m,
              chain: key,
              chainLabel: entry.label,
              oracleName: adapter.meta.oracleName,
              demo,
              canonical: canonicalMarketKey(m.symbol, m.strike, m.expiry),
              category: a.category,
              oracleNote: a.oracleNote,
              marketClosed: a.marketClosed,
            };
            all.push(row);
            onChunk?.([...all]);
          } catch { /* skip one cell */ }
        }
      }
    });
    await pool(4, jobs, (fn) => fn());
  }));
  return all;
}

export function bestAsk(m: MarketInfo): number | undefined {
  return m.asks[0]?.price;
}
export function bestBid(m: MarketInfo): number | undefined {
  return m.bids[0]?.price;
}
export function midOf(m: MarketInfo): number | undefined {
  const a = bestAsk(m);
  const b = bestBid(m);
  if (a != null && b != null) return (a + b) / 2;
  return a ?? b ?? m.lastPrice;
}
export function spreadOf(m: MarketInfo): number | undefined {
  const a = bestAsk(m);
  const b = bestBid(m);
  if (a == null || b == null) return undefined;
  return Math.max(0, a - b);
}
