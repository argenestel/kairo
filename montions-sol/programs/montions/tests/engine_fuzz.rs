//! Randomized differential test of the engine against an independent reference model.
//!
//! The model keeps resting orders in a plain `Vec` and matches by sorting candidates by
//! (price priority, order id); fills are expressed per party (bid party B / ask party A) exactly as
//! in docs/SPEC.md §5 cases 1–4. A harness tracks collateral in/out and wallet YES/NO. After EVERY
//! op we check: engine == model (header, seats, orders, level FIFO order, trade ring, results and
//! error codes), `check_invariants()`, SPEC §5 invariants 1–6, and that failing calls leave the
//! market byte-for-byte unchanged.
//!
//! Env overrides: MONTIONS_FUZZ_SEEDS (default 2000), MONTIONS_FUZZ_OPS (default 300).
use std::collections::BTreeMap;
use std::fmt::Debug;

use anchor_lang::prelude::Pubkey;
use montions::constants::*;
use montions::errors::MontionsError as E;
use montions::state::*;

mod engine_common;
use engine_common::*;

type R<T> = std::result::Result<T, u32>;

fn fail<T>(e: E) -> R<T> {
    Err(ecode(e))
}

fn per(side: u8, tick: u8) -> u64 {
    if side == SIDE_BID {
        tick as u64
    } else {
        100 - tick as u64
    }
}

fn ceil_fee(base: u64, bps: u16) -> u64 {
    (base as u128 * bps as u128).div_ceil(10_000) as u64
}

// ───────────────────────────── reference model ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MOrder {
    id: u64,
    seat: usize,
    side: u8,
    tick: u8,
    qty: u64,
    held: bool,
    ts: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct MSeat {
    owner: Option<usize>,
    cash: u64,
    locked: u64,
    yes: u64,
    no: u64,
    yes_locked: u64,
    no_locked: u64,
    open: u32,
}

#[derive(Clone, Copy, Debug)]
enum Taker {
    Wallet(usize),
    Seat(usize),
}

#[derive(Default, Debug)]
struct Stats {
    ops: u64,
    /// Fills by `taker_bid*4 + taker_held*2 + maker_held`.
    fills: [u64; 8],
    stp: u64,
    bound_refunds: u64,
    rested: u64,
    partial_maker_fills: u64,
    multi_level_takes: u64,
    errors: BTreeMap<u32, u64>,
    settled_yes: u64,
    settled_no: u64,
    voided: u64,
    max_orders: usize,
}

#[derive(Clone)]
struct Model {
    status: u8,
    outcome: u8,
    expiry: i64,
    pool: u64,
    yes_total: u64,
    no_total: u64,
    fees: u64,
    volume: u64,
    next_id: u64,
    last_tick: u8,
    trades: Vec<(i64, u32, u8, u8)>,
    orders: Vec<MOrder>,
    seats: [MSeat; MAX_SEATS],
}

impl Model {
    fn new(expiry: i64) -> Self {
        Model {
            status: STATUS_OPEN,
            outcome: 0,
            expiry,
            pool: 0,
            yes_total: 0,
            no_total: 0,
            fees: 0,
            volume: 0,
            next_id: 1,
            last_tick: 0,
            trades: Vec::new(),
            orders: Vec::new(),
            seats: [MSeat::default(); MAX_SEATS],
        }
    }

    fn find_seat(&self, owner: usize) -> Option<usize> {
        self.seats.iter().position(|s| s.owner == Some(owner))
    }

    fn free_seat(&self) -> Option<usize> {
        self.seats.iter().position(|s| s.owner.is_none())
    }

    fn seat_or_alloc(&mut self, owner: usize) -> R<usize> {
        if let Some(i) = self.find_seat(owner) {
            return Ok(i);
        }
        let i = self.free_seat().ok_or(ecode(E::SeatsFull))?;
        self.seats[i] = MSeat { owner: Some(owner), ..Default::default() };
        Ok(i)
    }

    /// Remove resting order at vec index `k`, escrow back to its seat's free balances.
    fn cancel_idx(&mut self, k: usize) -> u64 {
        let o = self.orders.remove(k);
        let s = &mut self.seats[o.seat];
        if !o.held {
            let v = o.qty * per(o.side, o.tick) * TU;
            s.locked -= v;
            s.cash += v;
        } else if o.side == SIDE_BID {
            s.no_locked -= o.qty;
            s.no += o.qty;
        } else {
            s.yes_locked -= o.qty;
            s.yes += o.qty;
        }
        s.open -= 1;
        o.qty
    }

    fn cancel_order(&mut self, owner: usize, id: u64) -> R<u64> {
        if id == 0 {
            return fail(E::OrderNotOpen);
        }
        let k = self.orders.iter().position(|o| o.id == id).ok_or(ecode(E::OrderNotOpen))?;
        if self.seats[self.orders[k].seat].owner != Some(owner) {
            return fail(E::NotOrderOwner);
        }
        Ok(self.cancel_idx(k))
    }

    fn cancel_all(&mut self, seat: usize) -> R<u32> {
        if seat >= MAX_SEATS {
            return fail(E::BadArgs);
        }
        let mut n = 0;
        while let Some(k) = self.orders.iter().position(|o| o.seat == seat) {
            self.cancel_idx(k);
            n += 1;
        }
        Ok(n)
    }

    fn take_seat_free(&mut self, seat: usize) -> (u64, u64, u64) {
        if seat >= MAX_SEATS || self.seats[seat].owner.is_none() {
            return (0, 0, 0);
        }
        let s = &mut self.seats[seat];
        let out = (s.cash, s.yes, s.no);
        s.cash = 0;
        s.yes = 0;
        s.no = 0;
        if s.locked == 0 && s.yes_locked == 0 && s.no_locked == 0 && s.open == 0 {
            *s = MSeat::default();
        }
        out
    }

    fn credit(&mut self, seat: usize, amount: u64) -> R<()> {
        if seat >= MAX_SEATS || self.seats[seat].owner.is_none() {
            return fail(E::BadArgs);
        }
        self.seats[seat].cash = self.seats[seat].cash.checked_add(amount).ok_or(ecode(E::MathOverflow))?;
        Ok(())
    }

    fn split(&mut self, qty: u64, now: i64) -> R<u64> {
        if self.status != STATUS_OPEN {
            return fail(E::MarketNotOpen);
        }
        if now >= self.expiry {
            return fail(E::Expired);
        }
        if qty == 0 || qty > MAX_ORDER_QTY {
            return fail(E::BadQty);
        }
        self.pool += qty * UNIT;
        self.yes_total += qty;
        self.no_total += qty;
        Ok(qty * UNIT)
    }

    fn merge(&mut self, qty: u64) -> R<u64> {
        if self.status != STATUS_OPEN {
            return fail(E::MarketNotOpen);
        }
        if qty == 0 || qty > MAX_ORDER_QTY {
            return fail(E::BadQty);
        }
        if self.yes_total < qty || self.no_total < qty {
            return fail(E::InsufficientTokens);
        }
        self.pool -= qty * UNIT;
        self.yes_total -= qty;
        self.no_total -= qty;
        Ok(qty * UNIT)
    }

    fn settle(&mut self, yes: bool) -> R<()> {
        if self.status != STATUS_OPEN {
            return fail(E::AlreadySettled);
        }
        self.status = STATUS_RESOLVED;
        self.outcome = yes as u8;
        Ok(())
    }

    fn void(&mut self) -> R<()> {
        if self.status != STATUS_OPEN {
            return fail(E::AlreadySettled);
        }
        self.status = STATUS_VOID;
        Ok(())
    }

    fn value(&self, y: u64, n: u64) -> u64 {
        if self.status == STATUS_RESOLVED {
            (if self.outcome == 1 { y } else { n }) * UNIT
        } else {
            (y + n) * UNIT / 2
        }
    }

    fn redeem(&mut self, y: u64, n: u64) -> R<u64> {
        if self.status == STATUS_OPEN {
            return fail(E::NotSettled);
        }
        if y == 0 && n == 0 {
            return fail(E::BadQty);
        }
        if y > self.yes_total || n > self.no_total {
            return fail(E::InsufficientTokens);
        }
        let v = self.value(y, n);
        self.pool -= v;
        self.yes_total -= y;
        self.no_total -= n;
        Ok(v)
    }

    fn redeem_seat(&mut self, seat: usize) -> R<u64> {
        if self.status == STATUS_OPEN {
            return fail(E::NotSettled);
        }
        if seat >= MAX_SEATS || self.seats[seat].owner.is_none() {
            return fail(E::BadArgs);
        }
        let (y, n) = (self.seats[seat].yes, self.seats[seat].no);
        if y == 0 && n == 0 {
            return Ok(0);
        }
        let v = self.value(y, n);
        self.pool -= v;
        self.yes_total -= y;
        self.no_total -= n;
        let s = &mut self.seats[seat];
        s.cash += v;
        s.yes = 0;
        s.no = 0;
        Ok(v)
    }

    fn place(&mut self, taker: Taker, a: &PlaceArgs, bps: u16, now: i64, st: &mut Stats) -> R<PlaceResult> {
        if self.status != STATUS_OPEN {
            return fail(E::MarketNotOpen);
        }
        if now >= self.expiry {
            return fail(E::Expired);
        }
        if a.side > 1 || a.tif > 2 {
            return fail(E::BadArgs);
        }
        if a.tick < 1 || a.tick > 99 {
            return fail(E::BadTick);
        }
        if a.qty < 1 || a.qty > MAX_ORDER_QTY {
            return fail(E::BadQty);
        }
        if bps > MAX_FEE_BPS {
            return fail(E::FeeTooHigh);
        }
        let taker_bid = a.side == SIDE_BID;
        let esc = if a.from_held { 0 } else { a.qty * per(a.side, a.tick) * TU };
        let reserve = if a.from_held || a.tif == TIF_POST_ONLY { 0 } else { ceil_fee(esc, bps) };
        let e_cash = esc + reserve;
        let e_yes = if a.from_held && !taker_bid { a.qty } else { 0 };
        let e_no = if a.from_held && taker_bid { a.qty } else { 0 };
        let stp = match taker {
            Taker::Seat(s) => {
                if s >= MAX_SEATS || self.seats[s].owner.is_none() {
                    return fail(E::BadArgs);
                }
                if self.seats[s].cash < e_cash {
                    return fail(E::InsufficientCash);
                }
                if self.seats[s].yes < e_yes || self.seats[s].no < e_no {
                    return fail(E::InsufficientTokens);
                }
                Some(s)
            }
            Taker::Wallet(o) => self.find_seat(o),
        };
        // Crossing resting orders in price-time priority.
        let mut cands: Vec<MOrder> = self
            .orders
            .iter()
            .copied()
            .filter(|o| o.side != a.side && if taker_bid { o.tick <= a.tick } else { o.tick >= a.tick })
            .collect();
        cands.sort_by_key(|o| (if taker_bid { o.tick as i32 } else { -(o.tick as i32) }, o.id));
        if a.tif == TIF_POST_ONLY && !cands.is_empty() {
            return fail(E::WouldCross);
        }

        let mut nx = self.clone();
        if let Taker::Seat(s) = taker {
            nx.seats[s].cash -= e_cash;
            nx.seats[s].yes -= e_yes;
            nx.seats[s].no -= e_no;
        }
        let max_fills = if a.max_fills == 0 { 32 } else { a.max_fills as usize };
        let (mut rem, mut filled, mut attempts, mut base) = (a.qty, 0u64, 0usize, 0u64);
        let (mut t_cash, mut t_yes, mut t_no) = (0u64, 0u64, 0u64);
        let mut i = 0;
        let mut local_fills = [0u64; 8];
        let (mut local_stp, mut local_partial) = (0u64, 0u64);
        let mut ticks_hit = Vec::new();
        if a.tif != TIF_POST_ONLY {
            while i < cands.len() && rem > 0 && attempts < max_fills {
                let c = cands[i];
                i += 1;
                attempts += 1;
                let k = nx.orders.iter().position(|o| o.id == c.id).unwrap();
                if Some(c.seat) == stp {
                    nx.cancel_idx(k);
                    local_stp += 1;
                    continue;
                }
                let f = c.qty.min(rem);
                let p = c.tick as u64;
                let (bid_held, ask_held) = if taker_bid { (a.from_held, c.held) } else { (c.held, a.from_held) };
                // What the bid party B and ask party A receive (SPEC §5 cases 1–4).
                let (mut b_cash, mut a_cash, mut b_yes, mut a_no) = (0u64, 0u64, 0u64, 0u64);
                match (bid_held, ask_held) {
                    (false, false) => {
                        b_yes = f;
                        a_no = f;
                        nx.pool += f * UNIT;
                        nx.yes_total += f;
                        nx.no_total += f;
                    }
                    (false, true) => {
                        b_yes = f;
                        a_cash = f * p * TU;
                    }
                    (true, false) => {
                        a_no = f;
                        b_cash = f * (100 - p) * TU;
                    }
                    (true, true) => {
                        a_cash = f * p * TU;
                        b_cash = f * (100 - p) * TU;
                        nx.pool -= f * UNIT;
                        nx.yes_total -= f;
                        nx.no_total -= f;
                    }
                }
                {
                    let ms = &mut nx.seats[c.seat];
                    if c.held {
                        if c.side == SIDE_BID {
                            ms.no_locked -= f;
                        } else {
                            ms.yes_locked -= f;
                        }
                    } else {
                        ms.locked -= f * per(c.side, c.tick) * TU;
                    }
                    if taker_bid {
                        ms.cash += a_cash;
                        ms.no += a_no;
                    } else {
                        ms.cash += b_cash;
                        ms.yes += b_yes;
                    }
                }
                if taker_bid {
                    t_yes += b_yes;
                    if a.from_held {
                        t_cash += b_cash;
                        base += b_cash;
                    } else {
                        t_cash += f * (a.tick as u64 - p) * TU;
                        base += f * p * TU;
                    }
                } else {
                    t_no += a_no;
                    if a.from_held {
                        t_cash += a_cash;
                        base += a_cash;
                    } else {
                        t_cash += f * (p - a.tick as u64) * TU;
                        base += f * (100 - p) * TU;
                    }
                }
                let o = &mut nx.orders[k];
                o.qty -= f;
                if o.qty == 0 {
                    nx.orders.remove(k);
                    nx.seats[c.seat].open -= 1;
                } else {
                    local_partial += 1;
                }
                nx.trades.push((now, f as u32, c.tick, taker_bid as u8));
                nx.volume += f;
                nx.last_tick = c.tick;
                rem -= f;
                filled += f;
                local_fills[(taker_bid as usize) * 4 + (a.from_held as usize) * 2 + c.held as usize] += 1;
                if !ticks_hit.contains(&c.tick) {
                    ticks_hit.push(c.tick);
                }
            }
        }
        let still_crossing = i < cands.len();
        if filled < a.min_filled {
            return fail(E::MinFillNotMet);
        }
        let rests = rem > 0 && a.tif != TIF_IOC && !still_crossing;
        let mut rest_seat = None;
        if rests {
            let s = match stp {
                Some(s) => s,
                None => match nx.free_seat() {
                    Some(s) => s,
                    None => return fail(E::SeatsFull),
                },
            };
            if nx.orders.len() >= MAX_ORDERS {
                return fail(E::BookFull);
            }
            rest_seat = Some(s);
        }
        let fee = ceil_fee(base, bps);
        let mut res = PlaceResult {
            order_id: 0,
            filled,
            resting: 0,
            fee,
            cash_out: t_cash + reserve - fee,
            yes_out: t_yes,
            no_out: t_no,
        };
        if rem > 0 {
            if let Some(s) = rest_seat {
                if let Taker::Wallet(o) = taker {
                    if nx.seats[s].owner.is_none() {
                        nx.seats[s] = MSeat { owner: Some(o), ..Default::default() };
                    }
                }
                let ms = &mut nx.seats[s];
                if !a.from_held {
                    ms.locked += rem * per(a.side, a.tick) * TU;
                } else if taker_bid {
                    ms.no_locked += rem;
                } else {
                    ms.yes_locked += rem;
                }
                ms.open += 1;
                nx.orders.push(MOrder { id: nx.next_id, seat: s, side: a.side, tick: a.tick, qty: rem, held: a.from_held, ts: now });
                res.order_id = nx.next_id;
                res.resting = rem;
                nx.next_id += 1;
                st.rested += 1;
            } else {
                if !a.from_held {
                    res.cash_out += rem * per(a.side, a.tick) * TU;
                } else if taker_bid {
                    res.no_out += rem;
                } else {
                    res.yes_out += rem;
                }
                if still_crossing && a.tif != TIF_IOC {
                    st.bound_refunds += 1;
                }
            }
        }
        nx.fees += fee;
        if let Taker::Seat(s) = taker {
            nx.seats[s].cash += res.cash_out;
            nx.seats[s].yes += res.yes_out;
            nx.seats[s].no += res.no_out;
            res.cash_out = 0;
            res.yes_out = 0;
            res.no_out = 0;
        }
        for (x, y) in st.fills.iter_mut().zip(local_fills) {
            *x += y;
        }
        st.stp += local_stp;
        st.partial_maker_fills += local_partial;
        if ticks_hit.len() > 1 {
            st.multi_level_takes += 1;
        }
        *self = nx;
        Ok(res)
    }
}

// ───────────────────────────── harness ─────────────────────────────

struct Harness {
    owners: Vec<Pubkey>,
    cash_in: u128,
    cash_out: u128,
    wy: Vec<u64>,
    wn: Vec<u64>,
}

fn compare(m: &Market, md: &Model, h: &Harness) {
    assert_eq!(m.status, md.status, "status");
    if md.status == STATUS_RESOLVED {
        assert_eq!(m.outcome, md.outcome, "outcome");
    }
    assert_eq!(
        (m.pool, m.yes_total, m.no_total, m.fees, m.volume, m.next_order_id, m.last_trade_tick),
        (md.pool, md.yes_total, md.no_total, md.fees, md.volume, md.next_id, md.last_tick),
        "header"
    );
    assert_eq!(m.trade_count as usize, md.trades.len(), "trade_count");
    assert_eq!(m.trade_head as usize, md.trades.len() % TRADE_RING, "trade_head");
    let eng: Vec<(i64, u32, u8, u8)> = recent_trades(m).iter().map(|t| (t.ts, t.qty, t.tick, t.taker_is_buyer)).collect();
    let exp: Vec<(i64, u32, u8, u8)> = md.trades.iter().rev().take(TRADE_RING).copied().collect();
    assert_eq!(eng, exp, "trade ring");
    for i in 0..MAX_SEATS {
        let s = &m.seats[i];
        let ms = &md.seats[i];
        let owner = ms.owner.map(|o| h.owners[o]).unwrap_or_default();
        assert_eq!(
            (s.owner, s.cash, s.locked, s.yes, s.no, s.yes_locked, s.no_locked, s.open_orders),
            (owner, ms.cash, ms.locked, ms.yes, ms.no, ms.yes_locked, ms.no_locked, ms.open),
            "seat {i}"
        );
    }
    let mut eng: Vec<MOrder> = m
        .orders
        .iter()
        .filter(|o| o.id != 0)
        .map(|o| MOrder { id: o.id, seat: o.seat as usize, side: o.side, tick: o.tick, qty: o.qty, held: o.from_held == 1, ts: o.ts })
        .collect();
    eng.sort_by_key(|o| o.id);
    let mut exp = md.orders.clone();
    exp.sort_by_key(|o| o.id);
    assert_eq!(eng, exp, "resting orders");
    // Level FIFO order (time priority) and aggregated quantities.
    exp.sort_by_key(|o| (o.side, o.tick, o.id));
    let mut fifo = Vec::with_capacity(exp.len());
    for side in [SIDE_BID, SIDE_ASK] {
        let bits = if side == SIDE_BID { m.bid_bits } else { m.ask_bits };
        for t in 1..=MAX_TICK {
            if (bits[(t >> 6) as usize] >> (t & 63)) & 1 == 1 {
                let lvl = if side == SIDE_BID { m.bid_levels[t as usize] } else { m.ask_levels[t as usize] };
                let mut cur = lvl.head;
                while cur != NIL {
                    fifo.push(m.orders[cur as usize].id);
                    cur = m.orders[cur as usize].next;
                }
            }
        }
    }
    assert_eq!(fifo, exp.iter().map(|o| o.id).collect::<Vec<_>>(), "level FIFO order");
    let mbid = md.orders.iter().filter(|o| o.side == SIDE_BID).map(|o| o.tick).max();
    let mask = md.orders.iter().filter(|o| o.side == SIDE_ASK).map(|o| o.tick).min();
    assert_eq!((m.best_bid(), m.best_ask()), (mbid, mask), "best bid/ask");
    if let Some(t) = mbid {
        let q: u64 = md.orders.iter().filter(|o| o.side == SIDE_BID && o.tick == t).map(|o| o.qty).sum();
        assert_eq!(m.level_qty(SIDE_BID, t), q);
    }
    if let Some(t) = mask {
        let q: u64 = md.orders.iter().filter(|o| o.side == SIDE_ASK && o.tick == t).map(|o| o.qty).sum();
        assert_eq!(m.level_qty(SIDE_ASK, t), q);
    }
}

/// SPEC §5 invariants 1–4 and 6 on the engine state + harness balances (5 is the model equality).
fn invariants(m: &Market, h: &Harness) {
    m.check_invariants().unwrap();
    let unit = UNIT as u128;
    let (pool, yt, nt) = (m.pool as u128, m.yes_total as u128, m.no_total as u128);
    match m.status {
        STATUS_OPEN => assert!(pool == yt * unit && pool == nt * unit, "inv1 open"),
        STATUS_RESOLVED => assert_eq!(pool, if m.outcome == 1 { yt } else { nt } * unit, "inv1 resolved"),
        _ => assert_eq!(2 * pool, (yt + nt) * unit, "inv1 void"),
    }
    let seats_cash: u128 = m.seats.iter().map(|s| s.cash as u128 + s.locked as u128).sum();
    assert_eq!(seats_cash + pool + m.fees as u128, h.cash_in - h.cash_out, "inv2 collateral conservation");
    // inv3/inv4: check_invariants recomputes seat escrow, levels, bitmaps and the free list.
    let seat_yes: u128 = m.seats.iter().map(|s| s.yes as u128 + s.yes_locked as u128).sum();
    let seat_no: u128 = m.seats.iter().map(|s| s.no as u128 + s.no_locked as u128).sum();
    let wy: u128 = h.wy.iter().map(|&x| x as u128).sum();
    let wn: u128 = h.wn.iter().map(|&x| x as u128).sum();
    assert_eq!(yt, seat_yes + wy, "inv6 YES supply");
    assert_eq!(nt, seat_no + wn, "inv6 NO supply");
}

/// Run an engine call and the already-computed model result; they must agree. Failing engine
/// calls must not mutate the market.
fn both<T: PartialEq + Debug>(
    m: &mut Market,
    st: &mut Stats,
    model: R<T>,
    eng: impl FnOnce(&mut Market) -> anchor_lang::Result<T>,
) -> Option<T> {
    let before = snapshot(m);
    let got = eng(m).map_err(|e| code(&e));
    if std::env::var("MONTIONS_FUZZ_VERBOSE").is_ok() {
        eprintln!("   {} -> {:?}", std::any::type_name::<T>(), got);
    }
    assert_eq!(got, model, "engine vs model");
    match got {
        Ok(v) => Some(v),
        Err(c) => {
            assert!(before == snapshot(m), "failing call mutated the market (error {c})");
            *st.errors.entry(c).or_default() += 1;
            None
        }
    }
}

fn gen_args(rng: &mut Rng, h: &Harness, owner: usize, held_from: Option<(u64, u64)>) -> PlaceArgs {
    let side = if rng.chance(50) { SIDE_BID } else { SIDE_ASK };
    let tick = match rng.range(0, 99) {
        0..=79 => rng.range(38, 62) as u8,
        80..=96 => rng.range(1, 99) as u8,
        _ => rng.pick(&[0u8, 100, 255]),
    };
    let tif = match rng.range(0, 99) {
        0..=49 => TIF_GTC,
        50..=79 => TIF_IOC,
        80..=98 => TIF_POST_ONLY,
        _ => 3,
    };
    let mut qty = match rng.range(0, 99) {
        0..=89 => rng.range(1, 12),
        90..=96 => rng.range(13, 60),
        _ => rng.pick(&[0, MAX_ORDER_QTY, MAX_ORDER_QTY + 1]),
    };
    let mut from_held = false;
    if rng.chance(35) {
        // Held YES (ask) / held NO (bid) from the wallet or the seat.
        let (hy, hn) = held_from.unwrap_or((h.wy[owner], h.wn[owner]));
        let cap = if side == SIDE_ASK { hy } else { hn };
        if cap > 0 {
            from_held = true;
            qty = rng.range(1, cap.min(15));
        }
    }
    let max_fills = if rng.chance(65) { 0 } else { rng.range(1, 4) as u8 };
    let min_filled = if rng.chance(85) { 0 } else { rng.range(0, qty.min(20)) };
    PlaceArgs { side, tick, qty, tif, from_held, max_fills, min_filled }
}

fn run_seed(seed: u64, ops: usize, st: &mut Stats) {
    let mut rng = Rng::new(seed);
    let n_owners = match seed % 10 {
        7 => 30, // exercises SeatsFull
        3 => 2,  // lots of self-trade prevention
        _ => 6,
    };
    let crowded = seed % 5 == 1; // few cancels, many resting orders → BookFull
    let bps: u16 = rng.pick(&[0, 0, 1, 10, 30, 100]);
    let expiry = T0 + rng.range(250, 900) as i64;
    let mut m = new_market();
    m.expiry = expiry;
    let mut md = Model::new(expiry);
    let mut h = Harness {
        owners: (0..n_owners).map(|i| pk(i as u8 + 1)).collect(),
        cash_in: 0,
        cash_out: 0,
        wy: vec![0; n_owners],
        wn: vec![0; n_owners],
    };
    let mut now = T0;
    compare(&m, &md, &h);
    invariants(&m, &h);

    let verbose = std::env::var("MONTIONS_FUZZ_VERBOSE").is_ok();
    for step in 0..ops {
        now += rng.range(0, 3) as i64;
        if verbose {
            eprintln!("-- step {step} now={now} wy={:?} wn={:?} yes_total={} seats_yes={:?}", h.wy, h.wn, m.yes_total,
                m.seats.iter().filter(|s| s.owner != Pubkey::default()).map(|s| (s.yes, s.yes_locked)).collect::<Vec<_>>());
        }
        st.ops += 1;
        let o = rng.range(0, n_owners as u64 - 1) as usize;
        let key = h.owners[o];
        let settled = md.status != STATUS_OPEN;
        let mut roll = rng.range(0, 999);
        if crowded && (560..700).contains(&roll) && rng.chance(90) {
            roll = 990; // keep the book crowded: burst instead of cancel
        }

        // Settlement events (mostly after expiry, rarely early: the engine does not read time).
        if !settled && ((now >= expiry && roll < 60) || roll == 999) {
            let kind = rng.range(0, 3);
            if kind == 0 {
                both(&mut m, st, md.void(), |m| m.void());
                st.voided += 1;
            } else {
                let yes = kind == 1;
                both(&mut m, st, md.settle(yes), |m| m.settle(yes, 1, now));
                if yes {
                    st.settled_yes += 1;
                } else {
                    st.settled_no += 1;
                }
            }
        } else if settled && roll < 15 {
            if rng.chance(50) {
                both(&mut m, st, md.void(), |m| m.void());
            } else {
                both(&mut m, st, md.settle(true), |m| m.settle(true, 1, now));
            }
        } else if !settled && roll < 8 {
            // Engine-level guards the instruction layer would normally hit first.
            let (y, n) = (rng.range(0, 3), rng.range(0, 3));
            both(&mut m, st, md.redeem(y, n), |m| m.redeem(y, n));
            let s = rng.range(0, MAX_SEATS as u64) as usize;
            both(&mut m, st, md.redeem_seat(s), |m| m.redeem_seat(s));
            let q = md.yes_total.max(md.no_total) + rng.range(1, 3);
            both(&mut m, st, md.merge(q), |m| m.merge(q));
        } else if settled && roll < 350 {
            // Redeem a random part of the wallet.
            let (y, n) = if rng.chance(3) {
                (md.yes_total + 1, 0)
            } else {
                (rng.range(0, h.wy[o]), rng.range(0, h.wn[o]))
            };
            if let Some(v) = both(&mut m, st, md.redeem(y, n), |m| m.redeem(y, n)) {
                h.wy[o] -= y;
                h.wn[o] -= n;
                h.cash_out += v as u128;
            }
        } else if settled && roll < 450 {
            let s = md.find_seat(o).unwrap_or(rng.range(0, MAX_SEATS as u64) as usize);
            both(&mut m, st, md.redeem_seat(s), |m| m.redeem_seat(s));
        } else if roll < 430 {
            // Wallet taker.
            let args = gen_args(&mut rng, &h, o, None);
            let fee = if rng.chance(1) { MAX_FEE_BPS + 1 } else { bps };
            let mr = md.place(Taker::Wallet(o), &args, fee, now, st);
            match Market::required_escrow(&args, fee) {
                Err(_) => {
                    // The instruction would fail before matching; the engine must also reject.
                    both(&mut m, st, mr, |m| m.place_taker(&key, &args, fee, now));
                }
                Ok(e) => {
                    assert!(e.yes <= h.wy[o] && e.no <= h.wn[o]);
                    h.cash_in += e.cash as u128;
                    h.wy[o] -= e.yes;
                    h.wn[o] -= e.no;
                    match both(&mut m, st, mr, |m| m.place_taker(&key, &args, fee, now)) {
                        Some(r) => {
                            h.cash_out += r.cash_out as u128;
                            h.wy[o] += r.yes_out;
                            h.wn[o] += r.no_out;
                        }
                        None => {
                            h.cash_in -= e.cash as u128;
                            h.wy[o] += e.yes;
                            h.wn[o] += e.no;
                        }
                    }
                }
            }
        } else if roll < 520 {
            // Seat-funded order (maker path), on an existing seat or a random index.
            let s = md.find_seat(o).unwrap_or(rng.range(0, MAX_SEATS as u64) as usize);
            let held = if s < MAX_SEATS { Some((md.seats[s].yes, md.seats[s].no)) } else { None };
            let mut args = gen_args(&mut rng, &h, o, held);
            if rng.chance(8) {
                args.from_held = true;
                let (hy, hn) = held.unwrap_or((0, 0));
                args.qty = if args.side == SIDE_ASK { hy } else { hn } + 1;
            }
            let mr = md.place(Taker::Seat(s), &args, bps, now, st);
            both(&mut m, st, mr, |m| m.place_from_seat(s, &args, bps, now));
        } else if roll < 560 {
            // refresh_quotes-like: seat_or_alloc, top up, cancel_all, post a POST_ONLY ladder.
            if let Some(s) = both(&mut m, st, md.seat_or_alloc(o), |m| m.seat_or_alloc(&key)) {
                let amt = rng.range(0, 3) * UNIT;
                if both(&mut m, st, md.credit(s, amt), |m| m.credit_seat_cash(s, amt)).is_some() {
                    h.cash_in += amt as u128;
                }
                both(&mut m, st, md.cancel_all(s), |m| m.cancel_all(s));
                let mid = rng.range(30, 70) as u8;
                for k in 1..=rng.range(1, 3) as u8 {
                    for side in [SIDE_BID, SIDE_ASK] {
                        let tick = if side == SIDE_BID { mid - k } else { mid + k };
                        let held = side == SIDE_ASK && md.seats[s].yes > 0 && rng.chance(50);
                        let qty = if held { md.seats[s].yes.min(5) } else { rng.range(1, 8) };
                        let args = PlaceArgs { side, tick, qty, tif: TIF_POST_ONLY, from_held: held, max_fills: 0, min_filled: 0 };
                        let mr = md.place(Taker::Seat(s), &args, bps, now, st);
                        both(&mut m, st, mr, |m| m.place_from_seat(s, &args, bps, now));
                    }
                }
            }
        } else if roll < if crowded { 580 } else { 680 } {
            // Cancel: usually a live order of this owner, sometimes someone else's / bogus ids.
            let mine: Vec<u64> = md.orders.iter().filter(|x| md.seats[x.seat].owner == Some(o)).map(|x| x.id).collect();
            let id = match rng.range(0, 9) {
                0 => rng.pick(&[0u64, 999_999, md.next_id]),
                1..=2 if !md.orders.is_empty() => md.orders[rng.range(0, md.orders.len() as u64 - 1) as usize].id,
                _ if !mine.is_empty() => mine[rng.range(0, mine.len() as u64 - 1) as usize],
                _ => rng.range(0, md.next_id + 1),
            };
            both(&mut m, st, md.cancel_order(o, id), |m| m.cancel_order(&key, id));
        } else if roll < 700 {
            let s = md.find_seat(o).unwrap_or(rng.range(0, MAX_SEATS as u64 + 1) as usize);
            both(&mut m, st, md.cancel_all(s), |m| m.cancel_all(s));
        } else if roll < 780 {
            let qty = match rng.range(0, 19) {
                0 => rng.pick(&[0, MAX_ORDER_QTY + 1]),
                _ => rng.range(1, 20),
            };
            if let Some(v) = both(&mut m, st, md.split(qty, now), |m| m.split(qty, now)) {
                h.cash_in += v as u128;
                h.wy[o] += qty;
                h.wn[o] += qty;
            }
        } else if roll < 830 {
            let cap = h.wy[o].min(h.wn[o]);
            let qty = if cap == 0 { 0 } else { rng.range(1, cap) };
            if let Some(v) = both(&mut m, st, md.merge(qty), |m| m.merge(qty)) {
                h.wy[o] -= qty;
                h.wn[o] -= qty;
                h.cash_out += v as u128;
            }
        } else if roll < 900 {
            let s = md.find_seat(o).unwrap_or(rng.range(0, MAX_SEATS as u64 + 1) as usize);
            let (c, y, n) = m.take_seat_free(s);
            assert_eq!((c, y, n), md.take_seat_free(s), "take_seat_free");
            h.cash_out += c as u128;
            h.wy[o] += y;
            h.wn[o] += n;
        } else if roll < 960 {
            if let Some(s) = both(&mut m, st, md.seat_or_alloc(o), |m| m.seat_or_alloc(&key)) {
                let amt = rng.range(1, 400) * TU;
                both(&mut m, st, md.credit(s, amt), |m| m.credit_seat_cash(s, amt));
                h.cash_in += amt as u128;
            }
        } else {
            // A burst of non-crossing GTC orders to fill the book.
            for _ in 0..rng.range(1, if crowded { 12 } else { 6 }) {
                let side = if rng.chance(50) { SIDE_BID } else { SIDE_ASK };
                let tick = if side == SIDE_BID { rng.range(1, 30) } else { rng.range(70, 99) } as u8;
                let args = pa(side, tick, rng.range(1, 3), TIF_GTC, false);
                let mr = md.place(Taker::Wallet(o), &args, bps, now, st);
                let e = Market::required_escrow(&args, bps).unwrap();
                h.cash_in += e.cash as u128;
                match both(&mut m, st, mr, |m| m.place_taker(&key, &args, bps, now)) {
                    Some(r) => {
                        h.cash_out += r.cash_out as u128;
                        h.wy[o] += r.yes_out;
                        h.wn[o] += r.no_out;
                    }
                    None => h.cash_in -= e.cash as u128,
                }
            }
        }
        st.max_orders = st.max_orders.max(md.orders.len());
        compare(&m, &md, &h);
        invariants(&m, &h);
    }

    // Drain: settle, unwind every seat and wallet; only fees may remain.
    if md.status == STATUS_OPEN {
        let yes = rng.chance(50);
        both(&mut m, st, md.settle(yes), |m| m.settle(yes, 1, now));
    }
    for s in 0..MAX_SEATS {
        if md.seats[s].owner.is_none() {
            continue;
        }
        both(&mut m, st, md.cancel_all(s), |m| m.cancel_all(s));
        both(&mut m, st, md.redeem_seat(s), |m| m.redeem_seat(s));
        let (c, y, n) = m.take_seat_free(s);
        assert_eq!((c, y, n), md.take_seat_free(s));
        assert_eq!((y, n), (0, 0), "seat inventory redeemed");
        h.cash_out += c as u128;
        compare(&m, &md, &h);
        invariants(&m, &h);
    }
    for o in 0..n_owners {
        let (y, n) = (h.wy[o], h.wn[o]);
        if y + n > 0 {
            let v = both(&mut m, st, md.redeem(y, n), |m| m.redeem(y, n)).unwrap();
            h.wy[o] = 0;
            h.wn[o] = 0;
            h.cash_out += v as u128;
        }
    }
    compare(&m, &md, &h);
    invariants(&m, &h);
    assert_eq!((m.pool, m.yes_total, m.no_total), (0, 0, 0), "everything redeemed");
    assert!(m.seats.iter().all(|s| *s == Seat::default()), "all seats freed");
    assert_ne!(m.free_head, NIL);
    assert_eq!(h.cash_in - h.cash_out, m.fees as u128, "only fees remain in the vault");
}

#[test]
fn differential_fuzz_against_reference_model() {
    let seeds: u64 = std::env::var("MONTIONS_FUZZ_SEEDS").ok().and_then(|v| v.parse().ok()).unwrap_or(2000);
    let ops: usize = std::env::var("MONTIONS_FUZZ_OPS").ok().and_then(|v| v.parse().ok()).unwrap_or(300);
    let t = std::time::Instant::now();
    let mut st = Stats::default();
    let first: u64 = std::env::var("MONTIONS_FUZZ_FIRST").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    for seed in first..first + seeds {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_seed(seed, ops, &mut st)));
        if let Err(e) = r {
            eprintln!("FAILED at seed {seed} (rerun: MONTIONS_FUZZ_FIRST={seed} MONTIONS_FUZZ_SEEDS=1 MONTIONS_FUZZ_VERBOSE=1)");
            std::panic::resume_unwind(e);
        }
    }
    println!("engine fuzz: {seeds} seeds x {ops} ops in {:?}", t.elapsed());
    println!("{st:#?}");
    if seeds >= 100 {
        // Coverage: every fill case for both taker sides, STP, bound refunds, every error path.
        for (i, n) in st.fills.iter().enumerate() {
            assert!(*n > 0, "fill combination {i} never exercised");
        }
        assert!(st.stp > 0 && st.bound_refunds > 0 && st.partial_maker_fills > 0 && st.multi_level_takes > 0);
        assert!(st.settled_yes > 0 && st.settled_no > 0 && st.voided > 0);
        for e in [
            E::BadTick,
            E::BadQty,
            E::BadArgs,
            E::MarketNotOpen,
            E::Expired,
            E::AlreadySettled,
            E::NotSettled,
            E::OrderNotOpen,
            E::NotOrderOwner,
            E::InsufficientCash,
            E::InsufficientTokens,
            E::WouldCross,
            E::BookFull,
            E::SeatsFull,
            E::MinFillNotMet,
            E::FeeTooHigh,
        ] {
            let c = ecode(e);
            assert!(st.errors.get(&c).copied().unwrap_or(0) > 0, "error path {c} never exercised");
        }
    }
}
