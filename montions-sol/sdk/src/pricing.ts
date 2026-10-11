/**
 * TypeScript twin of `programs/montions/src/pricing.rs` + `maker_model.rs` (owner: pricing agent).
 *
 * - `normCdf` / `fairProbAbove*` use the SAME algorithm as the program (Hart 1968 / West 2005 rational
 *   approximation of N(x), N(d2) with zero rate and a 365-day year) in double precision. They agree with the
 *   program's fixed-point result to ~1e-15 (both are checked against the same 110-digit golden tables in
 *   `programs/montions/tests/pricing_data`).
 * - `probToTickWad` and `buildLadder` are exact integer (bigint) mirrors of the Rust code: for the same inputs
 *   they produce byte-identical ladders (pinned by `ladder_vectors.txt`, generated from Rust).
 *
 * Use these for UI previews / keeper decisions; the program is always authoritative.
 */

/** 1e18 fixed point (probabilities in WAD, as in the program). */
export const WAD = 10n ** 18n;

const YEAR_SECS = 31_536_000; // 365 days
const SIDE_BID_ = 0;
const SIDE_ASK_ = 1;
const TICK_UNIT_ = 10_000n;
const MAX_ORDER_QTY_ = 1_000_000_000n;
/** Max quotes in one ladder (4 levels per side). */
export const MAX_LADDER = 8;

// ───────────────────────────── normal CDF / fair value ─────────────────────────────

const HART_SPLIT = 7.07106781186547;
const SQRT_2PI = 2.5066282746310002;

/**
 * Standard normal CDF N(x) — Hart/West, |err| ≈ 1e-15. Saturates at |x| >= 9 exactly like the program
 * (N(-9) = 1.1e-19 rounds to 0 WAD). Exactly symmetric: normCdf(x) + normCdf(-x) === 1 up to float rounding.
 */
export function normCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x <= -9) return 0;
  if (x >= 9) return 1;
  const ax = Math.abs(x);
  const e = Math.exp(-0.5 * ax * ax);
  let q: number;
  if (ax < HART_SPLIT) {
    const n =
      ((((((0.0352624965998911 * ax + 0.700383064443688) * ax + 6.37396220353165) * ax + 33.912866078383) * ax +
        112.079291497871) *
        ax +
        221.213596169931) *
        ax +
        220.206867912376);
    const d =
      (((((((0.0883883476483184 * ax + 1.75566716318264) * ax + 16.064177579207) * ax + 86.7807322029461) * ax +
        296.564248779674) *
        ax +
        637.333633378831) *
        ax +
        793.826512519948) *
        ax +
        440.413735824752);
    q = (e * n) / d;
  } else {
    const b = ax + 1 / (ax + 2 / (ax + 3 / (ax + 4 / (ax + 0.65))));
    q = e / b / SQRT_2PI;
  }
  if (q > 0.5) q = 0.5;
  return x < 0 ? q : 1 - q;
}

/** d2 from ln(S/K) and total vol s = σ√T. */
function cdfOfD2(lnRatio: number, s: number): number {
  return normCdf(lnRatio / s - s / 2);
}

/** ln(S/K) with full relative precision near the money: 2·atanh((S−K)/(S+K)). */
function lnRatioFrom(diff: number, sum: number, ratio: number): number {
  const z = diff / sum;
  return Math.abs(z) < 0.5 ? 2 * Math.atanh(z) : Math.log(ratio);
}

/**
 * Model P(S_T >= K) = N(d2), d2 = (ln(S/K) − σ²T/2)/(σ√T), zero rate, 365-day year.
 * `spot`/`strike` in any common unit, `volAnnual` as a fraction (0.8 = 80%), `tteSecs` seconds to expiry.
 * Edge rules (same as the program): strike <= 0 → 1; spot <= 0 → 0; T <= 0 or σ <= 0 → 1 if spot >= strike else 0.
 */
export function fairProbAbove(spot: number, strike: number, volAnnual: number, tteSecs: number): number {
  if (!(strike > 0)) return 1;
  if (!(spot > 0)) return 0;
  if (!(tteSecs > 0) || !(volAnnual > 0)) return spot >= strike ? 1 : 0;
  const s = volAnnual * Math.sqrt(tteSecs / YEAR_SECS);
  if (spot === strike) return normCdf(-s / 2);
  return cdfOfD2(lnRatioFrom(spot - strike, spot + strike, spot / strike), s);
}

type IntLike = bigint | number | string | { toString(): string };
const big = (x: IntLike): bigint => (typeof x === 'bigint' ? x : BigInt(typeof x === 'number' ? Math.trunc(x) : x.toString()));

/**
 * Same as the program's `digital_prob_above_wad` inputs: prices in 1e-8 USD (u64), vol in bps (10_000 = 100%),
 * tte in seconds. Returns a probability in [0, 1]. Accepts bigint / number / BN.
 */
export function fairProbAboveE8(spotE8: IntLike, strikeE8: IntLike, volBps: number, tteSecs: IntLike): number {
  const S = big(spotE8);
  const K = big(strikeE8);
  const T = Number(big(tteSecs));
  if (K === 0n) return 1;
  if (S === 0n) return 0;
  if (!(T > 0) || !(volBps > 0)) return S >= K ? 1 : 0;
  const s = (volBps / 10_000) * Math.sqrt(T / YEAR_SECS);
  if (S === K) return normCdf(-s / 2);
  return cdfOfD2(lnRatioFrom(Number(S - K), Number(S + K), Number(S) / Number(K)), s);
}

/** `fairProbAboveE8` rounded to WAD (bigint), the unit `build_ladder` takes. */
export function fairProbAboveWad(spotE8: IntLike, strikeE8: IntLike, volBps: number, tteSecs: IntLike): bigint {
  return probToWad(fairProbAboveE8(spotE8, strikeE8, volBps, tteSecs));
}

/** Probability in [0, 1] → WAD bigint (clamped). */
export function probToWad(p: number): bigint {
  if (!(p > 0)) return 0n;
  if (p >= 1) return WAD;
  // Split to keep all 16 significant digits.
  const hi = Math.floor(p * 1e9);
  const lo = Math.round((p * 1e9 - hi) * 1e9);
  return BigInt(hi) * 1_000_000_000n + BigInt(lo);
}

/** Exact mirror of the program's `prob_to_tick`: round-half-up to cents, clamped 1..=99 (> WAD treated as WAD). */
export function probToTickWad(pWad: IntLike): number {
  let p = big(pWad);
  if (p < 0n) p = 0n;
  if (p > WAD) p = WAD;
  const t = Number((p * 100n + WAD / 2n) / WAD);
  return Math.min(99, Math.max(1, t));
}

/** Probability (float) → nearest tick in 1..=99, via `probToTickWad(probToWad(p))`. */
export function probToTick(p: number): number {
  return probToTickWad(probToWad(p));
}

// ───────────────────────────── maker ladder ─────────────────────────────

/** Subset of `MakerParams` the ladder uses (accepts the decoded config: numbers / bigint / BN). */
export interface LadderParams {
  levels: number;
  levelSpacing: number;
  minHalfSpread: number;
  levelNotional: IntLike;
}

export interface LadderInput {
  /** Fair P(YES) in WAD (use `fairProbAboveWad` / `probToWad`). */
  fairWad: IntLike;
  tteSecs: IntLike;
  /** Unused by the ladder itself (σ is already in fair); kept for parity with the program. */
  volBps?: number;
  seatCash: IntLike;
  seatYes: IntLike;
  seatNo: IntLike;
  topupAvailable: IntLike;
  params: LadderParams;
}

export interface LadderQuote {
  /** 0 = bid (buy YES / close NO), 1 = ask (write YES / sell YES). */
  side: number;
  tick: number;
  qty: bigint;
  /** Ask backed by held YES / bid backed by held NO. */
  fromHeld: boolean;
}

export interface Ladder {
  /** Innermost first, interleaved bid/ask (the order `refresh_quotes` posts them). */
  quotes: LadderQuote[];
  fairTick: number;
  /** Cash escrow of the cash-backed quotes. */
  cashNeeded: bigint;
}

/** Cash escrow per contract: bid `tick`, write-ask `100 − tick` (× TICK_UNIT). */
export function cashPerContract(side: number, tick: number): bigint {
  return BigInt(side === SIDE_BID_ ? tick : 100 - Math.min(tick, 100)) * TICK_UNIT_;
}

/** MakerVault time-decay width: ceil(4·sqrt(600/tte)) clamped to [1, 12]; tte <= 0 → 12. */
export function timeDecayWidth(tteSecs: IntLike): number {
  const t = big(tteSecs);
  if (t <= 0n) return 12;
  let w = 1;
  while (w < 12 && BigInt(w * w) * t < 9_600n) w++;
  return w;
}

/** Half-spread in ticks: max(minHalfSpread, timeDecayWidth(tte), 1). */
export function ladderHalfSpread(params: LadderParams, tteSecs: IntLike): number {
  return Math.max(params.minHalfSpread, timeDecayWidth(tteSecs), 1);
}

/** Target level size ≈ levelNotional of escrow, in [1, MAX_ORDER_QTY] (0 if levelNotional = 0). */
export function ladderLevelQty(levelNotional: IntLike, side: number, tick: number): bigint {
  const n = big(levelNotional);
  if (n === 0n) return 0n;
  let per = cashPerContract(side, tick);
  if (per === 0n) per = 1n;
  let q = n / per;
  if (q < 1n) q = 1n;
  if (q > MAX_ORDER_QTY_) q = MAX_ORDER_QTY_;
  return q;
}

const U64_MAX = (1n << 64n) - 1n;

/** Exact mirror of `maker_model::build_ladder` (see that file for the rules). */
export function buildLadder(input: LadderInput): Ladder {
  const p = input.params;
  const fairTick = probToTickWad(input.fairWad);
  const out: Ladder = { quotes: [], fairTick, cashNeeded: 0n };
  const levels = Math.min(Math.max(0, p.levels | 0), MAX_LADDER / 2);
  const notional = big(p.levelNotional);
  if (levels === 0 || notional === 0n) return out;
  const spacing = Math.max(1, p.levelSpacing | 0);
  const hs = ladderHalfSpread(p, input.tteSecs);

  let remYes = big(input.seatYes);
  let remNo = big(input.seatNo);
  const push = (side: number, tick: number) => {
    if (out.quotes.length >= MAX_LADDER) return;
    const size = ladderLevelQty(notional, side, tick);
    if (size === 0n) return;
    const inv = side === SIDE_BID_ ? remNo : remYes;
    if (inv > 0n) {
      const q = inv < size ? inv : size;
      if (side === SIDE_BID_) remNo -= q;
      else remYes -= q;
      out.quotes.push({ side, tick, qty: q, fromHeld: true });
    } else {
      out.quotes.push({ side, tick, qty: size, fromHeld: false });
    }
  };
  let lastBid = 0;
  let lastAsk = 0;
  for (let i = 0; i < levels; i++) {
    const off = hs + i * spacing;
    const bid = Math.max(fairTick - off, 1);
    if (bid < fairTick && bid !== lastBid) {
      lastBid = bid;
      push(SIDE_BID_, bid);
    }
    const ask = Math.min(fairTick + off, 99);
    if (ask > fairTick && ask !== lastAsk) {
      lastAsk = ask;
      push(SIDE_ASK_, ask);
    }
  }

  let budget = big(input.seatCash) + big(input.topupAvailable);
  if (budget > U64_MAX) budget = U64_MAX; // saturating_add
  const cost = (q: LadderQuote) => (q.fromHeld ? 0n : q.qty * cashPerContract(q.side, q.tick));
  const wanted = out.quotes.reduce((a, q) => a + cost(q), 0n);
  if (wanted > budget) {
    const orig = out.quotes.map((q) => q.qty);
    let used = 0n;
    for (const q of out.quotes) {
      if (q.fromHeld) continue;
      q.qty = (q.qty * budget) / wanted;
      used += cost(q);
    }
    let left = budget - used;
    out.quotes.forEach((q, k) => {
      if (q.fromHeld) return;
      const per = cashPerContract(q.side, q.tick);
      let add = orig[k] - q.qty;
      const fit = left / per;
      if (fit < add) add = fit;
      q.qty += add;
      left -= add * per;
    });
    out.quotes = out.quotes.filter((q) => q.qty > 0n);
  }
  out.cashNeeded = out.quotes.reduce((a, q) => a + cost(q), 0n);
  return out;
}
