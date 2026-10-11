//! Unit tests for every engine rule in docs/SPEC.md §5 (exact cash / token deltas).
use montions::constants::*;
use montions::errors::MontionsError as E;
use montions::state::*;

mod engine_common;
use engine_common::*;

const NOW: i64 = T0;

fn a() -> anchor_lang::prelude::Pubkey {
    pk(1)
}
fn b() -> anchor_lang::prelude::Pubkey {
    pk(2)
}
fn c() -> anchor_lang::prelude::Pubkey {
    pk(3)
}

fn ok(m: &Market) {
    m.check_invariants().unwrap();
}

/// Place from a wallet with fee 0 and return the result (panics on error).
fn take(m: &mut Market, who: &anchor_lang::prelude::Pubkey, args: PlaceArgs) -> PlaceResult {
    let r = m.place_taker(who, &args, 0, NOW).unwrap();
    ok(m);
    r
}

// ───────────────────────────── escrow / args ─────────────────────────────

#[test]
fn required_escrow_per_intent() {
    let e = Market::required_escrow(&bid(30, 7), 0).unwrap();
    assert_eq!(e, Escrow { cash: 7 * 30 * TU, yes: 0, no: 0 });
    let e = Market::required_escrow(&ask(30, 7), 0).unwrap();
    assert_eq!(e, Escrow { cash: 7 * 70 * TU, yes: 0, no: 0 });
    let e = Market::required_escrow(&held_bid(30, 7), 50).unwrap();
    assert_eq!(e, Escrow { cash: 0, yes: 0, no: 7 });
    let e = Market::required_escrow(&held_ask(30, 7), 50).unwrap();
    assert_eq!(e, Escrow { cash: 0, yes: 7, no: 0 });
    // Fee reserve: ceil(escrow * bps / 10_000) for cash-backed GTC / IOC.
    let e = Market::required_escrow(&bid(30, 7), 25).unwrap();
    assert_eq!(e.cash, 2_100_000 + 5_250);
    let e = Market::required_escrow(&with_tif(ask(30, 7), TIF_IOC), 100).unwrap();
    assert_eq!(e.cash, 4_900_000 + 49_000);
    // POST_ONLY can never take → no reserve.
    let e = Market::required_escrow(&with_tif(bid(30, 7), TIF_POST_ONLY), 100).unwrap();
    assert_eq!(e.cash, 2_100_000);
}

#[test]
fn bad_args_rejected_without_mutation() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 5));
    let o = a();
    expect_err(&mut m, E::BadTick, |m| m.place_taker(&o, &bid(0, 1), 0, NOW));
    expect_err(&mut m, E::BadTick, |m| m.place_taker(&o, &bid(100, 1), 0, NOW));
    expect_err(&mut m, E::BadQty, |m| m.place_taker(&o, &bid(50, 0), 0, NOW));
    expect_err(&mut m, E::BadQty, |m| m.place_taker(&o, &bid(50, MAX_ORDER_QTY + 1), 0, NOW));
    expect_err(&mut m, E::BadArgs, |m| m.place_taker(&o, &pa(2, 50, 1, TIF_GTC, false), 0, NOW));
    expect_err(&mut m, E::BadArgs, |m| m.place_taker(&o, &pa(SIDE_BID, 50, 1, 3, false), 0, NOW));
    expect_err(&mut m, E::FeeTooHigh, |m| m.place_taker(&o, &bid(50, 1), MAX_FEE_BPS + 1, NOW));
    expect_err(&mut m, E::BadArgs, |m| m.place_taker(&Default::default(), &bid(50, 1), 0, NOW));
    assert_eq!(code(&Market::required_escrow(&bid(0, 1), 0).unwrap_err()), ecode(E::BadTick));
    // MAX_ORDER_QTY itself is fine.
    let r = take(&mut m, &b(), with_tif(bid(1, MAX_ORDER_QTY), TIF_POST_ONLY));
    assert_eq!(r.resting, MAX_ORDER_QTY);
}

// ───────────────────────────── the four fill cases ─────────────────────────────

#[test]
fn case1_cash_bid_taker_vs_write_ask_maker() {
    let mut m = new_market();
    let r = take(&mut m, &a(), ask(60, 10));
    assert_eq!(r, PlaceResult { order_id: 1, filled: 0, resting: 10, fee: 0, cash_out: 0, yes_out: 0, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (0, 10 * 40 * TU, 0, 0, 0, 0, 1));

    let r = take(&mut m, &b(), bid(65, 4));
    // B escrowed 4*65 ticks, paid 4*60, refund 4*5 ticks; receives 4 minted YES.
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 5 * TU, yes_out: 4, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (0, 6 * 40 * TU, 0, 4, 0, 0, 1));
    assert_eq!(m.find_seat(&b()), None, "a pure taker gets no seat");
    assert_eq!((m.pool, m.yes_total, m.no_total), (4 * UNIT, 4, 4));
    assert_eq!(order_by_id(&m, 1).unwrap().qty, 6);
    assert_eq!((m.volume, m.last_trade_tick, m.trade_count, m.trade_head), (4, 60, 1, 1));
    let t = m.trades[0];
    assert_eq!((t.ts, t.qty, t.tick, t.taker_is_buyer), (NOW, 4, 60, 1));
}

#[test]
fn case1_write_ask_taker_vs_cash_bid_maker() {
    let mut m = new_market();
    take(&mut m, &a(), bid(40, 10));
    assert_eq!(seat_of(&m, &a()), (0, 10 * 40 * TU, 0, 0, 0, 0, 1));
    let r = take(&mut m, &b(), ask(35, 4));
    // B escrowed 4*65, consumed 4*60, refund 4*(40-35); receives 4 minted NO.
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 5 * TU, yes_out: 0, no_out: 4 });
    assert_eq!(seat_of(&m, &a()), (0, 6 * 40 * TU, 4, 0, 0, 0, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (4 * UNIT, 4, 4));
    assert_eq!(m.trades[0].taker_is_buyer, 0);
    assert_eq!(m.trades[0].tick, 40);
}

#[test]
fn case2_cash_bid_taker_vs_held_yes_ask_maker() {
    let mut m = new_market();
    m.split(10, NOW).unwrap(); // A's wallet: 10 YES + 10 NO
    let r = take(&mut m, &a(), held_ask(55, 6));
    assert_eq!((r.resting, r.cash_out, r.yes_out), (6, 0, 0));
    assert_eq!(seat_of(&m, &a()), (0, 0, 0, 0, 6, 0, 1));
    let r = take(&mut m, &b(), bid(60, 4));
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 5 * TU, yes_out: 4, no_out: 0 });
    // A receives 4*55 ticks; YES moved, nothing minted.
    assert_eq!(seat_of(&m, &a()), (4 * 55 * TU, 0, 0, 0, 2, 0, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (10 * UNIT, 10, 10));
}

#[test]
fn case2_held_yes_ask_taker_vs_cash_bid_maker() {
    let mut m = new_market();
    take(&mut m, &a(), bid(45, 5));
    m.split(10, NOW).unwrap(); // B's wallet
    let r = take(&mut m, &b(), held_ask(40, 3));
    // B sells 3 YES at the resting 45 (price improvement over 40 is inside the proceeds).
    assert_eq!(r, PlaceResult { order_id: 0, filled: 3, resting: 0, fee: 0, cash_out: 3 * 45 * TU, yes_out: 0, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (0, 2 * 45 * TU, 3, 0, 0, 0, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (10 * UNIT, 10, 10));
}

#[test]
fn case3_held_no_bid_taker_vs_write_ask_maker() {
    let mut m = new_market();
    take(&mut m, &a(), ask(70, 5));
    m.split(10, NOW).unwrap(); // B's wallet
    let r = take(&mut m, &b(), held_bid(75, 4));
    // B sells 4 NO at 100-70 = 30 (limit 100-75 = 25), paid from A's write escrow.
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 30 * TU, yes_out: 0, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (0, 30 * TU, 0, 4, 0, 0, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (10 * UNIT, 10, 10));
    assert_eq!(m.trades[0].taker_is_buyer, 1);
}

#[test]
fn case3_write_ask_taker_vs_held_no_bid_maker() {
    let mut m = new_market();
    m.split(10, NOW).unwrap(); // A's wallet
    let r = take(&mut m, &a(), held_bid(30, 5));
    assert_eq!(r.resting, 5);
    assert_eq!(seat_of(&m, &a()), (0, 0, 0, 0, 0, 5, 1));
    let r = take(&mut m, &b(), ask(25, 4));
    // B escrowed 4*75, consumed 4*70 (paid to A), refund 4*5; receives A's 4 NO.
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 5 * TU, yes_out: 0, no_out: 4 });
    assert_eq!(seat_of(&m, &a()), (4 * 70 * TU, 0, 0, 0, 0, 1, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (10 * UNIT, 10, 10));
}

#[test]
fn case4_held_no_bid_taker_vs_held_yes_ask_maker() {
    let mut m = new_market();
    m.split(10, NOW).unwrap(); // A
    m.split(10, NOW).unwrap(); // B
    take(&mut m, &a(), held_ask(60, 5));
    let r = take(&mut m, &b(), held_bid(65, 4));
    // Burn 4 pairs: A gets 4*60, B gets 4*40.
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 40 * TU, yes_out: 0, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (4 * 60 * TU, 0, 0, 0, 1, 0, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (16 * UNIT, 16, 16));
}

#[test]
fn case4_held_yes_ask_taker_vs_held_no_bid_maker() {
    let mut m = new_market();
    m.split(10, NOW).unwrap();
    m.split(10, NOW).unwrap();
    take(&mut m, &a(), held_bid(35, 5));
    let r = take(&mut m, &b(), held_ask(30, 4));
    assert_eq!(r, PlaceResult { order_id: 0, filled: 4, resting: 0, fee: 0, cash_out: 4 * 35 * TU, yes_out: 0, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (4 * 65 * TU, 0, 0, 0, 0, 1, 1));
    assert_eq!((m.pool, m.yes_total, m.no_total), (16 * UNIT, 16, 16));
}

// ───────────────────────────── priority, price improvement ─────────────────────────────

#[test]
fn walks_levels_best_first_with_price_improvement_and_rests_remainder() {
    let mut m = new_market();
    take(&mut m, &a(), ask(65, 2)); // id 1
    take(&mut m, &a(), ask(60, 3)); // id 2
    take(&mut m, &c(), ask(62, 3)); // id 3
    take(&mut m, &c(), ask(75, 5)); // id 4
    assert_eq!(m.best_ask(), Some(60));
    let r = take(&mut m, &b(), bid(70, 10));
    assert_eq!((r.filled, r.resting, r.order_id), (8, 2, 5));
    // escrow 10*70; paid 3*60 + 3*62 + 2*65 = 496 ticks; 2*70 ticks rest in B's seat.
    assert_eq!(r.cash_out, (700 - 496 - 140) * TU);
    assert_eq!(r.yes_out, 8);
    assert_eq!(seat_of(&m, &b()), (0, 2 * 70 * TU, 0, 0, 0, 0, 1));
    assert_eq!(m.best_bid(), Some(70));
    assert_eq!(m.best_ask(), Some(75));
    let ticks: Vec<u8> = recent_trades(&m).iter().rev().map(|t| t.tick).collect();
    assert_eq!(ticks, vec![60, 62, 65]);
    assert_eq!(m.last_trade_tick, 65);
}

#[test]
fn fifo_within_a_level() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 3)); // id 1
    take(&mut m, &c(), ask(60, 3)); // id 2
    take(&mut m, &a(), ask(60, 1)); // id 3
    assert_eq!(level_orders(&m, SIDE_ASK, 60), vec![(1, 3), (2, 3), (3, 1)]);
    assert_eq!(m.level_qty(SIDE_ASK, 60), 7);
    let r = take(&mut m, &b(), bid(60, 4));
    assert_eq!(r.filled, 4);
    assert_eq!(level_orders(&m, SIDE_ASK, 60), vec![(2, 2), (3, 1)]);
    assert_eq!(seat_of(&m, &a()).3, 3);
    assert_eq!(seat_of(&m, &c()).3, 1);
    // A new order at the same tick joins the tail.
    take(&mut m, &a(), ask(60, 2));
    assert_eq!(level_orders(&m, SIDE_ASK, 60), vec![(2, 2), (3, 1), (4, 2)]);
}

#[test]
fn bitmaps_across_word_boundary() {
    let mut m = new_market();
    for t in [1u8, 63, 64, 99] {
        take(&mut m, &a(), with_tif(ask(t, 1), TIF_POST_ONLY));
    }
    assert_eq!(m.best_ask(), Some(1));
    assert_eq!(m.ask_bits, [(1u64 << 1) | (1u64 << 63), 1u64 | (1u64 << 35)]);
    let mut m = new_market();
    for t in [1u8, 63, 64, 99] {
        take(&mut m, &a(), with_tif(bid(t, 1), TIF_POST_ONLY));
    }
    assert_eq!(m.best_bid(), Some(99));
    // Cancel 99 then 64: best bid walks down across the word boundary.
    let id99 = level_orders(&m, SIDE_BID, 99)[0].0;
    let id64 = level_orders(&m, SIDE_BID, 64)[0].0;
    m.cancel_order(&a(), id99).unwrap();
    assert_eq!(m.best_bid(), Some(64));
    m.cancel_order(&a(), id64).unwrap();
    assert_eq!(m.best_bid(), Some(63));
    assert_eq!(m.level_qty(SIDE_BID, 64), 0);
    assert_eq!(m.level_qty(SIDE_BID, 63), 1);
    assert_eq!(m.level_qty(SIDE_BID, 0), 0);
    assert_eq!(m.level_qty(7, 63), 0);
    ok(&m);
}

// ───────────────────────────── STP, TIF, max_fills, min_filled ─────────────────────────────

#[test]
fn self_trade_prevention_cancels_own_resting_order() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 5)); // id 1 (A)
    take(&mut m, &c(), ask(61, 5)); // id 2 (C)
    let r = take(&mut m, &a(), bid(62, 7));
    // A's own ask is cancelled (escrow 5*40 → A's free cash), then 5 fill at 61, 2 rest at 62.
    assert_eq!((r.filled, r.resting, r.order_id), (5, 2, 3));
    assert_eq!(r.cash_out, 7 * 62 * TU - 5 * 61 * TU - 2 * 62 * TU);
    assert_eq!(seat_of(&m, &a()), (5 * 40 * TU, 2 * 62 * TU, 0, 0, 0, 0, 1));
    assert!(order_by_id(&m, 1).is_none());
    assert_eq!(m.trade_count, 1, "STP cancels are not trades");
}

#[test]
fn stp_counts_toward_max_fills_and_still_crossing_gtc_does_not_rest() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 5)); // own
    take(&mut m, &c(), ask(61, 5));
    let mut args = bid(62, 3);
    args.max_fills = 1;
    let r = take(&mut m, &a(), args);
    // The single attempt is spent on the STP cancel; C's ask at 61 still crosses → refund all.
    assert_eq!(r, PlaceResult { order_id: 0, filled: 0, resting: 0, fee: 0, cash_out: 3 * 62 * TU, yes_out: 0, no_out: 0 });
    assert_eq!(seat_of(&m, &a()), (5 * 40 * TU, 0, 0, 0, 0, 0, 0));
    assert_eq!(m.next_order_id, 3);
    assert_eq!(m.best_bid(), None);
}

#[test]
fn max_fills_bound_while_crossing_vs_not_crossing() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 1));
    take(&mut m, &c(), ask(60, 1));
    take(&mut m, &a(), ask(61, 1));
    // Bound hit with 61 still crossing a 62 bid → GTC remainder refunded, resting = 0.
    let mut args = bid(62, 5);
    args.max_fills = 2;
    let r = take(&mut m, &b(), args);
    assert_eq!((r.filled, r.resting, r.order_id), (2, 0, 0));
    assert_eq!(r.cash_out, 5 * 62 * TU - 2 * 60 * TU);
    assert_eq!(m.best_bid(), None);
    assert_eq!(m.best_ask(), Some(61));

    // Bound hit exactly when the book stops crossing → the remainder rests.
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 1));
    take(&mut m, &c(), ask(60, 1));
    take(&mut m, &a(), ask(61, 1));
    let mut args = bid(60, 5);
    args.max_fills = 2;
    let r = take(&mut m, &b(), args);
    assert_eq!((r.filled, r.resting), (2, 3));
    assert_eq!(m.best_bid(), Some(60));

    // max_fills = 0 means 32.
    let mut m = new_market();
    for i in 0..40u64 {
        take(&mut m, &if i % 2 == 0 { a() } else { c() }, ask(50, 1));
    }
    let r = take(&mut m, &b(), with_tif(bid(50, 40), TIF_IOC));
    assert_eq!(r.filled, DEFAULT_MAX_FILLS as u64);
    assert_eq!(m.level_qty(SIDE_ASK, 50), 8);
}

#[test]
fn ioc_refunds_remainder_cash_and_tokens() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 3));
    let r = take(&mut m, &b(), with_tif(bid(65, 10), TIF_IOC));
    assert_eq!((r.filled, r.resting, r.order_id), (3, 0, 0));
    assert_eq!(r.cash_out, 10 * 65 * TU - 3 * 60 * TU);
    assert_eq!(m.next_order_id, 2);
    assert_eq!(m.find_seat(&b()), None);
    // IOC held sell with nothing to hit: all tokens come back.
    m.split(5, NOW).unwrap();
    let r = take(&mut m, &b(), with_tif(held_ask(50, 5), TIF_IOC));
    assert_eq!(r, PlaceResult { yes_out: 5, ..Default::default() });
    let r = take(&mut m, &b(), with_tif(held_bid(50, 5), TIF_IOC));
    assert_eq!(r, PlaceResult { no_out: 5, ..Default::default() });
}

#[test]
fn post_only_rests_or_errors_without_mutation() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 3));
    let o = b();
    expect_err(&mut m, E::WouldCross, |m| m.place_taker(&o, &with_tif(bid(60, 1), TIF_POST_ONLY), 0, NOW));
    expect_err(&mut m, E::WouldCross, |m| m.place_taker(&o, &with_tif(bid(99, 1), TIF_POST_ONLY), 0, NOW));
    // Crossing one's own order is also a cross for POST_ONLY.
    let o = a();
    expect_err(&mut m, E::WouldCross, |m| m.place_taker(&o, &with_tif(bid(61, 1), TIF_POST_ONLY), 0, NOW));
    let r = take(&mut m, &b(), with_tif(bid(59, 4), TIF_POST_ONLY));
    assert_eq!((r.filled, r.resting, r.order_id, r.cash_out), (0, 4, 2, 0));
    // POST_ONLY on a seat: the maker path.
    let s = m.seat_or_alloc(&c()).unwrap();
    m.credit_seat_cash(s, 10 * UNIT).unwrap();
    expect_err(&mut m, E::WouldCross, |m| m.place_from_seat(s, &with_tif(ask(59, 1), TIF_POST_ONLY), 30, NOW));
    let r = m.place_from_seat(s, &with_tif(ask(61, 2), TIF_POST_ONLY), 30, NOW).unwrap();
    assert_eq!((r.resting, r.fee), (2, 0));
    assert_eq!(seat_of(&m, &c()), (10 * UNIT - 2 * 39 * TU, 2 * 39 * TU, 0, 0, 0, 0, 1));
    ok(&m);
}

#[test]
fn min_filled_guard() {
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 3));
    let mut args = bid(65, 10);
    args.min_filled = 4;
    let o = b();
    expect_err(&mut m, E::MinFillNotMet, |m| m.place_taker(&o, &args, 0, NOW));
    args.min_filled = 3;
    let r = take(&mut m, &b(), args);
    assert_eq!((r.filled, r.resting), (3, 7));
}

// ───────────────────────────── fees ─────────────────────────────

#[test]
fn fee_on_cash_bid_with_reserve_refund() {
    let mut m = new_market();
    let bps = 30;
    // Maker: GTC that rests fully pays no fee; its reserve comes straight back.
    let e = Market::required_escrow(&ask(60, 10), bps).unwrap();
    let r = m.place_taker(&a(), &ask(60, 10), bps, NOW).unwrap();
    assert_eq!((r.fee, r.cash_out), (0, e.cash - 10 * 40 * TU));
    // Taker: base = 4*60 ticks over two fills; one fee per order.
    take(&mut m, &c(), ask(60, 1));
    let args = bid(65, 5);
    let e = Market::required_escrow(&args, bps).unwrap();
    let reserve = (5 * 65 * TU) * 30 / 10_000;
    assert_eq!(e.cash, 5 * 65 * TU + reserve);
    let r = m.place_taker(&b(), &args, bps, NOW).unwrap();
    let base = 5 * 60 * TU;
    let fee = (base * 30).div_ceil(10_000);
    assert_eq!(r.fee, fee);
    assert_eq!(r.cash_out, 5 * 5 * TU + reserve - fee);
    assert_eq!(m.fees, fee);
    ok(&m);
}

#[test]
fn fee_on_write_ask_and_held_sells_from_proceeds() {
    let bps = 100;
    // Write ask: base = f*(100-p).
    let mut m = new_market();
    take(&mut m, &a(), bid(40, 10));
    let args = ask(35, 4);
    let e = Market::required_escrow(&args, bps).unwrap();
    let r = m.place_taker(&b(), &args, bps, NOW).unwrap();
    let fee = 4 * 60 * TU / 100;
    assert_eq!(r.fee, fee);
    assert_eq!(r.cash_out, e.cash - 4 * 60 * TU - fee);
    assert_eq!(m.fees, fee);
    ok(&m);

    // Held YES sell: fee deducted from proceeds f*p.
    let mut m = new_market();
    take(&mut m, &a(), bid(45, 5));
    m.split(10, NOW).unwrap();
    let r = m.place_taker(&b(), &held_ask(40, 3), bps, NOW).unwrap();
    let proceeds = 3 * 45 * TU;
    assert_eq!(r.fee, proceeds / 100);
    assert_eq!(r.cash_out, proceeds - proceeds / 100);
    ok(&m);

    // Close-NO: fee from proceeds f*(100-p).
    let mut m = new_market();
    take(&mut m, &a(), ask(70, 5));
    m.split(10, NOW).unwrap();
    let r = m.place_taker(&b(), &held_bid(75, 4), bps, NOW).unwrap();
    let proceeds = 4 * 30 * TU;
    assert_eq!((r.fee, r.cash_out), (proceeds / 100, proceeds - proceeds / 100));
    assert_eq!(m.fees, proceeds / 100);
    ok(&m);

    // Fee arithmetic is a single ceil over the order (amounts are multiples of TICK_UNIT, so with
    // TICK_UNIT == 10_000 the ceil is exact; check the u128 ceil helper behaviour on the reserve).
    let e = Market::required_escrow(&bid(1, 1), 1).unwrap();
    assert_eq!(e.cash, TU + 1);
}

#[test]
fn place_from_seat_fills_credit_the_seat_and_fee_comes_from_seat() {
    let mut m = new_market();
    take(&mut m, &b(), ask(60, 5)); // B writes
    let s = m.seat_or_alloc(&a()).unwrap();
    m.credit_seat_cash(s, 5 * UNIT).unwrap();
    let bps = 50;
    let args = with_tif(bid(62, 3), TIF_IOC);
    let e = Market::required_escrow(&args, bps).unwrap();
    let r = m.place_from_seat(s, &args, bps, NOW).unwrap();
    let fee = 3 * 60 * TU * 50 / 10_000;
    assert_eq!(r, PlaceResult { order_id: 0, filled: 3, resting: 0, fee, cash_out: 0, yes_out: 0, no_out: 0 });
    let _ = e;
    assert_eq!(seat_of(&m, &a()), (5 * UNIT - 3 * 60 * TU - fee, 0, 3, 0, 0, 0, 0));
    ok(&m);
    // From-seat balance checks.
    expect_err(&mut m, E::InsufficientCash, |m| m.place_from_seat(s, &bid(99, 1000), 0, NOW));
    expect_err(&mut m, E::InsufficientTokens, |m| m.place_from_seat(s, &held_ask(50, 4), 0, NOW));
    expect_err(&mut m, E::InsufficientTokens, |m| m.place_from_seat(s, &held_bid(50, 1), 0, NOW));
    expect_err(&mut m, E::BadArgs, |m| m.place_from_seat(MAX_SEATS, &bid(10, 1), 0, NOW));
    expect_err(&mut m, E::BadArgs, |m| m.place_from_seat(s + 5, &bid(10, 1), 0, NOW));
    // Held ask from seat inventory rests in yes_locked.
    let r = m.place_from_seat(s, &held_ask(70, 3), 0, NOW).unwrap();
    assert_eq!(r.resting, 3);
    assert_eq!(seat_of(&m, &a()).4, 3);
    ok(&m);
}

// ───────────────────────────── capacity ─────────────────────────────

#[test]
fn book_full() {
    let mut m = new_market();
    for i in 0..MAX_ORDERS as u64 {
        let r = take(&mut m, &a(), with_tif(bid(1 + (i % 40) as u8, 1), TIF_POST_ONLY));
        assert_eq!(r.resting, 1);
    }
    assert_eq!(m.free_head, NIL);
    let o = b();
    expect_err(&mut m, E::BookFull, |m| m.place_taker(&o, &bid(10, 1), 0, NOW));
    expect_err(&mut m, E::BookFull, |m| m.place_taker(&o, &ask(90, 1), 0, NOW));
    // IOC needs no slot; nothing crosses → full refund.
    let r = take(&mut m, &b(), with_tif(bid(10, 1), TIF_IOC));
    assert_eq!(r.cash_out, 10 * TU);
    // A GTC that frees a slot by filling can rest its remainder in it.
    let r = take(&mut m, &b(), ask(40, 3));
    assert_eq!((r.filled, r.resting), (1, 2));
    assert_eq!(m.free_head, NIL);
    // Fully filled GTC needs no slot.
    let r = take(&mut m, &c(), ask(39, 1));
    assert_eq!((r.filled, r.resting), (1, 0));
    assert_ne!(m.free_head, NIL);
}

#[test]
fn seats_full() {
    let mut m = new_market();
    for i in 0..MAX_SEATS as u8 {
        take(&mut m, &pk(100 + i), with_tif(ask(90, 1), TIF_POST_ONLY));
    }
    let o = pk(200);
    expect_err(&mut m, E::SeatsFull, |m| m.place_taker(&o, &bid(10, 1), 0, NOW));
    expect_err(&mut m, E::SeatsFull, |m| m.seat_or_alloc(&o));
    // Takers that do not rest need no seat.
    let r = take(&mut m, &pk(200), with_tif(bid(10, 1), TIF_IOC));
    assert_eq!(r.resting, 0);
    let r = take(&mut m, &pk(200), bid(90, 2));
    assert_eq!((r.filled, r.resting), (2, 0));
    // A seat freed by take_seat_free becomes available again.
    // (pk(100) and pk(101) were filled by the bid above; pk(110) still rests.)
    let s = m.find_seat(&pk(110)).unwrap();
    let id = m.orders.iter().find(|o| o.id != 0 && o.seat as usize == s).unwrap().id;
    m.cancel_order(&pk(110), id).unwrap();
    assert_eq!(m.take_seat_free(s), (10 * TU, 0, 0));
    assert_eq!(m.seats[s], Seat::default());
    let r = take(&mut m, &pk(200), bid(10, 1));
    assert_eq!(r.resting, 1);
    assert_eq!(m.find_seat(&pk(200)), Some(s));
}

// ───────────────────────────── lifecycle ─────────────────────────────

#[test]
fn trading_window_and_status() {
    let mut m = new_market();
    let o = a();
    expect_err(&mut m, E::Expired, |m| m.place_taker(&o, &bid(10, 1), 0, EXPIRY));
    expect_err(&mut m, E::Expired, |m| m.split(1, EXPIRY));
    let s = m.seat_or_alloc(&o).unwrap();
    m.credit_seat_cash(s, UNIT).unwrap();
    expect_err(&mut m, E::Expired, |m| m.place_from_seat(s, &bid(10, 1), 0, EXPIRY + 5));
    m.place_taker(&o, &bid(10, 1), 0, EXPIRY - 1).unwrap();
    m.split(3, EXPIRY - 1).unwrap();
    // Merge works after expiry while Open.
    assert_eq!(m.merge(2).unwrap(), 2 * UNIT);
    expect_err(&mut m, E::InsufficientTokens, |m| m.merge(2));
    expect_err(&mut m, E::BadQty, |m| m.merge(0));
    m.settle(true, 15_100_000_000, EXPIRY + 2).unwrap();
    assert_eq!((m.status, m.outcome, m.settle_price, m.settle_publish_time), (STATUS_RESOLVED, 1, 15_100_000_000, EXPIRY + 2));
    expect_err(&mut m, E::MarketNotOpen, |m| m.place_taker(&o, &bid(10, 1), 0, T0));
    expect_err(&mut m, E::MarketNotOpen, |m| m.split(1, T0));
    expect_err(&mut m, E::MarketNotOpen, |m| m.merge(1));
    expect_err(&mut m, E::AlreadySettled, |m| m.settle(false, 0, 0));
    expect_err(&mut m, E::AlreadySettled, |m| m.void());
    // Cancels still work after settlement.
    let id = m.orders.iter().find(|x| x.id != 0).unwrap().id;
    assert_eq!(m.cancel_order(&o, id).unwrap(), 1);
    ok(&m);
}

#[test]
fn cancel_rules() {
    let mut m = new_market();
    take(&mut m, &a(), bid(40, 5)); // id 1
    m.split(4, NOW).unwrap();
    take(&mut m, &a(), held_ask(70, 4)); // id 2
    let o = b();
    expect_err(&mut m, E::NotOrderOwner, |m| m.cancel_order(&o, 1));
    let o = a();
    expect_err(&mut m, E::OrderNotOpen, |m| m.cancel_order(&o, 0));
    expect_err(&mut m, E::OrderNotOpen, |m| m.cancel_order(&o, 99));
    assert_eq!(m.cancel_order(&a(), 1).unwrap(), 5);
    assert_eq!(seat_of(&m, &a()), (5 * 40 * TU, 0, 0, 0, 4, 0, 1));
    expect_err(&mut m, E::OrderNotOpen, |m| m.cancel_order(&o, 1));
    assert_eq!(m.cancel_order(&a(), 2).unwrap(), 4);
    assert_eq!(seat_of(&m, &a()), (5 * 40 * TU, 0, 4, 0, 0, 0, 0));
    ok(&m);
    // take_seat_free pays out and frees the now-empty seat.
    let s = m.find_seat(&a()).unwrap();
    assert_eq!(m.take_seat_free(s), (5 * 40 * TU, 4, 0));
    assert_eq!(m.find_seat(&a()), None);
    assert_eq!(m.take_seat_free(s), (0, 0, 0));
    assert_eq!(m.take_seat_free(MAX_SEATS + 3), (0, 0, 0));
    ok(&m);
}

#[test]
fn cancel_all_and_partial_take_seat_free() {
    let mut m = new_market();
    take(&mut m, &a(), bid(40, 5));
    take(&mut m, &c(), bid(41, 5));
    take(&mut m, &a(), ask(60, 2));
    m.split(3, NOW).unwrap();
    take(&mut m, &a(), held_bid(30, 3));
    let s = m.find_seat(&a()).unwrap();
    // Free part is paid, the seat stays (locked balances remain).
    m.credit_seat_cash(s, 7).unwrap();
    assert_eq!(m.take_seat_free(s), (7, 0, 0));
    assert_eq!(m.find_seat(&a()), Some(s));
    assert_eq!(m.cancel_all(s).unwrap(), 3);
    assert_eq!(seat_of(&m, &a()), (5 * 40 * TU + 2 * 40 * TU, 0, 0, 3, 0, 0, 0));
    assert_eq!(m.cancel_all(s).unwrap(), 0);
    expect_err(&mut m, E::BadArgs, |m| m.cancel_all(MAX_SEATS));
    assert_eq!(m.best_bid(), Some(41));
    assert_eq!(m.best_ask(), None);
    ok(&m);
}

#[test]
fn redeem_resolved_yes_no_and_void() {
    for (status, outcome, expect) in [(STATUS_RESOLVED, 1u8, 3 * UNIT), (STATUS_RESOLVED, 0, 2 * UNIT), (STATUS_VOID, 0, 5 * UNIT / 2)] {
        let mut m = new_market();
        m.split(10, NOW).unwrap();
        expect_err(&mut m, E::NotSettled, |m| m.redeem(1, 1));
        if status == STATUS_VOID {
            m.void().unwrap();
        } else {
            m.settle(outcome == 1, 1, 1).unwrap();
        }
        expect_err(&mut m, E::BadQty, |m| m.redeem(0, 0));
        expect_err(&mut m, E::InsufficientTokens, |m| m.redeem(11, 0));
        assert_eq!(m.redeem(3, 2).unwrap(), expect);
        assert_eq!((m.yes_total, m.no_total), (7, 8));
        assert_eq!(m.pool, 10 * UNIT - expect);
        ok(&m);
        // Redeem everything that is left: the pool empties exactly.
        let rest = m.redeem(7, 8).unwrap();
        assert_eq!(m.pool, 0);
        assert_eq!(expect + rest, 10 * UNIT, "10 pairs always pay out 10 UNIT in total");
        ok(&m);
    }
}

#[test]
fn redeem_seat_converts_free_inventory() {
    let mut m = new_market();
    take(&mut m, &a(), bid(40, 10)); // A buys YES as maker
    take(&mut m, &b(), ask(40, 4)); // fills 4 → A seat.yes = 4
    m.split(2, NOW).unwrap(); // A's wallet
    take(&mut m, &a(), held_bid(30, 2)); // A seat.no_locked = 2
    let s = m.find_seat(&a()).unwrap();
    expect_err(&mut m, E::NotSettled, |m| m.redeem_seat(s));
    m.settle(true, 1, 1).unwrap();
    expect_err(&mut m, E::BadArgs, |m| m.redeem_seat(s + 1));
    assert_eq!(m.redeem_seat(s).unwrap(), 4 * UNIT);
    assert_eq!(seat_of(&m, &a()), (4 * UNIT, 6 * 40 * TU, 0, 0, 0, 2, 2));
    ok(&m);
    // After cancel_all the escrowed NO is free and redeems for 0 (NO lost).
    m.cancel_all(s).unwrap();
    assert_eq!(m.redeem_seat(s).unwrap(), 0);
    assert_eq!(seat_of(&m, &a()), (4 * UNIT + 6 * 40 * TU, 0, 0, 0, 0, 0, 0));
    assert_eq!(m.redeem_seat(s).unwrap(), 0);
    ok(&m);
}

#[test]
fn trade_ring_wraps() {
    let mut m = new_market();
    for i in 0..20u64 {
        take(&mut m, &a(), ask(50 + (i % 5) as u8, 1));
        take(&mut m, &b(), with_tif(bid(60, 1), TIF_IOC));
    }
    assert_eq!(m.trade_count, 20);
    assert_eq!(m.trade_head as usize, 20 % TRADE_RING);
    let t = recent_trades(&m);
    assert_eq!(t.len(), TRADE_RING);
    let expect: Vec<u8> = (4..20u64).rev().map(|i| 50 + (i % 5) as u8).collect();
    assert_eq!(t.iter().map(|t| t.tick).collect::<Vec<_>>(), expect);
    assert_eq!(m.volume, 20);
}

#[test]
fn seat_helpers() {
    let mut m = new_market();
    assert_eq!(m.find_seat(&Default::default()), None);
    expect_err(&mut m, E::BadArgs, |m| m.seat_or_alloc(&Default::default()));
    let s = m.seat_or_alloc(&a()).unwrap();
    assert_eq!(m.seat_or_alloc(&a()).unwrap(), s);
    assert_eq!(m.seat_or_alloc(&b()).unwrap(), s + 1);
    expect_err(&mut m, E::BadArgs, |m| m.credit_seat_cash(s + 2, 1));
    m.credit_seat_cash(s, u64::MAX).unwrap();
    expect_err(&mut m, E::MathOverflow, |m| m.credit_seat_cash(s, 1));
    ok(&m);
}

#[test]
fn failed_calls_never_mutate() {
    // A crowded book where several failure modes are reachable; each must leave bytes unchanged.
    let mut m = new_market();
    take(&mut m, &a(), ask(60, 3));
    take(&mut m, &c(), ask(61, 3));
    take(&mut m, &c(), bid(40, 3));
    m.split(5, NOW).unwrap();
    take(&mut m, &a(), held_bid(30, 2));
    let o = b();
    let mut args = bid(70, 10);
    args.min_filled = 7;
    expect_err(&mut m, E::MinFillNotMet, |m| m.place_taker(&o, &args, 10, NOW));
    expect_err(&mut m, E::WouldCross, |m| m.place_taker(&o, &with_tif(ask(40, 1), TIF_POST_ONLY), 10, NOW));
    expect_err(&mut m, E::Expired, |m| m.place_taker(&o, &bid(70, 1), 10, EXPIRY));
    let sa = m.find_seat(&a()).unwrap();
    expect_err(&mut m, E::InsufficientCash, |m| m.place_from_seat(sa, &bid(70, 1), 0, NOW));
    expect_err(&mut m, E::NotOrderOwner, |m| m.cancel_order(&o, 1));
    expect_err(&mut m, E::NotSettled, |m| m.redeem(1, 0));
    expect_err(&mut m, E::NotSettled, |m| m.redeem_seat(sa));
    ok(&m);
}

#[test]
fn capacity_error_after_simulated_fills_does_not_apply_the_fills() {
    let mut m = new_market();
    for i in 0..MAX_SEATS as u8 {
        take(&mut m, &pk(100 + i), with_tif(ask(55 + (i % 3), 2), TIF_POST_ONLY));
    }
    // Would fill 2 @ 55 (and more), then rest the rest → needs a seat → SeatsFull, nothing applied.
    let o = pk(200);
    let mut args = bid(55, 50);
    args.max_fills = 3;
    let before = (m.pool, m.volume, m.trade_count);
    expect_err(&mut m, E::SeatsFull, |m| m.place_taker(&o, &bid(55, 50), 0, NOW));
    assert_eq!((m.pool, m.volume, m.trade_count), before);
    // With max_fills bound hit while still crossing, the remainder is refunded instead → no seat needed.
    let r = take(&mut m, &pk(200), args);
    assert_eq!((r.filled, r.resting), (6, 0));
}

#[test]
fn overflow_is_detected_before_mutation() {
    let mut m = new_market();
    m.split(5, NOW).unwrap();
    take(&mut m, &a(), held_ask(50, 5)); // case 2 credits A's seat cash on fill
    let s = m.find_seat(&a()).unwrap();
    m.credit_seat_cash(s, u64::MAX - 10).unwrap();
    let o = b();
    expect_err(&mut m, E::MathOverflow, |m| m.place_taker(&o, &bid(50, 1), 0, NOW));
    // Cancelling is still possible (YES goes back to free balance, no cash credit).
    assert_eq!(m.cancel_order(&a(), 1).unwrap(), 5);
    ok(&m);
}
