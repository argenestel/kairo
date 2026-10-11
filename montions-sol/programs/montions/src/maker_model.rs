//! Quote ladder for the protocol maker. OWNER: pricing agent. Pure; no account access.
//!
//! Port of the spirit of the EVM `MakerVault` ladder (docs/SPEC.md §6):
//! * centre `fair_tick = prob_to_tick(fair)`;
//! * half-spread `hs = max(params.min_half_spread, time_decay_width(tte))`, where
//!   `time_decay_width = ceil(4 · sqrt(600 s / tte))` clamped to `[1, 12]` (MakerVault's formula;
//!   with `min_half_spread = 2` this is exactly MakerVault's `max(2, ceil(4·sqrt(10min/tte)))`);
//! * `params.levels` (≤ 4) levels per side, `params.level_spacing` ticks apart:
//!   bid_i = fair_tick − hs − i·spacing, ask_i = fair_tick + hs + i·spacing, clamped to 1..=99,
//!   bids kept only if `< fair_tick`, asks only if `> fair_tick` (so every bid < every ask and
//!   no quote sits at or through fair), duplicates from clamping dropped;
//! * each level sized to ≈ `level_notional` of escrow: bid `level_notional / (tick · TICK_UNIT)`,
//!   ask `level_notional / ((100 − tick) · TICK_UNIT)`, at least 1, at most `MAX_ORDER_QTY`;
//! * inventory first: held YES backs asks (`from_held`, sell YES) and held NO backs bids
//!   (`from_held`, close NO), innermost level first, `min(remaining, level size)` per level —
//!   these need no cash;
//! * cash-backed quotes must fit `seat_cash + topup_available`: if they do not, every cash
//!   quantity is scaled by `budget / wanted` (floor), the leftover budget is handed back
//!   innermost-first, and quotes left at 0 are dropped.
//!
//! Volatility enters through `fair_wad` (N(d2) already embeds σ). The width deliberately does
//! not use `vol_bps` (like MakerVault): the one-sigma move of a digital's probability over a
//! horizon h is φ(d2)·√(h/T) — σ cancels at a given fair value — so time-to-expiry is the
//! right driver of the time-decay width.
//!
//! Output order is innermost-first, interleaved (bid0, ask0, bid1, ask1, …), so if the caller
//! has to skip quotes (POST_ONLY crossing, book capacity) the best levels go in first.
use crate::constants::{MAX_ORDER_QTY, MAX_TICK, MIN_TICK, SIDE_ASK, SIDE_BID, TICK_UNIT};
use crate::pricing::prob_to_tick;
use crate::state::MakerParams;

pub const MAX_LADDER: usize = 8;

/// Most levels per side (MAX_LADDER / 2).
pub const MAX_LEVELS: usize = MAX_LADDER / 2;
/// Time-decay horizon (MakerVault `MIN_QUOTE_LIFE`, 10 minutes).
pub const DECAY_HORIZON_SECS: u64 = 600;
/// Time-decay width multiplier (ticks): width = ceil(DECAY_TICKS · sqrt(horizon / tte)).
pub const DECAY_TICKS: u64 = 4;
/// Cap on the time-decay width (MakerVault clamps to 12).
pub const MAX_DECAY_WIDTH: u8 = 12;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LadderQuote {
    /// SIDE_BID / SIDE_ASK.
    pub side: u8,
    pub tick: u8,
    pub qty: u64,
    /// Ask backed by held YES / Bid backed by held NO (spec A3).
    pub from_held: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct LadderInput {
    /// Fair P(YES) in WAD.
    pub fair_wad: u128,
    pub tte_secs: i64,
    pub vol_bps: u32,
    /// Maker seat balances after its previous quotes were cancelled.
    pub seat_cash: u64,
    pub seat_yes: u64,
    pub seat_no: u64,
    /// Collateral the treasury can still add to this market (already capped by exposure budget).
    pub topup_available: u64,
    pub params: MakerParams,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Ladder {
    pub quotes: [LadderQuote; MAX_LADDER],
    pub len: usize,
    /// Fair tick used as the ladder centre.
    pub fair_tick: u8,
    /// Total cash escrow the quotes need (cash-backed orders only).
    pub cash_needed: u64,
}

impl Ladder {
    /// The emitted quotes.
    pub fn as_slice(&self) -> &[LadderQuote] {
        &self.quotes[..self.len]
    }
}

/// Cash escrow per contract of a cash-backed quote (bid: tick, write-ask: 100 − tick).
pub fn cash_per_contract(side: u8, tick: u8) -> u64 {
    if side == SIDE_BID {
        tick as u64 * TICK_UNIT
    } else {
        (100 - tick.min(100)) as u64 * TICK_UNIT
    }
}

/// `ceil(4 · sqrt(600 / tte))` ticks, clamped to `[1, 12]`; `tte <= 0` → 12.
/// Exact integer form: the smallest w >= 1 with w² · tte >= 16 · 600.
pub fn time_decay_width(tte_secs: i64) -> u8 {
    if tte_secs <= 0 {
        return MAX_DECAY_WIDTH;
    }
    let t = tte_secs as u128;
    let target = (DECAY_TICKS * DECAY_TICKS * DECAY_HORIZON_SECS) as u128;
    let mut w: u8 = 1;
    while w < MAX_DECAY_WIDTH && (w as u128) * (w as u128) * t < target {
        w += 1;
    }
    w
}

/// Half-spread in ticks: `max(min_half_spread, time_decay_width(tte))`, at least 1.
pub fn half_spread(params: &MakerParams, tte_secs: i64) -> u8 {
    params.min_half_spread.max(time_decay_width(tte_secs)).max(1)
}

/// Target size of a level: ≈ `level_notional` of cash escrow, in [1, MAX_ORDER_QTY]
/// (0 when `level_notional == 0`).
pub fn level_qty(level_notional: u64, side: u8, tick: u8) -> u64 {
    if level_notional == 0 {
        return 0;
    }
    let per = cash_per_contract(side, tick).max(1);
    (level_notional / per).clamp(1, MAX_ORDER_QTY)
}

/// Build a symmetric ladder around fair value (spec §9 adapted, see docs/SPEC.md §6).
pub fn build_ladder(input: &LadderInput) -> Ladder {
    let p = &input.params;
    let mut out = Ladder { fair_tick: prob_to_tick(input.fair_wad), ..Ladder::default() };
    let levels = (p.levels as usize).min(MAX_LEVELS);
    if levels == 0 || p.level_notional == 0 {
        return out;
    }
    let fair = out.fair_tick as i32;
    let spacing = p.level_spacing.max(1) as i32;
    let hs = half_spread(p, input.tte_secs) as i32;

    // 1. Ticks, innermost first, interleaved bid/ask.
    let mut rem_yes = input.seat_yes;
    let mut rem_no = input.seat_no;
    let (mut last_bid, mut last_ask) = (0i32, 0i32);
    let mut i = 0;
    while i < levels {
        let off = hs + i as i32 * spacing;
        let bid = (fair - off).max(MIN_TICK as i32);
        if bid < fair && bid != last_bid {
            last_bid = bid;
            push(&mut out, SIDE_BID, bid as u8, p.level_notional, &mut rem_no);
        }
        let ask = (fair + off).min(MAX_TICK as i32);
        if ask > fair && ask != last_ask {
            last_ask = ask;
            push(&mut out, SIDE_ASK, ask as u8, p.level_notional, &mut rem_yes);
        }
        i += 1;
    }

    // 2. Cash budget.
    let budget = input.seat_cash.saturating_add(input.topup_available) as u128;
    let mut wanted: u128 = 0;
    for q in out.as_slice() {
        if !q.from_held {
            wanted += q.qty as u128 * cash_per_contract(q.side, q.tick) as u128;
        }
    }
    if wanted > budget {
        // Proportional scale-down (floor ⇒ Σ <= budget), then hand the rounding leftover back
        // innermost-first up to each quote's original size.
        let mut used: u128 = 0;
        let mut orig = [0u64; MAX_LADDER];
        for (k, q) in out.quotes[..out.len].iter_mut().enumerate() {
            orig[k] = q.qty;
            if !q.from_held {
                q.qty = (q.qty as u128 * budget / wanted) as u64;
                used += q.qty as u128 * cash_per_contract(q.side, q.tick) as u128;
            }
        }
        let mut left = budget - used;
        for (k, q) in out.quotes[..out.len].iter_mut().enumerate() {
            if q.from_held {
                continue;
            }
            let per = cash_per_contract(q.side, q.tick) as u128;
            let add = ((orig[k] - q.qty) as u128).min(left / per);
            q.qty += add as u64;
            left -= add * per;
        }
        // Drop zero-size quotes, keeping order.
        let mut n = 0;
        for k in 0..out.len {
            if out.quotes[k].qty > 0 {
                out.quotes[n] = out.quotes[k];
                n += 1;
            }
        }
        for k in n..out.len {
            out.quotes[k] = LadderQuote::default();
        }
        out.len = n;
    }

    let mut cash: u128 = 0;
    for q in out.as_slice() {
        if !q.from_held {
            cash += q.qty as u128 * cash_per_contract(q.side, q.tick) as u128;
        }
    }
    out.cash_needed = cash as u64; // <= budget <= u64::MAX
    out
}

/// Append one level: from inventory if any is left on that side, else cash-backed.
fn push(out: &mut Ladder, side: u8, tick: u8, level_notional: u64, inventory: &mut u64) {
    if out.len >= MAX_LADDER {
        return;
    }
    let size = level_qty(level_notional, side, tick);
    if size == 0 {
        return;
    }
    let (qty, from_held) = if *inventory > 0 {
        let q = (*inventory).min(size);
        *inventory -= q;
        (q, true)
    } else {
        (size, false)
    };
    out.quotes[out.len] = LadderQuote { side, tick, qty, from_held };
    out.len += 1;
}
