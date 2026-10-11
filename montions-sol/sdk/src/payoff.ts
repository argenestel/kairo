/**
 * Expiry payoff / P&L helpers (port of the EVM sdk's payoff.ts with 1e-8 strikes).
 * A market resolves YES iff settlement price >= strike. Void pays $0.50 per YES and per NO.
 */
import { UNIT } from './constants.js';
import { tickToUsdc } from './ticks.js';

export type PositionSide = 'YES' | 'NO' | 'yes' | 'no';

export interface PayoffPosition {
  side: PositionSide;
  quantity: bigint;
  /** Premium paid, base units. */
  cost?: bigint;
  /** Entry tick (used when cost is absent). */
  entryTick?: number;
}

export interface PositionSettlement {
  side: 'YES' | 'NO';
  quantity: bigint;
  won: boolean;
  payout: bigint;
  cost: bigint;
  pnl: bigint;
}

function norm(side: PositionSide): 'YES' | 'NO' {
  const s = side.toUpperCase();
  if (s !== 'YES' && s !== 'NO') throw new RangeError('position side must be YES or NO');
  return s;
}

function costOf(p: PayoffPosition): bigint {
  if (p.cost !== undefined) {
    if (p.cost < 0n) throw new RangeError('cost must be non-negative');
    return p.cost;
  }
  if (p.entryTick !== undefined) return tickToUsdc(p.entryTick, p.quantity);
  return 0n;
}

export function positionWins(side: PositionSide, yesOutcome: boolean): boolean {
  return norm(side) === (yesOutcome ? 'YES' : 'NO');
}

export function settlePosition(p: PayoffPosition, yesOutcome: boolean): PositionSettlement {
  if (p.quantity < 0n) throw new RangeError('quantity must be non-negative');
  const side = norm(p.side);
  const cost = costOf(p);
  const won = positionWins(side, yesOutcome);
  const payout = won ? p.quantity * UNIT : 0n;
  return { side, quantity: p.quantity, won, payout, cost, pnl: payout - cost };
}

/** Payout of a voided market: UNIT/2 per contract of either side. */
export function voidPayout(quantity: bigint): bigint {
  return (quantity * UNIT) / 2n;
}

/** Program's redeem payout (SPEC §5): Resolved → winning qty × UNIT; Void → (yes + no) × UNIT / 2. */
export function redeemPayout(status: 'resolved' | 'void', outcomeYes: boolean, yesQty: bigint, noQty: bigint): bigint {
  if (status === 'void') return ((yesQty + noQty) * UNIT) / 2n;
  return (outcomeYes ? yesQty : noQty) * UNIT;
}

export const payoffAtExpiry = (p: PayoffPosition, yesOutcome: boolean) => settlePosition(p, yesOutcome).payout;
export const pnlAtExpiry = (p: PayoffPosition, yesOutcome: boolean) => settlePosition(p, yesOutcome).pnl;

/** YES iff price >= strike (both 1e-8). */
export const resolvesYes = (priceE8: bigint, strikeE8: bigint) => priceE8 >= strikeE8;

export interface PayoffCurveInput extends PayoffPosition {
  /** Strike, 1e-8 USD. */
  strikeE8: bigint;
  lowerE8?: bigint;
  upperE8?: bigint;
}

export interface PayoffCurvePoint {
  /** Underlying price, 1e-8 USD. */
  x: bigint;
  /** Net P&L, base units. */
  y: bigint;
  payout: bigint;
  yes: boolean;
}

/** Stepped P&L curve [lower, strike−1, strike, upper] (YES wins at equality). */
export function steppedPayoffCurve(input: PayoffCurveInput): PayoffCurvePoint[] {
  const lower = input.lowerE8 ?? 0n;
  const upper = input.upperE8 ?? input.strikeE8 * 2n;
  if (upper < lower || input.strikeE8 < lower || input.strikeE8 > upper) throw new RangeError('invalid curve bounds');
  const xs = [lower, input.strikeE8 > lower ? input.strikeE8 - 1n : lower, input.strikeE8, upper];
  const out: PayoffCurvePoint[] = [];
  for (const x of xs) {
    if (out.length && out[out.length - 1]!.x === x) continue;
    const yes = x >= input.strikeE8;
    const s = settlePosition(input, yes);
    out.push({ x, y: s.pnl, payout: s.payout, yes });
  }
  return out;
}
