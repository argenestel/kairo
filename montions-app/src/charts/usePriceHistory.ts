import { useEffect, useRef, useState } from 'react';
import { useChain } from '../state/chain';
import type { AssetCategory } from '../chains/types';
import type { HistorySnap } from './history';

export function usePriceHistory(symbol: string | null, spot: number, vol: number, category?: AssetCategory) {
  const { key, epoch } = useChain();
  const [snap, setSnap] = useState<HistorySnap | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef({ spot, vol });
  current.current = { spot, vol };

  useEffect(() => {
    setSnap(null);
    if (!symbol) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      setLoading(true);
      try {
        // Keep the oracle loader and viem out of the initial chart bundle.
        const { loadHistory } = await import('./history');
        const next = await loadHistory({ chain: key, symbol, ...current.current, category });
        if (active) setSnap(prev => next.points.length || !prev ? next : { ...prev, label: `${prev.label.replace(' · refresh unavailable', '')} · refresh unavailable` });
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(refresh, key === 'solana' ? 5_000 : 30_000);
        }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [key, epoch, symbol, category]);
  return { snap, loading };
}
