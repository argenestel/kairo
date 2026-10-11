import type { Dispatch } from 'react';
import type { AssetInfo, Direction, ExpiryOption, Quote } from '../chains/types';
import type { FlowAction, FlowState } from '../state/flow';
import type { Loadable } from '../lib/hooks';
import { chanceFor, estimatePrice } from '../lib/model';

export interface StepProps {
  flow: FlowState;
  dispatch: Dispatch<FlowAction>;
  asset: AssetInfo | null;
  strikes: Loadable<number[]>;
  expiries: Loadable<ExpiryOption[]>;
  compact: boolean;
}

export interface Effective {
  contracts: number;
  cost: number;
  payout: number;
  price: number;
  chance: number;
  /** True while showing the local model estimate instead of an adapter quote. */
  estimated: boolean;
  tradable: boolean;
  reason?: string;
  needsMarket: boolean;
}

/** Adapter quote when we have one for these exact params, else an instant local estimate. */
export function effective(
  q: Quote | null, stale: boolean, asset: AssetInfo | null, direction: Direction,
  strike: number | null, expiry: number | null, budget: number,
): Effective | null {
  if (!asset || strike == null || expiry == null) return null;
  const chance = chanceFor(direction, asset.price, strike, asset.vol, expiry - Date.now() / 1000);
  if (q && !stale) {
    if (q.contracts > 0) {
      return {
        contracts: q.contracts, cost: q.cost, payout: q.payout, price: q.avgPrice, chance: q.chance,
        estimated: false, tradable: q.tradable, reason: q.reason, needsMarket: q.needsMarket,
      };
    }
    const price = q.avgPrice > 0 ? q.avgPrice : estimatePrice(q.chance);
    const contracts = Math.floor(budget / price);
    return {
      contracts, cost: contracts * price, payout: contracts, price, chance: q.chance,
      estimated: true, tradable: false, reason: q.reason ?? 'No liquidity at this strike yet', needsMarket: q.needsMarket,
    };
  }
  const price = estimatePrice(chance);
  const contracts = Math.floor(budget / price);
  return { contracts, cost: contracts * price, payout: contracts, price, chance, estimated: true, tradable: true, needsMarket: false };
}
