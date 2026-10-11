import { useEffect, useState } from 'react';
import { useChain } from '../state/chain';
import type { AssetCategory } from '../chains/types';
import { loadHistory, noteLiveSample, type HistorySnap, type Point } from './history';

export function usePriceHistory(
  symbol: string | null,
  spot: number,
  vol: number,
  category?: AssetCategory,
): { snap: HistorySnap | null; loading: boolean } {
  const { key, epoch } = useChain();
  const [snap, setSnap] = useState<HistorySnap | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) { setSnap(null); return; }
    let live = true;
    setLoading(true);
    loadHistory({ chain: key, symbol, spot, vol, category }).then(
      (s) => { if (!live) return; setSnap(s); setLoading(false); },
      () => { if (live) setLoading(false); },
    );
    return () => { live = false; };
    // spot is applied below; don't refetch on every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, epoch, symbol, vol, category]);

  useEffect(() => {
    if (!symbol || !(spot > 0)) return;
    if (key === 'solana') noteLiveSample(symbol, spot);
    setSnap((prev) => {
      if (!prev || !prev.points.length) return prev;
      const pts = prev.points;
      const last = pts[pts.length - 1]!;
      const now = Date.now() / 1000;
      if (Math.abs(last.value - spot) / Math.max(spot, 1e-9) < 1e-5 && now - last.time < 2) return prev;
      const next: Point[] = pts.slice();
      if (now - last.time < 25) next[next.length - 1] = { time: Math.max(last.time, now), value: spot };
      else next.push({ time: now, value: spot });
      return { ...prev, points: next };
    });
  }, [spot, symbol, key]);

  return { snap, loading };
}
