//! Matching engine and market accounting. OWNER: engine agent.
//! Pure state transitions on `Market` — no CPIs, no account access, no clock reads.
//! The instruction layer moves tokens according to the returned amounts (see docs/SPEC.md §5).
//!
//! Implementation notes
//! - **Atomicity.** Every public mutating method is two-phase. Phase 1 is read-only and validates
//!   everything that can fail: status, expiry, arguments, seat balances, POST_ONLY crossing, a dry
//!   run of the matching walk (fills, STP cancels, `max_fills`, still-crossing), `min_filled`,
//!   seat / order-slot capacity for a resting remainder and every aggregate that could overflow.
//!   Phase 2 mutates; its checked arithmetic cannot fail while `check_invariants()` holds. An `Err`
//!   therefore leaves the `Market` byte-for-byte unchanged (the protocol maker relies on this to
//!   skip quotes).
//! - **SBF.** `Market` is never copied (5 KB); only 32-byte `Order` / 88-byte `Seat` copies. No heap.
//!   Every loop is bounded by `MAX_ORDERS`, `LEVELS`, `MAX_SEATS` or `TRADE_RING`.
//! - **Bitmaps.** `[lo, hi]` with bit `t` ⇔ level `t` non-empty; best ask = lowest set bit
//!   (`trailing_zeros`), best bid = highest set bit (`leading_zeros`).
//! - **Fee reserve.** A POST_ONLY order can never take, so its fee reserve is 0
//!   (`required_escrow` adds the reserve only for GTC / IOC cash-backed orders).
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MontionsError;
use crate::state::*;

/// One YES + one NO, in ticks.
const TICKS: u64 = 100;
const BPS_DENOM: u128 = 10_000;
/// Valid tick bits in `bits[0]` (ticks 1..=63) and `bits[1]` (ticks 64..=99).
const VALID_LO: u64 = !1u64;
const VALID_HI: u64 = (1u64 << (MAX_TICK as u32 + 1 - 64)) - 1;

// ───────────────────────────── arithmetic helpers ─────────────────────────────

#[inline(never)]
fn ovf() -> Error {
    error!(MontionsError::MathOverflow)
}

#[inline]
fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(ovf)
}

#[inline]
fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(ovf)
}

/// `qty * ticks * TICK_UNIT` (collateral value of `qty` contracts at `ticks` cents).
#[inline]
fn tick_value(qty: u64, ticks: u64) -> Result<u64> {
    let v = (qty as u128) * (ticks as u128) * (TICK_UNIT as u128);
    u64::try_from(v).map_err(|_| ovf())
}

/// `qty * UNIT`.
#[inline]
fn units(qty: u64) -> Result<u64> {
    qty.checked_mul(UNIT).ok_or_else(ovf)
}

/// `ceil(base * fee_bps / 10_000)`.
#[inline]
fn fee_ceil(base: u64, fee_bps: u16) -> Result<u64> {
    if base == 0 || fee_bps == 0 {
        return Ok(0);
    }
    let v = ((base as u128) * (fee_bps as u128)).div_ceil(BPS_DENOM);
    u64::try_from(v).map_err(|_| ovf())
}

/// Collateral escrowed by a cash-backed order: Bid `qty*tick*TU`, write Ask `qty*(100-tick)*TU`.
#[inline]
fn cash_escrow(side: u8, tick: u8, qty: u64) -> Result<u64> {
    let per = if side == SIDE_BID { tick as u64 } else { TICKS.checked_sub(tick as u64).ok_or_else(ovf)? };
    tick_value(qty, per)
}

// ───────────────────────────── bitmap helpers ─────────────────────────────

#[inline]
fn bit_set(bits: &mut [u64; 2], tick: u8) {
    bits[(tick >> 6) as usize & 1] |= 1u64 << (tick & 63);
}

#[inline]
fn bit_clear(bits: &mut [u64; 2], tick: u8) {
    bits[(tick >> 6) as usize & 1] &= !(1u64 << (tick & 63));
}

#[inline]
fn bit_get(bits: &[u64; 2], tick: usize) -> bool {
    (bits[(tick >> 6) & 1] >> (tick & 63)) & 1 == 1
}

/// Lowest occupied valid tick.
#[inline]
fn lowest_tick(bits: &[u64; 2]) -> Option<u8> {
    let lo = bits[0] & VALID_LO;
    if lo != 0 {
        return Some(lo.trailing_zeros() as u8);
    }
    let hi = bits[1] & VALID_HI;
    if hi != 0 {
        return Some(64 + hi.trailing_zeros() as u8);
    }
    None
}

/// Highest occupied valid tick.
#[inline]
fn highest_tick(bits: &[u64; 2]) -> Option<u8> {
    let hi = bits[1] & VALID_HI;
    if hi != 0 {
        return Some(127 - hi.leading_zeros() as u8);
    }
    let lo = bits[0] & VALID_LO;
    if lo != 0 {
        return Some(63 - lo.leading_zeros() as u8);
    }
    None
}

/// Best resting tick on the side opposite to a taker of `taker_side` that crosses `limit`:
/// a Bid taker lifts Asks with tick <= limit (lowest first); an Ask taker hits Bids with
/// tick >= limit (highest first).
#[inline]
fn best_crossing(bits: &[u64; 2], taker_side: u8, limit: u8) -> Option<u8> {
    if taker_side == SIDE_BID {
        lowest_tick(bits).filter(|&t| t <= limit)
    } else {
        highest_tick(bits).filter(|&t| t >= limit)
    }
}

// ───────────────────────────── fill economics ─────────────────────────────

/// Effects of one fill of `f` contracts at the resting order's tick (spec §5, cases 1–4).
/// Taker amounts are credits to the taker's outputs (before fee); maker amounts apply to the
/// resting order's seat (`*_locked` are debits of consumed escrow).
#[derive(Clone, Copy, Default)]
struct Econ {
    /// Cash-backed taker: price-improvement refund. Held taker: sale proceeds.
    taker_cash: u64,
    taker_yes: u64,
    taker_no: u64,
    maker_cash: u64,
    maker_yes: u64,
    maker_no: u64,
    maker_locked: u64,
    maker_yes_locked: u64,
    maker_no_locked: u64,
    /// Pairs minted (case 1) / burned (case 4).
    minted: u64,
    burned: u64,
    /// Taker collateral consumed (spec A4) — the fee base.
    fee_base: u64,
}

fn fill_econ(taker_side: u8, limit: u8, taker_held: bool, maker_held: bool, p: u8, f: u64) -> Result<Econ> {
    let p = p as u64;
    let l = limit as u64;
    let q = TICKS.checked_sub(p).ok_or_else(ovf)?; // NO price
    let mut e = Econ::default();
    if taker_side == SIDE_BID {
        // Resting Ask at p <= limit.
        if taker_held {
            // Close NO: sell f NO at 100 - p.
            let proceeds = tick_value(f, q)?;
            e.taker_cash = proceeds;
            e.fee_base = proceeds;
            if maker_held {
                // Case 4: burn f pairs; A (maker) gets p, B (taker) gets 100 - p.
                e.maker_yes_locked = f;
                e.maker_cash = tick_value(f, p)?;
                e.burned = f;
            } else {
                // Case 3: NO moves taker → maker; taker paid from the writer's escrow.
                e.maker_locked = proceeds;
                e.maker_no = f;
            }
        } else {
            // Buy YES at p; refund (L - p).
            e.taker_cash = tick_value(f, l.checked_sub(p).ok_or_else(ovf)?)?;
            e.taker_yes = f;
            e.fee_base = tick_value(f, p)?;
            if maker_held {
                // Case 2: YES moves maker → taker; maker receives p.
                e.maker_yes_locked = f;
                e.maker_cash = e.fee_base;
            } else {
                // Case 1: mint f pairs; YES → taker, NO → maker.
                e.maker_locked = tick_value(f, q)?;
                e.maker_no = f;
                e.minted = f;
            }
        }
    } else {
        // Resting Bid at p >= limit.
        if taker_held {
            // Sell f YES at p.
            let proceeds = tick_value(f, p)?;
            e.taker_cash = proceeds;
            e.fee_base = proceeds;
            if maker_held {
                // Case 4: burn f pairs; A (taker) gets p, B (maker) gets 100 - p.
                e.maker_no_locked = f;
                e.maker_cash = tick_value(f, q)?;
                e.burned = f;
            } else {
                // Case 2: YES moves taker → maker; taker paid from the bid's escrow.
                e.maker_locked = proceeds;
                e.maker_yes = f;
            }
        } else {
            // Write YES (buy NO at 100 - p); refund (p - L).
            e.taker_cash = tick_value(f, p.checked_sub(l).ok_or_else(ovf)?)?;
            e.taker_no = f;
            e.fee_base = tick_value(f, q)?;
            if maker_held {
                // Case 3: NO moves maker → taker; maker receives 100 - p from the taker's escrow.
                e.maker_no_locked = f;
                e.maker_cash = e.fee_base;
            } else {
                // Case 1: mint f pairs; YES → maker, NO → taker.
                e.maker_locked = tick_value(f, p)?;
                e.maker_yes = f;
                e.minted = f;
            }
        }
    }
    Ok(e)
}

/// Dry run of the matching walk (phase 1 of a placement).
#[derive(Clone, Copy, Default)]
struct Sim {
    /// Resting orders matched or STP-cancelled.
    attempts: u32,
    filled: u64,
    remaining: u64,
    /// After the walk a crossing resting order is still on the book.
    still_crossing: bool,
    fee_base: u64,
    minted: u64,
    burned: u64,
    taker_cash: u64,
    taker_yes: u64,
    taker_no: u64,
    /// Upper bounds of what lands in any seat's cash/locked (`seat_cash`) or token (`seat_tok`)
    /// fields during the walk (maker credits + STP refunds) — used for overflow pre-checks.
    seat_cash: u64,
    seat_tok: u64,
}

// ───────────────────────────── Market ─────────────────────────────

impl Market {
    /// Initialise book structures of a freshly zeroed market: empty levels (head = tail = NIL),
    /// free list over all order slots, `next_order_id = 1`, `status = STATUS_OPEN`.
    /// Header identity fields (asset, strike, mints, …) are written by the instruction.
    pub fn init_book(&mut self) {
        self.settle_price = 0;
        self.settle_publish_time = 0;
        self.pool = 0;
        self.yes_total = 0;
        self.no_total = 0;
        self.fees = 0;
        self.volume = 0;
        self.next_order_id = 1;
        self.bid_bits = [0; 2];
        self.ask_bits = [0; 2];
        self.status = STATUS_OPEN;
        self.outcome = 0;
        self.last_trade_tick = 0;
        self.trade_head = 0;
        self.trade_count = 0;
        for i in 0..LEVELS {
            self.bid_levels[i] = Level { head: NIL, tail: NIL };
            self.ask_levels[i] = Level { head: NIL, tail: NIL };
        }
        for i in 0..MAX_ORDERS {
            let next = if i + 1 < MAX_ORDERS { (i + 1) as u8 } else { NIL };
            self.orders[i] = free_order(next);
        }
        self.free_head = 0;
        for i in 0..MAX_SEATS {
            self.seats[i] = Seat::default();
        }
        for i in 0..TRADE_RING {
            self.trades[i] = Trade::default();
        }
    }

    /// Collateral / tokens the taker must hand over before `place_taker` (incl. max fee reserve).
    pub fn required_escrow(args: &PlaceArgs, fee_bps: u16) -> Result<Escrow> {
        require!(args.side == SIDE_BID || args.side == SIDE_ASK, MontionsError::BadArgs);
        require!(args.tif <= TIF_POST_ONLY, MontionsError::BadArgs);
        require!((MIN_TICK..=MAX_TICK).contains(&args.tick), MontionsError::BadTick);
        require!((1..=MAX_ORDER_QTY).contains(&args.qty), MontionsError::BadQty);
        require!(fee_bps <= MAX_FEE_BPS, MontionsError::FeeTooHigh);
        if args.from_held {
            return Ok(if args.side == SIDE_BID {
                Escrow { cash: 0, yes: 0, no: args.qty }
            } else {
                Escrow { cash: 0, yes: args.qty, no: 0 }
            });
        }
        let escrow = cash_escrow(args.side, args.tick, args.qty)?;
        let reserve = if args.tif == TIF_POST_ONLY { 0 } else { fee_ceil(escrow, fee_bps)? };
        Ok(Escrow { cash: add(escrow, reserve)?, yes: 0, no: 0 })
    }

    /// Match a taker order whose `required_escrow` has already been moved into the market's custody
    /// (collateral into the vault; held YES/NO burned from the wallet). Any resting remainder is
    /// escrowed in the owner's seat (allocated on demand). Returns what to push back to the wallet.
    pub fn place_taker(&mut self, owner: &Pubkey, args: &PlaceArgs, fee_bps: u16, now: i64) -> Result<PlaceResult> {
        self.place_inner(Some(owner), None, args, fee_bps, now)
    }

    /// Place an order funded from a seat's free balances (used by the protocol maker). Fills and
    /// refunds stay in the seat; `cash_out/yes_out/no_out` are always 0.
    pub fn place_from_seat(&mut self, seat: usize, args: &PlaceArgs, fee_bps: u16, now: i64) -> Result<PlaceResult> {
        self.place_inner(None, Some(seat), args, fee_bps, now)
    }

    /// Cancel one order of `owner`; its escrow returns to the seat's free balances. Allowed any time.
    /// Returns the cancelled (remaining) quantity.
    pub fn cancel_order(&mut self, owner: &Pubkey, order_id: u64) -> Result<u64> {
        require!(order_id != 0, MontionsError::OrderNotOpen);
        let mut idx = MAX_ORDERS;
        for i in 0..MAX_ORDERS {
            if self.orders[i].id == order_id {
                idx = i;
                break;
            }
        }
        require!(idx < MAX_ORDERS, MontionsError::OrderNotOpen);
        let seat = self.orders[idx].seat as usize;
        require!(seat < MAX_SEATS, MontionsError::InvariantViolated);
        require!(self.seats[seat].owner == *owner, MontionsError::NotOrderOwner);
        // `cancel_resting` computes the new seat before writing anything.
        self.cancel_resting(idx)
    }

    /// Cancel every resting order of a seat. Returns how many were cancelled.
    pub fn cancel_all(&mut self, seat: usize) -> Result<u32> {
        require!(seat < MAX_SEATS, MontionsError::BadArgs);
        // Phase 1: the seat must cover every refund (true while invariants hold).
        let (mut cash, mut tok_yes, mut tok_no, mut n) = (0u64, 0u64, 0u64, 0u32);
        for i in 0..MAX_ORDERS {
            let o = &self.orders[i];
            if o.id == 0 || o.seat as usize != seat {
                continue;
            }
            n += 1;
            if o.from_held == 0 {
                cash = add(cash, cash_escrow(o.side, o.tick, o.qty)?)?;
            } else if o.side == SIDE_BID {
                tok_no = add(tok_no, o.qty)?;
            } else {
                tok_yes = add(tok_yes, o.qty)?;
            }
        }
        if n == 0 {
            return Ok(0);
        }
        let s = &self.seats[seat];
        require!(
            s.locked >= cash && s.yes_locked >= tok_yes && s.no_locked >= tok_no && s.open_orders >= n,
            MontionsError::InvariantViolated
        );
        add(s.cash, cash)?;
        add(s.yes, tok_yes)?;
        add(s.no, tok_no)?;
        // Phase 2.
        for i in 0..MAX_ORDERS {
            if self.orders[i].id != 0 && self.orders[i].seat as usize == seat {
                self.cancel_resting(i)?;
            }
        }
        Ok(n)
    }

    pub fn find_seat(&self, owner: &Pubkey) -> Option<usize> {
        if *owner == Pubkey::default() {
            return None;
        }
        (0..MAX_SEATS).find(|&i| self.seats[i].owner == *owner)
    }

    pub fn seat_or_alloc(&mut self, owner: &Pubkey) -> Result<usize> {
        require!(*owner != Pubkey::default(), MontionsError::BadArgs);
        if let Some(i) = self.find_seat(owner) {
            return Ok(i);
        }
        let i = self.free_seat().ok_or_else(|| error!(MontionsError::SeatsFull))?;
        self.seats[i] = Seat { owner: *owner, ..Seat::default() };
        Ok(i)
    }

    /// Zero the seat's free balances and return `(cash, yes, no)` for the instruction to pay out.
    /// Frees the seat if nothing remains (no locked balances, no open orders).
    pub fn take_seat_free(&mut self, seat: usize) -> (u64, u64, u64) {
        if seat >= MAX_SEATS || self.seats[seat].owner == Pubkey::default() {
            return (0, 0, 0);
        }
        let s = &mut self.seats[seat];
        let out = (s.cash, s.yes, s.no);
        s.cash = 0;
        s.yes = 0;
        s.no = 0;
        if s.locked == 0 && s.yes_locked == 0 && s.no_locked == 0 && s.open_orders == 0 {
            *s = Seat::default();
        }
        out
    }

    /// Credit collateral that the instruction has just moved into the vault to a seat's free cash.
    pub fn credit_seat_cash(&mut self, seat: usize, amount: u64) -> Result<()> {
        require!(seat < MAX_SEATS && self.seats[seat].owner != Pubkey::default(), MontionsError::BadArgs);
        let cash = add(self.seats[seat].cash, amount)?;
        self.seats[seat].cash = cash;
        Ok(())
    }

    /// Mint `qty` pairs against `qty * UNIT` collateral already moved into the vault.
    /// Open and `now < expiry` only. Returns collateral required.
    pub fn split(&mut self, qty: u64, now: i64) -> Result<u64> {
        require!(self.status == STATUS_OPEN, MontionsError::MarketNotOpen);
        require!(now < self.expiry, MontionsError::Expired);
        require!((1..=MAX_ORDER_QTY).contains(&qty), MontionsError::BadQty);
        let amount = units(qty)?;
        let pool = add(self.pool, amount)?;
        let yes_total = add(self.yes_total, qty)?;
        let no_total = add(self.no_total, qty)?;
        self.pool = pool;
        self.yes_total = yes_total;
        self.no_total = no_total;
        Ok(amount)
    }

    /// Burn `qty` pairs (already burned as SPL by the instruction); returns collateral to pay out.
    /// Allowed while Open (before or after expiry).
    pub fn merge(&mut self, qty: u64) -> Result<u64> {
        require!(self.status == STATUS_OPEN, MontionsError::MarketNotOpen);
        require!((1..=MAX_ORDER_QTY).contains(&qty), MontionsError::BadQty);
        require!(self.yes_total >= qty && self.no_total >= qty, MontionsError::InsufficientTokens);
        let amount = units(qty)?;
        let pool = sub(self.pool, amount)?;
        self.pool = pool;
        self.yes_total -= qty;
        self.no_total -= qty;
        Ok(amount)
    }

    /// Record the outcome. Open → Resolved.
    pub fn settle(&mut self, yes: bool, price: i64, publish_time: i64) -> Result<()> {
        require!(self.status == STATUS_OPEN, MontionsError::AlreadySettled);
        self.status = STATUS_RESOLVED;
        self.outcome = yes as u8;
        self.settle_price = price;
        self.settle_publish_time = publish_time;
        Ok(())
    }

    /// Open → Void (each YES and NO redeems for UNIT / 2).
    pub fn void(&mut self) -> Result<()> {
        require!(self.status == STATUS_OPEN, MontionsError::AlreadySettled);
        self.status = STATUS_VOID;
        Ok(())
    }

    /// Redeem SPL claims already burned by the instruction. Returns payout.
    pub fn redeem(&mut self, yes_qty: u64, no_qty: u64) -> Result<u64> {
        require!(self.status == STATUS_RESOLVED || self.status == STATUS_VOID, MontionsError::NotSettled);
        require!(yes_qty != 0 || no_qty != 0, MontionsError::BadQty);
        require!(yes_qty <= self.yes_total && no_qty <= self.no_total, MontionsError::InsufficientTokens);
        let payout = self.redemption_value(yes_qty, no_qty)?;
        let pool = sub(self.pool, payout)?;
        self.pool = pool;
        self.yes_total -= yes_qty;
        self.no_total -= no_qty;
        Ok(payout)
    }

    /// After settlement: convert a seat's free YES/NO into free cash at redemption value.
    pub fn redeem_seat(&mut self, seat: usize) -> Result<u64> {
        require!(self.status == STATUS_RESOLVED || self.status == STATUS_VOID, MontionsError::NotSettled);
        require!(seat < MAX_SEATS && self.seats[seat].owner != Pubkey::default(), MontionsError::BadArgs);
        let (y, n) = (self.seats[seat].yes, self.seats[seat].no);
        if y == 0 && n == 0 {
            return Ok(0);
        }
        require!(y <= self.yes_total && n <= self.no_total, MontionsError::InvariantViolated);
        let payout = self.redemption_value(y, n)?;
        let pool = sub(self.pool, payout)?;
        let cash = add(self.seats[seat].cash, payout)?;
        self.pool = pool;
        self.yes_total -= y;
        self.no_total -= n;
        let s = &mut self.seats[seat];
        s.cash = cash;
        s.yes = 0;
        s.no = 0;
        Ok(payout)
    }

    pub fn best_bid(&self) -> Option<u8> {
        highest_tick(&self.bid_bits)
    }

    pub fn best_ask(&self) -> Option<u8> {
        lowest_tick(&self.ask_bits)
    }

    /// Aggregate remaining quantity at a level.
    pub fn level_qty(&self, side: u8, tick: u8) -> u64 {
        if side > SIDE_ASK || !(MIN_TICK..=MAX_TICK).contains(&tick) {
            return 0;
        }
        let mut cur = self.level(side, tick).head;
        let mut sum = 0u64;
        let mut steps = 0;
        while cur != NIL && (cur as usize) < MAX_ORDERS && steps < MAX_ORDERS {
            let o = &self.orders[cur as usize];
            sum = sum.saturating_add(o.qty);
            cur = o.next;
            steps += 1;
        }
        sum
    }

    /// Structural + accounting invariants that do not need token balances (tests / debug).
    pub fn check_invariants(&self) -> Result<()> {
        macro_rules! ensure {
            ($cond:expr, $what:expr) => {
                if !($cond) {
                    msg!("market invariant violated: {}", $what);
                    return err!(MontionsError::InvariantViolated);
                }
            };
        }
        ensure!(
            self.status == STATUS_OPEN || self.status == STATUS_RESOLVED || self.status == STATUS_VOID,
            "status"
        );
        ensure!(self.outcome <= 1, "outcome");
        ensure!(self.next_order_id >= 1, "next_order_id");
        ensure!((self.trade_head as usize) < TRADE_RING, "trade_head");
        ensure!(self.last_trade_tick <= MAX_TICK, "last_trade_tick");
        for bits in [&self.bid_bits, &self.ask_bits] {
            ensure!(bits[0] & !VALID_LO == 0 && bits[1] & !VALID_HI == 0, "bitmap bit outside 1..=99");
        }

        // 0 = unseen, 1 = resting, 2 = free.
        let mut seen = [0u8; MAX_ORDERS];
        let mut locked = [0u64; MAX_SEATS];
        let mut yes_locked = [0u64; MAX_SEATS];
        let mut no_locked = [0u64; MAX_SEATS];
        let mut open = [0u32; MAX_SEATS];
        for side in [SIDE_BID, SIDE_ASK] {
            for t in 0..LEVELS {
                let lvl = *self.level(side, t as u8);
                let bit = bit_get(self.bits(side), t);
                ensure!((lvl.head == NIL) == (lvl.tail == NIL), "level head/tail emptiness");
                ensure!(bit == (lvl.head != NIL), "bitmap bit <=> level non-empty");
                if t == 0 {
                    ensure!(lvl.head == NIL, "level 0 must be empty");
                }
                let mut prev = NIL;
                let mut cur = lvl.head;
                let mut last_id = 0u64;
                let mut steps = 0usize;
                while cur != NIL {
                    let c = cur as usize;
                    ensure!(c < MAX_ORDERS, "level link out of range");
                    steps += 1;
                    ensure!(steps <= MAX_ORDERS, "level list cycle");
                    ensure!(seen[c] == 0, "order slot linked twice");
                    seen[c] = 1;
                    let o = &self.orders[c];
                    ensure!(o.id != 0 && o.id < self.next_order_id, "resting order id");
                    ensure!(o.id > last_id, "FIFO: ids increase from head to tail");
                    last_id = o.id;
                    ensure!(o.qty >= 1 && o.qty <= MAX_ORDER_QTY, "resting order qty");
                    ensure!(o.side == side && o.tick as usize == t, "order side/tick vs level");
                    ensure!(o.from_held <= 1, "from_held flag");
                    ensure!(o.prev == prev, "prev link");
                    let s = o.seat as usize;
                    ensure!(s < MAX_SEATS && self.seats[s].owner != Pubkey::default(), "order seat");
                    open[s] += 1;
                    if o.from_held == 0 {
                        let v = cash_escrow(o.side, o.tick, o.qty)?;
                        locked[s] = add(locked[s], v)?;
                    } else if o.side == SIDE_BID {
                        no_locked[s] = add(no_locked[s], o.qty)?;
                    } else {
                        yes_locked[s] = add(yes_locked[s], o.qty)?;
                    }
                    prev = cur;
                    cur = o.next;
                }
                ensure!(lvl.tail == prev, "tail link");
            }
        }
        let mut cur = self.free_head;
        let mut steps = 0usize;
        while cur != NIL {
            let c = cur as usize;
            ensure!(c < MAX_ORDERS, "free list link out of range");
            steps += 1;
            ensure!(steps <= MAX_ORDERS, "free list cycle");
            ensure!(seen[c] == 0, "free slot also resting / listed twice");
            seen[c] = 2;
            ensure!(self.orders[c].id == 0, "free slot has an id");
            cur = self.orders[c].next;
        }
        for (c, state) in seen.iter().enumerate() {
            ensure!(*state != 0, "order slot neither resting nor free");
            if *state == 2 {
                ensure!(self.orders[c].qty == 0, "free slot has qty");
            }
        }

        let (mut seat_yes, mut seat_no) = (0u128, 0u128);
        for s in 0..MAX_SEATS {
            let seat = &self.seats[s];
            if seat.owner == Pubkey::default() {
                ensure!(*seat == Seat::default(), "free seat not zeroed");
                continue;
            }
            for later in s + 1..MAX_SEATS {
                ensure!(self.seats[later].owner != seat.owner, "duplicate seat owner");
            }
            ensure!(seat.locked == locked[s], "seat.locked == escrow of its cash orders");
            ensure!(seat.yes_locked == yes_locked[s], "seat.yes_locked == qty of its held asks");
            ensure!(seat.no_locked == no_locked[s], "seat.no_locked == qty of its held bids");
            ensure!(seat.open_orders == open[s], "seat.open_orders");
            seat_yes += seat.yes as u128 + seat.yes_locked as u128;
            seat_no += seat.no as u128 + seat.no_locked as u128;
        }
        ensure!(seat_yes <= self.yes_total as u128, "seat YES exceeds yes_total");
        ensure!(seat_no <= self.no_total as u128, "seat NO exceeds no_total");

        let unit = UNIT as u128;
        let pool = self.pool as u128;
        let (yt, nt) = (self.yes_total as u128, self.no_total as u128);
        match self.status {
            STATUS_OPEN => ensure!(pool == yt * unit && pool == nt * unit, "open: pool == yes_total*UNIT == no_total*UNIT"),
            STATUS_RESOLVED => {
                let w = if self.outcome == 1 { yt } else { nt };
                ensure!(pool == w * unit, "resolved: pool == winning_total*UNIT")
            }
            _ => ensure!(2 * pool == (yt + nt) * unit, "void: 2*pool == (yes_total+no_total)*UNIT"),
        }
        Ok(())
    }

    // ───────────────────────────── private ─────────────────────────────

    #[inline]
    fn bits(&self, side: u8) -> &[u64; 2] {
        if side == SIDE_BID {
            &self.bid_bits
        } else {
            &self.ask_bits
        }
    }

    #[inline]
    fn bits_mut(&mut self, side: u8) -> &mut [u64; 2] {
        if side == SIDE_BID {
            &mut self.bid_bits
        } else {
            &mut self.ask_bits
        }
    }

    #[inline]
    fn level(&self, side: u8, tick: u8) -> &Level {
        if side == SIDE_BID {
            &self.bid_levels[tick as usize]
        } else {
            &self.ask_levels[tick as usize]
        }
    }

    #[inline]
    fn level_mut(&mut self, side: u8, tick: u8) -> &mut Level {
        if side == SIDE_BID {
            &mut self.bid_levels[tick as usize]
        } else {
            &mut self.ask_levels[tick as usize]
        }
    }

    fn free_seat(&self) -> Option<usize> {
        (0..MAX_SEATS).find(|&i| self.seats[i].owner == Pubkey::default())
    }

    /// Resolved: winning side pays UNIT. Void: every contract pays UNIT / 2.
    fn redemption_value(&self, yes_qty: u64, no_qty: u64) -> Result<u64> {
        if self.status == STATUS_RESOLVED {
            units(if self.outcome == 1 { yes_qty } else { no_qty })
        } else {
            let v = ((yes_qty as u128) + (no_qty as u128)) * (UNIT as u128) / 2;
            u64::try_from(v).map_err(|_| ovf())
        }
    }

    /// Append slot `idx` (already filled in) at the tail of its level.
    fn link_tail(&mut self, idx: usize) {
        let (side, tick) = (self.orders[idx].side, self.orders[idx].tick);
        let tail = self.level(side, tick).tail;
        self.orders[idx].prev = tail;
        self.orders[idx].next = NIL;
        if tail == NIL {
            self.level_mut(side, tick).head = idx as u8;
            bit_set(self.bits_mut(side), tick);
        } else {
            self.orders[tail as usize].next = idx as u8;
        }
        self.level_mut(side, tick).tail = idx as u8;
    }

    /// Unlink slot `idx` from its level (clearing the bitmap bit if the level empties) and push it
    /// on the free list.
    fn remove_order(&mut self, idx: usize) {
        let o = self.orders[idx];
        if o.prev == NIL {
            self.level_mut(o.side, o.tick).head = o.next;
        } else {
            self.orders[o.prev as usize].next = o.next;
        }
        if o.next == NIL {
            self.level_mut(o.side, o.tick).tail = o.prev;
        } else {
            self.orders[o.next as usize].prev = o.prev;
        }
        if self.level(o.side, o.tick).head == NIL {
            bit_clear(self.bits_mut(o.side), o.tick);
        }
        self.orders[idx] = free_order(self.free_head);
        self.free_head = idx as u8;
    }

    /// Cancel resting slot `idx`: escrow → the seat's free balances, slot freed. Atomic (the new
    /// seat is computed before anything is written). Returns the cancelled quantity.
    fn cancel_resting(&mut self, idx: usize) -> Result<u64> {
        let o = self.orders[idx];
        let si = o.seat as usize;
        require!(o.id != 0 && si < MAX_SEATS, MontionsError::InvariantViolated);
        let mut s = self.seats[si];
        if o.from_held == 0 {
            let amount = cash_escrow(o.side, o.tick, o.qty)?;
            s.locked = sub(s.locked, amount)?;
            s.cash = add(s.cash, amount)?;
        } else if o.side == SIDE_BID {
            s.no_locked = sub(s.no_locked, o.qty)?;
            s.no = add(s.no, o.qty)?;
        } else {
            s.yes_locked = sub(s.yes_locked, o.qty)?;
            s.yes = add(s.yes, o.qty)?;
        }
        s.open_orders = s.open_orders.checked_sub(1).ok_or_else(ovf)?;
        self.seats[si] = s;
        self.remove_order(idx);
        Ok(o.qty)
    }

    /// Phase 1 of a placement: walk the opposite side exactly as the real matching loop will,
    /// without mutating anything.
    fn simulate(&self, args: &PlaceArgs, stp_seat: Option<usize>, max_fills: u32) -> Result<Sim> {
        let mut sim = Sim { remaining: args.qty, ..Sim::default() };
        if args.tif == TIF_POST_ONLY {
            return Ok(sim); // validated as non-crossing by the caller
        }
        let opp = args.side ^ 1;
        let mut bits = *self.bits(opp);
        let mut cur_tick = 0u8;
        let mut idx = NIL;
        let mut steps = 0usize;
        loop {
            if idx == NIL {
                if cur_tick != 0 {
                    bit_clear(&mut bits, cur_tick);
                }
                match best_crossing(&bits, args.side, args.tick) {
                    Some(t) => {
                        cur_tick = t;
                        idx = self.level(opp, t).head;
                        require!(idx != NIL, MontionsError::InvariantViolated);
                    }
                    None => break,
                }
            }
            if sim.remaining == 0 || sim.attempts >= max_fills {
                break;
            }
            steps += 1;
            require!((idx as usize) < MAX_ORDERS && steps <= MAX_ORDERS, MontionsError::InvariantViolated);
            let o = &self.orders[idx as usize];
            require!(o.id != 0 && o.qty != 0, MontionsError::InvariantViolated);
            if stp_seat == Some(o.seat as usize) {
                if o.from_held == 0 {
                    sim.seat_cash = add(sim.seat_cash, cash_escrow(o.side, o.tick, o.qty)?)?;
                } else {
                    sim.seat_tok = add(sim.seat_tok, o.qty)?;
                }
            } else {
                let f = o.qty.min(sim.remaining);
                let e = fill_econ(args.side, args.tick, args.from_held, o.from_held != 0, cur_tick, f)?;
                sim.filled = add(sim.filled, f)?;
                sim.remaining -= f;
                sim.fee_base = add(sim.fee_base, e.fee_base)?;
                sim.minted = add(sim.minted, e.minted)?;
                sim.burned = add(sim.burned, e.burned)?;
                sim.taker_cash = add(sim.taker_cash, e.taker_cash)?;
                sim.taker_yes = add(sim.taker_yes, e.taker_yes)?;
                sim.taker_no = add(sim.taker_no, e.taker_no)?;
                sim.seat_cash = add(sim.seat_cash, e.maker_cash)?;
                sim.seat_tok = add(sim.seat_tok, add(e.maker_yes, e.maker_no)?)?;
            }
            sim.attempts += 1;
            idx = o.next;
        }
        sim.still_crossing = idx != NIL;
        Ok(sim)
    }

    /// Shared body of `place_taker` (`owner = Some`) and `place_from_seat` (`from_seat = Some`).
    fn place_inner(
        &mut self,
        owner: Option<&Pubkey>,
        from_seat: Option<usize>,
        args: &PlaceArgs,
        fee_bps: u16,
        now: i64,
    ) -> Result<PlaceResult> {
        // ── phase 1: validate (read-only) ──
        require!(self.status == STATUS_OPEN, MontionsError::MarketNotOpen);
        require!(now < self.expiry, MontionsError::Expired);
        let escrow = Self::required_escrow(args, fee_bps)?;
        let full_escrow = if args.from_held { 0 } else { cash_escrow(args.side, args.tick, args.qty)? };
        let reserve = sub(escrow.cash, full_escrow)?;
        let stp_seat = match from_seat {
            Some(s) => {
                require!(s < MAX_SEATS && self.seats[s].owner != Pubkey::default(), MontionsError::BadArgs);
                let seat = &self.seats[s];
                require!(seat.cash >= escrow.cash, MontionsError::InsufficientCash);
                require!(seat.yes >= escrow.yes && seat.no >= escrow.no, MontionsError::InsufficientTokens);
                Some(s)
            }
            None => {
                let owner = owner.ok_or_else(|| error!(MontionsError::BadArgs))?;
                require!(*owner != Pubkey::default(), MontionsError::BadArgs);
                self.find_seat(owner)
            }
        };
        let opp = args.side ^ 1;
        if args.tif == TIF_POST_ONLY {
            require!(best_crossing(self.bits(opp), args.side, args.tick).is_none(), MontionsError::WouldCross);
        }
        let max_fills = if args.max_fills == 0 { DEFAULT_MAX_FILLS } else { args.max_fills } as u32;
        let sim = self.simulate(args, stp_seat, max_fills)?;
        require!(sim.filled >= args.min_filled, MontionsError::MinFillNotMet);

        let rem = sim.remaining;
        let rests = rem > 0 && args.tif != TIF_IOC && !sim.still_crossing;
        let rem_cash = if args.from_held { 0 } else { cash_escrow(args.side, args.tick, rem)? };
        if rests {
            if stp_seat.is_none() {
                require!(self.free_seat().is_some(), MontionsError::SeatsFull);
            }
            // Every attempt of a walk that leaves a remainder removed a resting order.
            require!(self.free_head != NIL || sim.attempts > 0, MontionsError::BookFull);
            add(self.next_order_id, 1)?;
        }
        let fee = fee_ceil(sim.fee_base, fee_bps)?;
        let mut res = PlaceResult {
            order_id: 0,
            filled: sim.filled,
            resting: if rests { rem } else { 0 },
            fee,
            cash_out: sub(add(sim.taker_cash, reserve)?, fee)?,
            yes_out: sim.taker_yes,
            no_out: sim.taker_no,
        };
        if rem > 0 && !rests {
            if !args.from_held {
                res.cash_out = add(res.cash_out, rem_cash)?;
            } else if args.side == SIDE_BID {
                res.no_out = add(res.no_out, rem)?;
            } else {
                res.yes_out = add(res.yes_out, rem)?;
            }
        }
        // Aggregate overflow pre-checks, so phase 2 cannot fail.
        add(self.pool, units(sim.minted)?)?;
        sub(self.pool, units(sim.burned)?)?;
        add(self.yes_total, sim.minted)?;
        add(self.no_total, sim.minted)?;
        sub(self.yes_total, sim.burned)?;
        sub(self.no_total, sim.burned)?;
        add(self.fees, fee)?;
        add(self.volume, sim.filled)?;
        let cash_credit = add(add(sim.seat_cash, res.cash_out)?, rem_cash)?;
        let tok_credit = add(add(add(sim.seat_tok, res.yes_out)?, res.no_out)?, rem)?;
        let (mut max_cash, mut max_tok) = (0u64, 0u64);
        for s in self.seats.iter() {
            max_cash = max_cash.max(s.cash).max(s.locked);
            max_tok = max_tok.max(s.yes).max(s.no).max(s.yes_locked).max(s.no_locked);
        }
        add(max_cash, cash_credit)?;
        add(max_tok, tok_credit)?;

        // ── phase 2: mutate ──
        if let Some(s) = from_seat {
            let seat = &mut self.seats[s];
            seat.cash -= escrow.cash;
            seat.yes -= escrow.yes;
            seat.no -= escrow.no;
        }
        let taker_is_buyer = args.side == SIDE_BID;
        let (mut attempts, mut filled, mut remaining, mut fee_base) = (0u32, 0u64, args.qty, 0u64);
        if args.tif != TIF_POST_ONLY {
            while remaining > 0 && attempts < max_fills {
                let Some(p) = best_crossing(self.bits(opp), args.side, args.tick) else {
                    break;
                };
                let idx = self.level(opp, p).head as usize;
                let o = self.orders[idx];
                if stp_seat == Some(o.seat as usize) {
                    self.cancel_resting(idx)?;
                } else {
                    let f = o.qty.min(remaining);
                    let e = fill_econ(args.side, args.tick, args.from_held, o.from_held != 0, p, f)?;
                    self.apply_maker_fill(idx, &o, f, &e)?;
                    self.record_trade(now, f, p, taker_is_buyer)?;
                    remaining -= f;
                    filled = add(filled, f)?;
                    fee_base = add(fee_base, e.fee_base)?;
                }
                attempts += 1;
            }
        }
        require!(
            attempts == sim.attempts && filled == sim.filled && remaining == rem && fee_base == sim.fee_base,
            MontionsError::InvariantViolated
        );
        if rests {
            let seat = match stp_seat {
                Some(s) => s,
                // Validated above: owner is set and a free seat exists.
                None => self.seat_or_alloc(owner.ok_or_else(|| error!(MontionsError::BadArgs))?)?,
            };
            res.order_id = self.rest_order(seat, args, rem, rem_cash, now)?;
        }
        self.fees = add(self.fees, fee)?;
        if let Some(s) = from_seat {
            let seat = &mut self.seats[s];
            seat.cash = add(seat.cash, res.cash_out)?;
            seat.yes = add(seat.yes, res.yes_out)?;
            seat.no = add(seat.no, res.no_out)?;
            res.cash_out = 0;
            res.yes_out = 0;
            res.no_out = 0;
        }
        Ok(res)
    }

    /// Apply one fill to the resting order at slot `idx` (a copy of which is `o`) and its seat.
    fn apply_maker_fill(&mut self, idx: usize, o: &Order, f: u64, e: &Econ) -> Result<()> {
        let full = f == o.qty;
        {
            let s = &mut self.seats[o.seat as usize];
            s.locked = sub(s.locked, e.maker_locked)?;
            s.yes_locked = sub(s.yes_locked, e.maker_yes_locked)?;
            s.no_locked = sub(s.no_locked, e.maker_no_locked)?;
            s.cash = add(s.cash, e.maker_cash)?;
            s.yes = add(s.yes, e.maker_yes)?;
            s.no = add(s.no, e.maker_no)?;
            if full {
                s.open_orders = s.open_orders.checked_sub(1).ok_or_else(ovf)?;
            }
        }
        if e.minted != 0 {
            self.pool = add(self.pool, units(e.minted)?)?;
            self.yes_total = add(self.yes_total, e.minted)?;
            self.no_total = add(self.no_total, e.minted)?;
        }
        if e.burned != 0 {
            self.pool = sub(self.pool, units(e.burned)?)?;
            self.yes_total = sub(self.yes_total, e.burned)?;
            self.no_total = sub(self.no_total, e.burned)?;
        }
        if full {
            self.remove_order(idx);
        } else {
            self.orders[idx].qty = o.qty - f;
        }
        Ok(())
    }

    fn record_trade(&mut self, now: i64, f: u64, tick: u8, taker_is_buyer: bool) -> Result<()> {
        let qty = u32::try_from(f).map_err(|_| ovf())?;
        let h = self.trade_head as usize % TRADE_RING;
        self.trades[h] = Trade { ts: now, qty, tick, taker_is_buyer: taker_is_buyer as u8, _pad: [0; 2] };
        self.trade_head = ((h + 1) % TRADE_RING) as u8;
        self.trade_count = self.trade_count.saturating_add(1);
        self.volume = add(self.volume, f)?;
        self.last_trade_tick = tick;
        Ok(())
    }

    /// Rest `qty` of `args` at its limit in `seat`'s name; the remainder escrow (`cash` collateral,
    /// or `qty` held tokens) moves into the seat's locked balances.
    fn rest_order(&mut self, seat: usize, args: &PlaceArgs, qty: u64, cash: u64, now: i64) -> Result<u64> {
        let idx = self.free_head;
        require!(idx != NIL && (idx as usize) < MAX_ORDERS, MontionsError::BookFull);
        let id = self.next_order_id;
        let next_id = add(id, 1)?;
        let mut s = self.seats[seat];
        if !args.from_held {
            s.locked = add(s.locked, cash)?;
        } else if args.side == SIDE_BID {
            s.no_locked = add(s.no_locked, qty)?;
        } else {
            s.yes_locked = add(s.yes_locked, qty)?;
        }
        s.open_orders = s.open_orders.checked_add(1).ok_or_else(ovf)?;
        let i = idx as usize;
        self.seats[seat] = s;
        self.free_head = self.orders[i].next;
        self.orders[i] = Order {
            id,
            qty,
            ts: now,
            seat: seat as u8,
            side: args.side,
            tick: args.tick,
            from_held: args.from_held as u8,
            prev: NIL,
            next: NIL,
            _pad: [0; 2],
        };
        self.link_tail(i);
        self.next_order_id = next_id;
        Ok(id)
    }
}

/// A free order slot linked to `next` on the free list.
#[inline]
fn free_order(next: u8) -> Order {
    Order { id: 0, qty: 0, ts: 0, seat: 0, side: 0, tick: 0, from_held: 0, prev: NIL, next, _pad: [0; 2] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitmap_and_fee_helpers() {
        // Bitmap helpers: lowest/highest across the word boundary, invalid bits ignored.
        assert_eq!(lowest_tick(&[1, 0]), None);
        assert_eq!(highest_tick(&[0, 1 << 40]), None);
        assert_eq!(lowest_tick(&[0, 1]), Some(64));
        assert_eq!(highest_tick(&[1 << 63, 0]), Some(63));
        assert_eq!(highest_tick(&[2, 1 << 35]), Some(99));
        assert_eq!(fee_ceil(1, 1).unwrap(), 1);
        assert_eq!(fee_ceil(10_000, 1).unwrap(), 1);
        assert_eq!(fee_ceil(10_001, 1).unwrap(), 2);
        assert_eq!(fee_ceil(0, 100).unwrap(), 0);
    }
}
