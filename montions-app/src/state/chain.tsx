import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssetInfo, Balances, ChainAdapter } from '../chains/types';
import {
  chainEntry, DEFAULT_CHAIN, fallbackFor, isChainKey, registry, withTimeout,
  type ChainEntry, type ChainKey,
} from '../chains';

const LS_KEY = 'montions.chain';

export function initialChainKey(): ChainKey {
  try {
    const q = new URLSearchParams(location.search).get('chain');
    if (isChainKey(q) && q !== 'hyperliquid') return q;
    const s = localStorage.getItem(LS_KEY);
    if (isChainKey(s) && s !== 'mock' && s !== 'hyperliquid') return s;
  } catch { /* ignore */ }
  return DEFAULT_CHAIN;
}

function persistChain(key: ChainKey) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('chain', key);
    history.replaceState(history.state, '', url);
    if (key !== 'mock') localStorage.setItem(LS_KEY, key);
    document.documentElement.dataset.chain = key;
  } catch { /* ignore */ }
}

export type DemoKind = 'demo' | 'coming-online' | 'fallback';

export interface ChainState {
  key: ChainKey;
  setKey: (k: ChainKey) => void;
  entry: ChainEntry;
  adapter: ChainAdapter | null;
  /** Bumps whenever the adapter instance changes (use in effect deps). */
  epoch: number;
  loading: boolean;
  /** Non-null when the UI is running on demo data (forced mock, coming-online, or the real adapter failed). */
  demo: { reason: string; forced: boolean; kind: DemoKind } | null;
  retry: () => void;
  assets: AssetInfo[];
  prices: Record<string, number>;
  address: string | null;
  balances: Balances | null;
  refreshBalances: () => void;
  positionsVersion: number;
  bumpPositions: () => void;
}

const Ctx = createContext<ChainState | null>(null);

export function useChain(): ChainState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChain outside ChainProvider');
  return v;
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [key, setKeyState] = useState<ChainKey>(initialChainKey);
  const [adapter, setAdapter] = useState<ChainAdapter | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState<ChainState['demo']>(null);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [address, setAddress] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [positionsVersion, setPositionsVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const adapterRef = useRef<ChainAdapter | null>(null);
  const entry = chainEntry(key);

  const setKey = useCallback((k: ChainKey) => {
    persistChain(k);
    setKeyState(k);
  }, []);

  useEffect(() => persistChain(key), [key]);

  // ── load adapter (real → fallback mock; coming-online / demo skip the real load) ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAdapter(null);
    adapterRef.current = null;
    setAssets([]);
    setPrices({});
    setAddress(null);
    setBalances(null);
    (async () => {
      let a: ChainAdapter;
      let list: AssetInfo[] = [];
      let demoState: ChainState['demo'] = null;
      const skipReal = entry.status !== 'live';
      try {
        if (skipReal) {
          a = fallbackFor(key);
          list = await a.listAssets();
          if (entry.status === 'demo') {
            demoState = { reason: 'Demo mode — prices are simulated and nothing is sent onchain.', forced: true, kind: 'demo' };
          } else {
            demoState = {
              reason: `${entry.label} is coming online. Showing demo data — nothing is sent onchain.`,
              forced: true,
              kind: 'coming-online',
            };
          }
        } else {
          a = await withTimeout(registry[key](), 15000, 'Loading the adapter');
          list = await withTimeout(a.listAssets(), 15000, 'Loading markets');
          if (!list.length) throw new Error('No assets are listed on this chain yet');
        }
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        console.warn(`[montions] ${key} adapter unavailable, using demo data:`, e);
        a = fallbackFor(key);
        list = await a.listAssets();
        demoState = {
          reason: `${entry.label} ${entry.network} is unavailable (${why}). Showing demo data.`,
          forced: false,
          kind: 'fallback',
        };
      }
      if (cancelled) return;
      adapterRef.current = a;
      setAdapter(a);
      setDemo(demoState);
      setAssets(list);
      setPrices(Object.fromEntries(list.map((x) => [x.symbol, x.price])));
      setAddress(a.address());
      setEpoch((n) => n + 1);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [key, attempt, entry.status, entry.label, entry.network]);

  // ── live prices (batched, flushed ~3×/s) ──
  useEffect(() => {
    if (!adapter) return;
    const pending: Record<string, number> = {};
    let dirty = false;
    let unsub: (() => void) | undefined;
    try {
      unsub = adapter.subscribePrices((symbol, price) => {
        if (!(price > 0)) return;
        pending[symbol] = price;
        dirty = true;
      });
    } catch (e) { console.warn('[montions] subscribePrices failed', e); }
    const iv = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      const snap = { ...pending };
      setPrices((p) => ({ ...p, ...snap }));
    }, 350);
    return () => { clearInterval(iv); try { unsub?.(); } catch { /* ignore */ } };
  }, [adapter]);

  // ── wallet ──
  const refreshBalances = useCallback(() => {
    const a = adapterRef.current;
    if (!a || !a.address()) { setBalances(null); return; }
    a.balances().then((b) => { if (adapterRef.current === a) setBalances(b); }, (e) => console.warn('[montions] balances', e));
  }, []);

  useEffect(() => {
    if (!adapter) return;
    let off: (() => void) | undefined;
    try {
      off = adapter.onAccountChange((addr) => {
        setAddress(addr);
        setPositionsVersion((n) => n + 1);
      });
    } catch { /* ignore */ }
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, [adapter]);

  useEffect(() => {
    refreshBalances();
    if (!address) return;
    const iv = setInterval(refreshBalances, 20000);
    return () => clearInterval(iv);
  }, [address, epoch, refreshBalances]);

  const value = useMemo<ChainState>(() => ({
    key, setKey, entry, adapter, epoch, loading, demo,
    retry: () => setAttempt((n) => n + 1),
    assets, prices, address, balances, refreshBalances,
    positionsVersion, bumpPositions: () => setPositionsVersion((n) => n + 1),
  }), [key, setKey, entry, adapter, epoch, loading, demo, assets, prices, address, balances, refreshBalances, positionsVersion]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Asset with its live price merged in. */
export function useAsset(symbol: string | null): AssetInfo | null {
  const { assets, prices } = useChain();
  return useMemo(() => {
    if (!symbol) return null;
    const a = assets.find((x) => x.symbol === symbol);
    if (!a) return null;
    const p = prices[symbol];
    return p && p > 0 ? { ...a, price: p } : a;
  }, [assets, prices, symbol]);
}
