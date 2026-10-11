import { useEffect, useMemo } from 'react';
import type { AssetInfo } from '../chains/types';
import { useChain } from '../state/chain';
import { Wheel } from '../components/Wheel';
import { AssetIcon } from '../components/AssetIcon';
import { LivePrice } from '../components/LivePrice';
import { PriceChart } from '../charts/PriceChart';
import type { StepProps } from './common';

export function AssetStep({ flow, dispatch, compact }: StepProps) {
  const { assets, prices, loading, demo } = useChain();
  const symbol = flow.draft.symbol;
  const items: AssetInfo[] = useMemo(() => [...assets].sort((a, b) => ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'].indexOf(a.symbol) - ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'].indexOf(b.symbol)).map((a) => ({ ...a, price: prices[a.symbol] ?? a.price })), [assets, prices]);
  const index = Math.max(0, items.findIndex((a) => a.symbol === symbol));

  useEffect(() => {
    if (!assets.length) return;
    if (!symbol || !assets.some((a) => a.symbol === symbol)) dispatch({ type: 'set', patch: { symbol: assets[0].symbol } });
  }, [assets, symbol, dispatch]);

  if (loading || !items.length) {
    return (
      <div className="asset-step">
        <div className="wheel-skeleton" aria-busy="true" aria-label="Loading markets">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={`skel-row${i === 2 ? ' is-mid' : ''}`} />)}
        </div>
        <p className="hint"><span className="dot dot--wait" /> Loading live prices…</p>
      </div>
    );
  }

  const spacing = compact ? 60 : 66;
  return (
    <div className="asset-step">
      <Wheel
        items={items}
        index={index}
        onChange={(i) => dispatch({ type: 'set', patch: { symbol: items[i].symbol } })}
        itemKey={(a) => a.symbol}
        itemLabel={(a) => `${a.name} ${a.symbol}`}
        spacing={spacing}
        angleStep={24}
        range={3}
        fade={0.28}
        height={compact ? 300 : 340}
        ariaLabel="Asset"
        searchable
        autoFocus
        className="wheel--assets"
        lens={<div className="lens lens--asset" />}
        renderItem={(a) => (
          <div className="asset-row">
            <AssetIcon symbol={a.symbol} size={compact ? 22 : 24} />
            <span className="asset-row__name">{a.name}</span>
            <span className="asset-row__sym">{a.symbol}</span>
            <LivePrice value={a.price} className="asset-row__price" />
            {a.marketClosed && <span className="asset-row__closed" title={a.oracleNote ?? 'Underlying market is closed'}>closed</span>}
          </div>
        )}
      />
      <p className="hint">
        <span className={`dot ${demo ? 'dot--demo' : 'dot--live'}`} />
        {demo ? 'Demo prices' : 'Live prices'} · scroll, drag or type a name
      </p>
      {/* ui-chart: live price */}
      {items[index] && (
        <PriceChart
          symbol={items[index].symbol}
          spot={items[index].price}
          vol={items[index].vol}
          category={items[index].category}
          compact={compact}
        />
      )}
    </div>
  );
}
