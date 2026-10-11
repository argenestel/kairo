/**
 * Fair value + protocol-maker ladder estimates, built on the exact TS twin of pricing.rs / maker_model.rs
 * (`pricing.ts`, pricing agent). Used to quote a market before it exists (the buy transaction creates it and
 * runs `refresh_quotes` first) and by the keeper to decide when quotes are stale. The program is authoritative.
 */
import { SIDE_BID } from './constants.js';
import type { MakerParamsView } from './decode.js';
import { buildLadder, fairProbAbove, fairProbAboveWad, probToTick, probToWad, type LadderQuote } from './pricing.js';

/** P(S_T >= K) = N(d2) (zero rate, 365-day year) — float USD inputs. Same algorithm as the program. */
export function modelProbAbove(spot: number, strike: number, vol: number, tteSecs: number): number {
  return fairProbAbove(spot, strike, vol, tteSecs);
}

/** Probability → nearest tick 1..=99 (the program's `prob_to_tick`). */
export function modelProbToTick(p: number): number {
  return probToTick(p);
}

/** Fair tick exactly as `refresh_quotes` computes it from (spot e8, strike e8, vol bps, tte). */
export function fairTickE8(spotE8: bigint, strikeE8: bigint, volBps: number, tteSecs: number): number {
  return probToTick(Number(fairProbAboveWad(spotE8, strikeE8, volBps, tteSecs)) / 1e18);
}

export type EstimatedQuote = LadderQuote;

export interface EstimateLadderInput {
  /** Fair P(YES) in [0,1]; or pass `fairWad` for bit-exactness with the program. */
  fair: number;
  fairWad?: bigint;
  tteSecs: number;
  params: MakerParamsView;
  /** Collateral the maker can put in this market: min(treasury, max_market_exposure − seat). Default: exposure cap. */
  cashAvailable?: bigint;
  /** Maker seat balances after its previous quotes are cancelled (default 0 — a fresh market). */
  seatCash?: bigint;
  seatYes?: bigint;
  seatNo?: bigint;
}

/**
 * The ladder `refresh_quotes` posts (maker_model::build_ladder mirror). Empty when the maker is disabled or the
 * market is inside `min_tte`. Quotes that would cross other resting orders are skipped by the program — not here.
 */
export function estimateMakerLadder(input: EstimateLadderInput): { fairTick: number; quotes: EstimatedQuote[]; cashNeeded: bigint } {
  const p = input.params;
  const fairWad = input.fairWad ?? probToWad(input.fair);
  if (!p.enabled || input.tteSecs < p.minTte) {
    return { fairTick: probToTick(Number(fairWad) / 1e18), quotes: [], cashNeeded: 0n };
  }
  const lad = buildLadder({
    fairWad,
    tteSecs: input.tteSecs,
    seatCash: input.seatCash ?? 0n,
    seatYes: input.seatYes ?? 0n,
    seatNo: input.seatNo ?? 0n,
    topupAvailable: input.cashAvailable ?? p.maxMarketExposure,
    params: { levels: p.levels, levelSpacing: p.levelSpacing, minHalfSpread: p.minHalfSpread, levelNotional: p.levelNotional },
  });
  return { fairTick: lad.fairTick, quotes: lad.quotes, cashNeeded: lad.cashNeeded };
}

/** Aggregate quotes into a book (bids desc, asks asc). */
export function ladderToBook(quotes: readonly EstimatedQuote[]): { bids: { tick: number; qty: bigint }[]; asks: { tick: number; qty: bigint }[] } {
  const bids = new Map<number, bigint>();
  const asks = new Map<number, bigint>();
  for (const q of quotes) {
    const m = q.side === SIDE_BID ? bids : asks;
    m.set(q.tick, (m.get(q.tick) ?? 0n) + q.qty);
  }
  return {
    bids: [...bids.entries()].map(([tick, qty]) => ({ tick, qty })).sort((a, b) => b.tick - a.tick),
    asks: [...asks.entries()].map(([tick, qty]) => ({ tick, qty })).sort((a, b) => a.tick - b.tick),
  };
}
