/**
 * Outcome-first planning (port of the EVM sdk's sentence.ts): "I think SYMBOL will be above/below STRIKE at
 * EXPIRY, I want a $PAYOFF payout" → an IOC order per candidate market. On Solana there is one market per
 * (asset, strike, expiry): above = buy YES, below = buy NO.
 */
import { MAX_TICK, MIN_TICK, TICKS, UNIT } from './constants.js';
import type { MarketView } from './decode.js';
import { buyLevels, buyEscrow, feeOf, type PlaceArgsInput } from './quote.js';
import { TIF_IOC } from './constants.js';

export type Direction = 'above' | 'below';

export interface SentenceInput {
  direction: Direction;
  /** 1e-8 USD */
  strike: bigint;
  expiryCandidates: readonly number[];
  /** Desired gross payout in USD (rounded up to whole contracts). */
  payoffUsd: number | string;
  /** Ticks of slippage allowed beyond the best available outcome price (or the model price when given). */
  maxSlippageTicks: number;
  feeBps?: number;
  /** Optional model probability of YES (0..1) used as the slippage reference. */
  fairProb?: number;
}

export interface SentencePlan {
  market: MarketView;
  direction: Direction;
  contracts: bigint;
  filled: bigint;
  shortfall: bigint;
  complete: boolean;
  premium: bigint;
  fee: bigint;
  cost: bigint;
  escrow: bigint;
  avgTick: number;
  worstTick: number;
  limitTick: number;
  args: PlaceArgsInput;
  impliedProb: number;
  modelProb: number | null;
  maxProfit: bigint;
}

export function payoffToContracts(payoffUsd: number | string): bigint {
  const n = typeof payoffUsd === 'number' ? payoffUsd : Number(String(payoffUsd).replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) throw new RangeError('payoffUsd must be > 0');
  return BigInt(Math.ceil(n - 1e-9));
}

/** Plan an IOC order for each open candidate market matching the sentence. */
export function planSentence(input: SentenceInput, markets: readonly MarketView[]): SentencePlan[] {
  const contracts = payoffToContracts(input.payoffUsd);
  const outcome = input.direction === 'above' ? 'yes' : 'no';
  const feeBps = input.feeBps ?? 0;
  const expiries = new Set(input.expiryCandidates);
  const plans: SentencePlan[] = [];
  for (const m of markets) {
    if (m.statusName !== 'open' || m.strike !== input.strike || !expiries.has(m.expiry)) continue;
    const levels = buyLevels(m, outcome);
    const fairOutcomeTick =
      input.fairProb !== undefined
        ? Math.round((outcome === 'yes' ? input.fairProb : 1 - input.fairProb) * TICKS)
        : undefined;
    const ref = fairOutcomeTick ?? levels[0]?.outcomeTick ?? MAX_TICK;
    const limit = Math.max(MIN_TICK, Math.min(MAX_TICK, ref + input.maxSlippageTicks));
    let rem = contracts;
    let premium = 0n;
    let weighted = 0n;
    let worst = 0;
    for (const l of levels) {
      if (rem === 0n || l.outcomeTick > limit) break;
      const k = rem < l.qty ? rem : l.qty;
      premium += k * BigInt(l.outcomeTick) * 10_000n;
      weighted += k * BigInt(l.outcomeTick);
      worst = l.outcomeTick;
      rem -= k;
    }
    const filled = contracts - rem;
    const fee = feeOf(premium, feeBps);
    const side = outcome === 'yes' ? 0 : 1;
    plans.push({
      market: m,
      direction: input.direction,
      contracts,
      filled,
      shortfall: rem,
      complete: rem === 0n,
      premium,
      fee,
      cost: premium + fee,
      escrow: buyEscrow(contracts, limit, feeBps),
      avgTick: filled > 0n ? Number((weighted + filled / 2n) / filled) : 0,
      worstTick: worst,
      limitTick: limit,
      args: {
        side,
        tick: outcome === 'yes' ? limit : TICKS - limit,
        qty: contracts,
        tif: TIF_IOC,
        fromHeld: false,
        maxFills: 0,
        minFilled: filled > 0n ? 1n : 0n,
      },
      impliedProb: filled > 0n ? Number(premium) / Number(filled * UNIT) : 0,
      modelProb: input.fairProb === undefined ? null : outcome === 'yes' ? input.fairProb : 1 - input.fairProb,
      maxProfit: filled * UNIT - premium - fee,
    });
  }
  return plans.sort((a, b) => (a.complete === b.complete ? (a.cost < b.cost ? -1 : 1) : a.complete ? -1 : 1));
}

/** One-line human sentence for a market, e.g. "SOL ≥ $110 at Oct 12 16:00 UTC". */
export function describeMarket(symbol: string, strikeUsd: string | number, expiry: number, direction: Direction = 'above'): string {
  const d = new Date(expiry * 1000);
  const when = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return `${symbol} ${direction === 'above' ? '≥' : '<'} $${strikeUsd} at ${when}`;
}
