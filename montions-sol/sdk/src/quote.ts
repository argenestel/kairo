/**
 * Book-walk quotes (pure). Buying YES lifts asks (lowest first); buying NO hits bids (highest first) by writing
 * YES — the NO price is 1 − bid. Selling YES (from_held Ask) hits bids; selling NO (from_held Bid, "close NO")
 * lifts asks and receives 1 − ask. Fees follow SPEC §5: one ceil(base × fee_bps / 10_000) per order, base =
 * outcome premium (buys) or proceeds (sells); cash-backed takers reserve the fee on their full escrow up front.
 */
import { MAX_TICK, MIN_TICK, SIDE_ASK, SIDE_BID, TICKS, TICK_UNIT, TIF_IOC, UNIT } from './constants.js';
import { ceilDiv, parseUsdc } from './ticks.js';

export type OutcomeName = 'yes' | 'no';

export interface BookSideLevel {
  tick: number;
  qty: bigint;
}

/** Anything with YES bids (desc) and asks (asc); a decoded `MarketView` qualifies. */
export interface BookLike {
  bids: readonly BookSideLevel[];
  asks: readonly BookSideLevel[];
}

/** Order arguments for `place_order` (camelCase; the client converts to the IDL). */
export interface PlaceArgsInput {
  side: number;
  tick: number;
  qty: bigint;
  tif: number;
  fromHeld: boolean;
  maxFills: number;
  minFilled: bigint;
}

export interface Fill {
  /** Outcome tick paid / received per contract. */
  outcomeTick: number;
  /** YES tick of the resting level. */
  tick: number;
  qty: bigint;
}

/** Levels available to a buyer of `outcome`, cheapest first, as outcome ticks. */
export function buyLevels(book: BookLike, outcome: OutcomeName): Fill[] {
  if (outcome === 'yes') {
    return [...book.asks]
      .filter((l) => l.qty > 0n)
      .sort((a, b) => a.tick - b.tick)
      .map((l) => ({ outcomeTick: l.tick, tick: l.tick, qty: l.qty }));
  }
  return [...book.bids]
    .filter((l) => l.qty > 0n)
    .sort((a, b) => b.tick - a.tick)
    .map((l) => ({ outcomeTick: TICKS - l.tick, tick: l.tick, qty: l.qty }));
}

/** Levels available to a seller of held `outcome`, best (highest outcome price) first. */
export function sellLevels(book: BookLike, outcome: OutcomeName): Fill[] {
  if (outcome === 'yes') {
    return [...book.bids]
      .filter((l) => l.qty > 0n)
      .sort((a, b) => b.tick - a.tick)
      .map((l) => ({ outcomeTick: l.tick, tick: l.tick, qty: l.qty }));
  }
  return [...book.asks]
    .filter((l) => l.qty > 0n)
    .sort((a, b) => a.tick - b.tick)
    .map((l) => ({ outcomeTick: TICKS - l.tick, tick: l.tick, qty: l.qty }));
}

export const feeOf = (base: bigint, feeBps: number): bigint =>
  feeBps <= 0 ? 0n : ceilDiv(base * BigInt(feeBps), 10_000n);

/** Collateral `place_order` pulls for a cash-backed buy of `qty` at outcome limit `limitTick` (incl. fee reserve). */
export function buyEscrow(qty: bigint, limitTick: number, feeBps: number): bigint {
  const base = qty * BigInt(limitTick) * TICK_UNIT;
  return base + feeOf(base, feeBps);
}

/** Largest qty with buyEscrow(qty, tick) <= budget. */
function maxQtyForEscrow(budget: bigint, tick: number, feeBps: number): bigint {
  const per = BigInt(tick) * TICK_UNIT;
  let q = (budget * 10_000n) / (per * BigInt(10_000 + Math.max(0, feeBps)));
  while (q > 0n && buyEscrow(q, tick, feeBps) > budget) q -= 1n;
  while (buyEscrow(q + 1n, tick, feeBps) <= budget) q += 1n;
  return q;
}

export interface QuoteBuyOptions {
  /** Taker fee (config.fee_bps). Default 0. */
  feeBps?: number;
  /** Worst acceptable OUTCOME price tick (limit). Default 99. */
  maxTick?: number;
  /** Ticks added to the walked worst tick for the order limit (capped by maxTick). Default 0. */
  slippageTicks?: number;
  /** Cap on contracts. */
  maxContracts?: bigint;
  /**
   * Default true: size the order so the full escrow at the limit tick (incl. fee reserve) fits the budget —
   * the user can never lose more than the budget even if the book moves before the transaction lands.
   * false: spend the budget on the walked cost (escrow may exceed it when several levels are crossed).
   */
  strict?: boolean;
  /** `max_fills` for the order (0 → program default 32). */
  maxFills?: number;
  /** min_filled as a fraction of the quoted contracts (default: 1 contract). */
  minFillRatio?: number;
}

export interface BuyQuote {
  outcome: OutcomeName;
  /** SIDE_BID (buy YES) or SIDE_ASK (write YES = buy NO). */
  side: number;
  contracts: bigint;
  /** Walked premium excluding the fee (base units). */
  premium: bigint;
  fee: bigint;
  /** premium + fee: what the trade costs if the book is unchanged. */
  cost: bigint;
  /** Collateral pulled up front (refund of the unused part happens in the same instruction). */
  escrow: bigint;
  /** Average outcome price per contract in [0,1] (excl. fee). */
  avgPrice: number;
  /** Worst outcome tick reached by the walk (0 if nothing). */
  worstTick: number;
  /** Outcome-price limit of the order. */
  limitTick: number;
  /** YES tick for `PlaceArgs.tick` (YES buy: limit; NO buy: 100 − limit). */
  orderTick: number;
  /** contracts × $1 */
  payout: bigint;
  fills: Fill[];
  /** Contracts available at or below `maxTick`. */
  liquidity: bigint;
  /** Ready-to-send IOC order (qty 0 ⇒ nothing to buy). */
  args: PlaceArgsInput;
}

function toBudget(budget: number | bigint | string): bigint {
  return typeof budget === 'bigint' ? budget : parseUsdc(budget);
}

/**
 * Quote a buy of `outcome` with `budget` (number/string = USD, bigint = base units) against `book`.
 * Returns how many contracts the budget buys, the cost, and the IOC order that executes it.
 */
export function quoteBuy(
  book: BookLike,
  outcome: OutcomeName,
  budget: number | bigint | string,
  opts: QuoteBuyOptions = {},
): BuyQuote {
  const B = toBudget(budget);
  const feeBps = opts.feeBps ?? 0;
  const maxTick = Math.max(MIN_TICK, Math.min(MAX_TICK, Math.floor(opts.maxTick ?? MAX_TICK)));
  const slip = Math.max(0, Math.floor(opts.slippageTicks ?? 0));
  const strict = opts.strict ?? true;
  const levels = buyLevels(book, outcome).filter((l) => l.outcomeTick <= maxTick);
  const liquidity = levels.reduce((a, l) => a + l.qty, 0n);
  const limitFor = (worst: number) => Math.min(maxTick, worst + slip);

  // 1) choose the contract count
  let Q = 0n;
  if (strict) {
    let before = 0n;
    for (const l of levels) {
      const after = before + l.qty;
      const qb = maxQtyForEscrow(B, limitFor(l.outcomeTick), feeBps);
      if (qb <= before) break;
      Q = qb < after ? qb : after;
      before = after;
    }
  } else {
    let spent = 0n;
    for (const l of levels) {
      const per = BigInt(l.outcomeTick) * TICK_UNIT;
      let k = l.qty;
      const room = B - spent - feeOf(spent, feeBps);
      const kMax = room > 0n ? room / per : 0n;
      if (kMax < k) k = kMax;
      // fee ceil may push us over by one contract; back off
      while (k > 0n && spent + k * per + feeOf(spent + k * per, feeBps) > B) k -= 1n;
      if (k <= 0n) break;
      Q += k;
      spent += k * per;
      if (k < l.qty) break;
    }
  }
  if (opts.maxContracts !== undefined && Q > opts.maxContracts) Q = opts.maxContracts;

  // 2) walk Q
  const fills: Fill[] = [];
  let rem = Q;
  let premium = 0n;
  let worst = 0;
  for (const l of levels) {
    if (rem === 0n) break;
    const k = rem < l.qty ? rem : l.qty;
    fills.push({ outcomeTick: l.outcomeTick, tick: l.tick, qty: k });
    premium += k * BigInt(l.outcomeTick) * TICK_UNIT;
    worst = l.outcomeTick;
    rem -= k;
  }
  const fee = feeOf(premium, feeBps);
  const limitTick = Q > 0n ? limitFor(worst) : maxTick;
  const orderTick = outcome === 'yes' ? limitTick : TICKS - limitTick;
  const side = outcome === 'yes' ? SIDE_BID : SIDE_ASK;
  const ratio = opts.minFillRatio;
  let minFilled = Q > 0n ? 1n : 0n;
  if (ratio !== undefined && Q > 0n) {
    minFilled = BigInt(Math.max(1, Math.floor(Number(Q) * Math.min(1, Math.max(0, ratio)))));
  }
  return {
    outcome,
    side,
    contracts: Q,
    premium,
    fee,
    cost: premium + fee,
    escrow: Q > 0n ? buyEscrow(Q, limitTick, feeBps) : 0n,
    avgPrice: Q > 0n ? Number(premium) / Number(Q * UNIT) : 0,
    worstTick: worst,
    limitTick,
    orderTick,
    payout: Q * UNIT,
    fills,
    liquidity,
    args: { side, tick: orderTick, qty: Q, tif: TIF_IOC, fromHeld: false, maxFills: opts.maxFills ?? 0, minFilled },
  };
}

export interface QuoteSellOptions {
  feeBps?: number;
  /** Lowest acceptable OUTCOME price tick (limit). Default 1. */
  minTick?: number;
  /** Ticks subtracted from the walked worst tick for the order limit (floored at minTick). Default 0. */
  slippageTicks?: number;
  maxFills?: number;
  /** min_filled as a fraction of the fillable contracts (default: 1 contract). */
  minFillRatio?: number;
}

export interface SellQuote {
  outcome: OutcomeName;
  /** SIDE_ASK (sell YES) or SIDE_BID (close NO); always from_held. */
  side: number;
  /** Contracts that fill now (≤ requested). */
  contracts: bigint;
  requested: bigint;
  proceeds: bigint;
  fee: bigint;
  /** proceeds − fee */
  net: bigint;
  avgPrice: number;
  worstTick: number;
  limitTick: number;
  orderTick: number;
  fills: Fill[];
  args: PlaceArgsInput;
}

/** Quote selling `contracts` held `outcome` tokens into the book (IOC, from_held). */
export function quoteSell(
  book: BookLike,
  outcome: OutcomeName,
  contracts: bigint | number,
  opts: QuoteSellOptions = {},
): SellQuote {
  const want = BigInt(contracts);
  const feeBps = opts.feeBps ?? 0;
  const minTick = Math.max(MIN_TICK, Math.min(MAX_TICK, Math.ceil(opts.minTick ?? MIN_TICK)));
  const slip = Math.max(0, Math.floor(opts.slippageTicks ?? 0));
  const levels = sellLevels(book, outcome).filter((l) => l.outcomeTick >= minTick);
  const fills: Fill[] = [];
  let rem = want;
  let proceeds = 0n;
  let worst = 0;
  for (const l of levels) {
    if (rem === 0n) break;
    const k = rem < l.qty ? rem : l.qty;
    fills.push({ outcomeTick: l.outcomeTick, tick: l.tick, qty: k });
    proceeds += k * BigInt(l.outcomeTick) * TICK_UNIT;
    worst = l.outcomeTick;
    rem -= k;
  }
  const filled = want - rem;
  const fee = feeOf(proceeds, feeBps);
  const limitTick = filled > 0n ? Math.max(minTick, worst - slip) : minTick;
  const orderTick = outcome === 'yes' ? limitTick : TICKS - limitTick;
  const side = outcome === 'yes' ? SIDE_ASK : SIDE_BID;
  let minFilled = filled > 0n ? 1n : 0n;
  if (opts.minFillRatio !== undefined && filled > 0n) {
    minFilled = BigInt(Math.max(1, Math.floor(Number(filled) * Math.min(1, Math.max(0, opts.minFillRatio)))));
  }
  return {
    outcome,
    side,
    contracts: filled,
    requested: want,
    proceeds,
    fee,
    net: proceeds - fee,
    avgPrice: filled > 0n ? Number(proceeds) / Number(filled * UNIT) : 0,
    worstTick: worst,
    limitTick,
    orderTick,
    fills,
    // Sell the full requested size at the limit: anything that does not fill is refunded (IOC).
    args: { side, tick: orderTick, qty: want, tif: TIF_IOC, fromHeld: true, maxFills: opts.maxFills ?? 0, minFilled },
  };
}

/** Best bid / ask of a book in outcome terms: what you'd pay to buy / receive to sell one contract (ticks, 0 = none). */
export function outcomeTopOfBook(book: BookLike, outcome: OutcomeName): { buy: number; sell: number } {
  const b = buyLevels(book, outcome)[0];
  const s = sellLevels(book, outcome)[0];
  return { buy: b?.outcomeTick ?? 0, sell: s?.outcomeTick ?? 0 };
}

/** YES mid in [0,1] (null if either side is empty). */
export function midPrice(book: BookLike): number | null {
  const bid = [...book.bids].sort((a, b) => b.tick - a.tick)[0];
  const ask = [...book.asks].sort((a, b) => a.tick - b.tick)[0];
  if (!bid || !ask) return null;
  return (bid.tick + ask.tick) / (2 * TICKS);
}
