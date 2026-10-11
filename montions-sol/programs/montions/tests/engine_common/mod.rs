//! Shared helpers for the engine host tests (`tests/engine_*.rs`).
#![allow(dead_code)]
use anchor_lang::prelude::*;
use montions::constants::*;
use montions::errors::MontionsError;
use montions::state::*;

pub const T0: i64 = 1_760_000_000;
pub const EXPIRY: i64 = T0 + 3_600;
pub const TU: u64 = TICK_UNIT;

/// A zeroed market (boxed, never on the stack) with identity fields and `init_book()`.
pub fn new_market() -> Box<Market> {
    let mut m: Box<Market> = Box::new(bytemuck::Zeroable::zeroed());
    m.asset = Pubkey::new_from_array([0xA5; 32]);
    m.strike = 15_000_000_000;
    m.expiry = EXPIRY;
    m.created_at = T0 - 60;
    m.init_book();
    m
}

/// Deterministic test owner keys (never the default key).
pub fn pk(i: u8) -> Pubkey {
    let mut b = [0u8; 32];
    b[0] = 0x42;
    b[1] = i;
    Pubkey::new_from_array(b)
}

pub fn code(e: &anchor_lang::error::Error) -> u32 {
    match e {
        anchor_lang::error::Error::AnchorError(a) => a.error_code_number,
        anchor_lang::error::Error::ProgramError(p) => panic!("unexpected program error {p:?}"),
    }
}

pub fn ecode(e: MontionsError) -> u32 {
    u32::from(e)
}

pub fn snapshot(m: &Market) -> Vec<u8> {
    bytemuck::bytes_of(m).to_vec()
}

pub fn pa(side: u8, tick: u8, qty: u64, tif: u8, from_held: bool) -> PlaceArgs {
    PlaceArgs { side, tick, qty, tif, from_held, max_fills: 0, min_filled: 0 }
}

/// Cash bid (buy YES), GTC.
pub fn bid(tick: u8, qty: u64) -> PlaceArgs {
    pa(SIDE_BID, tick, qty, TIF_GTC, false)
}
/// Write ask (sell YES you don't hold = buy NO), GTC.
pub fn ask(tick: u8, qty: u64) -> PlaceArgs {
    pa(SIDE_ASK, tick, qty, TIF_GTC, false)
}
/// Close-NO bid (sell held NO at >= 100 - tick), GTC.
pub fn held_bid(tick: u8, qty: u64) -> PlaceArgs {
    pa(SIDE_BID, tick, qty, TIF_GTC, true)
}
/// Sell held YES at >= tick, GTC.
pub fn held_ask(tick: u8, qty: u64) -> PlaceArgs {
    pa(SIDE_ASK, tick, qty, TIF_GTC, true)
}

pub fn with_tif(mut a: PlaceArgs, tif: u8) -> PlaceArgs {
    a.tif = tif;
    a
}

/// Run `f`, require it to fail with `err`, and require the market bytes to be unchanged.
pub fn expect_err<T: std::fmt::Debug>(
    m: &mut Market,
    err: MontionsError,
    f: impl FnOnce(&mut Market) -> Result<T>,
) {
    let before = snapshot(m);
    let want = ecode(err);
    match f(m) {
        Ok(v) => panic!("expected error {want}, got Ok({v:?})"),
        Err(e) => assert_eq!(code(&e), want, "wrong error: {e:?}"),
    }
    assert!(before == snapshot(m), "market mutated by a failing call");
}

/// Seat balances as a tuple `(cash, locked, yes, no, yes_locked, no_locked, open_orders)`.
pub fn seat_of(m: &Market, owner: &Pubkey) -> (u64, u64, u64, u64, u64, u64, u32) {
    match m.find_seat(owner) {
        None => (0, 0, 0, 0, 0, 0, 0),
        Some(i) => {
            let s = &m.seats[i];
            (s.cash, s.locked, s.yes, s.no, s.yes_locked, s.no_locked, s.open_orders)
        }
    }
}

/// Live orders of one level in FIFO order, as `(id, qty)`.
pub fn level_orders(m: &Market, side: u8, tick: u8) -> Vec<(u64, u64)> {
    let lvl = if side == SIDE_BID { m.bid_levels[tick as usize] } else { m.ask_levels[tick as usize] };
    let mut out = Vec::new();
    let mut cur = lvl.head;
    while cur != NIL {
        let o = &m.orders[cur as usize];
        out.push((o.id, o.qty));
        cur = o.next;
        assert!(out.len() <= MAX_ORDERS);
    }
    out
}

/// Trades newest first.
pub fn recent_trades(m: &Market) -> Vec<Trade> {
    let n = (m.trade_count as usize).min(TRADE_RING);
    (0..n).map(|i| m.trades[(m.trade_head as usize + TRADE_RING - 1 - i) % TRADE_RING]).collect()
}

/// Order with a given id.
pub fn order_by_id(m: &Market, id: u64) -> Option<Order> {
    m.orders.iter().copied().find(|o| o.id == id && id != 0)
}

/// Tiny deterministic PRNG (xorshift64*).
#[derive(Clone)]
pub struct Rng(pub u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03 | 1)
    }
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }
    /// True with probability `pct` percent.
    pub fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
    pub fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[(self.next() % xs.len() as u64) as usize]
    }
}
