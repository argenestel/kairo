import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Direction, ExpiryOption, Quote } from '../chains/types';
import { useChain } from '../state/chain';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(iv);
  }, [intervalMs]);
  return now;
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setR(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return r;
}

export function useMedia(query: string): boolean {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const h = () => setR(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return r;
}

export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── adapter data ────────────────────────────────────────────────────────

type Cache<T> = Map<string, { at: number; value: T }>;
const strikeCache: Cache<number[]> = new Map();
const expiryCache: Cache<ExpiryOption[]> = new Map();
const quoteCache: Cache<Quote> = new Map();

export interface Loadable<T> { data: T | null; loading: boolean; error: string | null; reload: () => void }

export function useStrikes(symbol: string | null, spot: number): Loadable<number[]> {
  const { adapter, epoch } = useChain();
  const resource = `${epoch}:${symbol}`;
  const [state, setState] = useState<{ resource: string | null; data: number[] | null; loading: boolean; error: string | null }>({ resource: null, data: null, loading: false, error: null });
  const [n, setN] = useState(0);
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const hasSpot = spot > 0;
  useEffect(() => {
    if (!adapter || !symbol || !hasSpot) { setState({ resource, data: null, loading: !!symbol, error: null }); return; }
    const key = `${epoch}:${symbol}`;
    const hit = strikeCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000 && n === 0) { setState({ resource, data: hit.value, loading: false, error: null }); return; }
    let live = true;
    setState({ resource, data: null, loading: true, error: null });
    adapter.strikes(symbol, spotRef.current).then(
      (ks) => {
        const sorted = [...ks].filter((k) => k > 0).sort((a, b) => a - b);
        strikeCache.set(key, { at: Date.now(), value: sorted });
        if (live) setState({ resource, data: sorted, loading: false, error: null });
      },
      (e) => live && setState({ resource, data: null, loading: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => { live = false; };
  }, [adapter, epoch, symbol, hasSpot, n]);
  return { data: state.resource === resource ? state.data : null, loading: state.resource !== resource || state.loading, error: state.resource === resource ? state.error : null, reload: () => setN((x) => x + 1) };
}

export function useExpiries(symbol: string | null): Loadable<ExpiryOption[]> {
  const { adapter, epoch } = useChain();
  const resource = `${epoch}:${symbol}`;
  const [state, setState] = useState<{ resource: string | null; data: ExpiryOption[] | null; loading: boolean; error: string | null }>({ resource: null, data: null, loading: false, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!adapter || !symbol) { setState({ resource, data: null, loading: false, error: null }); return; }
    const key = `${epoch}:${symbol}`;
    const hit = expiryCache.get(key);
    const fresh = (v: ExpiryOption[]) => v.filter((e) => e.expiry > Date.now() / 1000 + 60);
    if (hit && Date.now() - hit.at < 60_000 && n === 0) { setState({ resource, data: fresh(hit.value), loading: false, error: null }); return; }
    let live = true;
    setState({ resource, data: null, loading: true, error: null });
    adapter.expiries(symbol).then(
      (xs) => {
        const sorted = [...xs].sort((a, b) => a.expiry - b.expiry);
        expiryCache.set(key, { at: Date.now(), value: sorted });
        if (live) setState({ resource, data: fresh(sorted), loading: false, error: null });
      },
      (e) => live && setState({ resource, data: null, loading: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => { live = false; };
  }, [adapter, epoch, symbol, n]);
  return { data: state.resource === resource ? state.data : null, loading: state.resource !== resource || state.loading, error: state.resource === resource ? state.error : null, reload: () => setN((x) => x + 1) };
}

export interface QuoteArgs { symbol: string; strike: number; expiry: number; direction: Direction; budget: number }

/** Debounced quote; keeps the last value while a new one loads; refreshes every `refreshMs`. */
export function useQuote(args: QuoteArgs | null, debounceMs = 220, refreshMs = 15000): { quote: Quote | null; loading: boolean; error: string | null; stale: boolean } {
  const { adapter, epoch } = useChain();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteKey, setQuoteKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = args && adapter ? `${epoch}:${args.symbol}:${args.strike}:${args.expiry}:${args.direction}:${args.budget}` : null;

  useEffect(() => {
    if (!key || !refreshMs) return;
    const iv = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(iv);
  }, [key, refreshMs]);

  useEffect(() => {
    if (!key || !args || !adapter) { setLoading(false); return; }
    const hit = quoteCache.get(key);
    if (hit && Date.now() - hit.at < 4000) { setQuote(hit.value); setQuoteKey(key); setLoading(false); setError(null); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      adapter.quote(args.symbol, args.strike, args.expiry, args.direction, args.budget).then(
        (q) => {
          quoteCache.set(key, { at: Date.now(), value: q });
          if (!live) return;
          setQuote(q); setQuoteKey(key); setError(null); setLoading(false);
        },
        (e) => {
          if (!live) return;
          setError(e instanceof Error ? e.message : String(e)); setLoading(false);
        },
      );
    }, debounceMs);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return { quote, loading, error, stale: quoteKey !== key };
}

/** Fire-and-forget fresh quote (bypasses the cache) — used right before signing. */
export async function freshQuote(adapter: NonNullable<ReturnType<typeof useChain>['adapter']>, a: QuoteArgs): Promise<Quote> {
  return adapter.quote(a.symbol, a.strike, a.expiry, a.direction, a.budget);
}

export function haptic(ms = 4) {
  try {
    if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms);
  } catch { /* ignore */ }
}
