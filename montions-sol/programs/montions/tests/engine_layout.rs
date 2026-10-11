//! Byte layout of `Market` vs docs/SPEC.md §3.1 (account offsets include the 8-byte discriminator).
use core::mem::{offset_of, size_of};

use anchor_lang::Discriminator;
use montions::constants::*;
use montions::state::*;

mod engine_common;
use engine_common::*;

#[test]
fn market_field_offsets_match_spec() {
    // (field, offset in the account incl. 8-byte discriminator) — SPEC §3.1.
    let spec: &[(&str, usize, usize)] = &[
        ("asset", 8, offset_of!(Market, asset)),
        ("feed_id", 40, offset_of!(Market, feed_id)),
        ("creator", 72, offset_of!(Market, creator)),
        ("yes_mint", 104, offset_of!(Market, yes_mint)),
        ("no_mint", 136, offset_of!(Market, no_mint)),
        ("vault", 168, offset_of!(Market, vault)),
        ("strike", 200, offset_of!(Market, strike)),
        ("expiry", 208, offset_of!(Market, expiry)),
        ("created_at", 216, offset_of!(Market, created_at)),
        ("settle_price", 224, offset_of!(Market, settle_price)),
        ("settle_publish_time", 232, offset_of!(Market, settle_publish_time)),
        ("pool", 240, offset_of!(Market, pool)),
        ("yes_total", 248, offset_of!(Market, yes_total)),
        ("no_total", 256, offset_of!(Market, no_total)),
        ("fees", 264, offset_of!(Market, fees)),
        ("volume", 272, offset_of!(Market, volume)),
        ("next_order_id", 280, offset_of!(Market, next_order_id)),
        ("bid_bits", 288, offset_of!(Market, bid_bits)),
        ("ask_bits", 304, offset_of!(Market, ask_bits)),
        ("status", 320, offset_of!(Market, status)),
        ("outcome", 321, offset_of!(Market, outcome)),
        ("bump", 322, offset_of!(Market, bump)),
        ("vault_bump", 323, offset_of!(Market, vault_bump)),
        ("yes_mint_bump", 324, offset_of!(Market, yes_mint_bump)),
        ("no_mint_bump", 325, offset_of!(Market, no_mint_bump)),
        ("last_trade_tick", 326, offset_of!(Market, last_trade_tick)),
        ("trade_head", 327, offset_of!(Market, trade_head)),
        ("trade_count", 328, offset_of!(Market, trade_count)),
        ("free_head", 332, offset_of!(Market, free_head)),
        ("_pad0", 333, offset_of!(Market, _pad0)),
        ("_reserved", 336, offset_of!(Market, _reserved)),
        ("bid_levels", 368, offset_of!(Market, bid_levels)),
        ("ask_levels", 568, offset_of!(Market, ask_levels)),
        ("orders", 768, offset_of!(Market, orders)),
        ("seats", 2816, offset_of!(Market, seats)),
        ("trades", 4928, offset_of!(Market, trades)),
    ];
    for &(name, account_off, actual) in spec {
        assert_eq!(actual, account_off - 8, "Market.{name}");
    }
    assert_eq!(size_of::<Market>(), 5184 - 8);
    assert_eq!(size_of::<Market>(), MARKET_SIZE);
}

#[test]
fn sub_struct_layouts_match_spec() {
    assert_eq!(size_of::<Level>(), 2);
    assert_eq!(offset_of!(Level, head), 0);
    assert_eq!(offset_of!(Level, tail), 1);

    assert_eq!(size_of::<Order>(), 32);
    assert_eq!(offset_of!(Order, id), 0);
    assert_eq!(offset_of!(Order, qty), 8);
    assert_eq!(offset_of!(Order, ts), 16);
    assert_eq!(offset_of!(Order, seat), 24);
    assert_eq!(offset_of!(Order, side), 25);
    assert_eq!(offset_of!(Order, tick), 26);
    assert_eq!(offset_of!(Order, from_held), 27);
    assert_eq!(offset_of!(Order, prev), 28);
    assert_eq!(offset_of!(Order, next), 29);
    assert_eq!(offset_of!(Order, _pad), 30);

    assert_eq!(size_of::<Seat>(), 88);
    assert_eq!(offset_of!(Seat, owner), 0);
    assert_eq!(offset_of!(Seat, cash), 32);
    assert_eq!(offset_of!(Seat, locked), 40);
    assert_eq!(offset_of!(Seat, yes), 48);
    assert_eq!(offset_of!(Seat, no), 56);
    assert_eq!(offset_of!(Seat, yes_locked), 64);
    assert_eq!(offset_of!(Seat, no_locked), 72);
    assert_eq!(offset_of!(Seat, open_orders), 80);
    assert_eq!(offset_of!(Seat, _pad), 84);

    assert_eq!(size_of::<Trade>(), 16);
    assert_eq!(offset_of!(Trade, ts), 0);
    assert_eq!(offset_of!(Trade, qty), 8);
    assert_eq!(offset_of!(Trade, tick), 12);
    assert_eq!(offset_of!(Trade, taker_is_buyer), 13);
    assert_eq!(offset_of!(Trade, _pad), 14);

    assert_eq!(LEVELS * 2, 200);
    assert_eq!(MAX_ORDERS * 32, 2048);
    assert_eq!(MAX_SEATS * 88, 2112);
    assert_eq!(TRADE_RING * 16, 256);
}

#[test]
fn discriminator_is_sha256_account_market() {
    // sha256("account:Market")[..8], computed independently (`printf 'account:Market' | sha256sum`).
    assert_eq!(Market::DISCRIMINATOR, &[0xdb, 0xbe, 0xd5, 0x37, 0x00, 0xe3, 0xc6, 0x9a]);
}

#[test]
fn init_book_state() {
    let m = new_market();
    assert_eq!(m.status, STATUS_OPEN);
    assert_eq!(m.next_order_id, 1);
    assert_eq!(m.last_trade_tick, 0);
    assert_eq!(m.free_head, 0);
    assert_eq!(m.bid_bits, [0, 0]);
    assert_eq!(m.ask_bits, [0, 0]);
    for t in 0..LEVELS {
        assert_eq!((m.bid_levels[t].head, m.bid_levels[t].tail), (NIL, NIL));
        assert_eq!((m.ask_levels[t].head, m.ask_levels[t].tail), (NIL, NIL));
    }
    // Free list visits every slot exactly once, in index order.
    let mut cur = m.free_head;
    let mut n = 0usize;
    while cur != NIL {
        assert_eq!(cur as usize, n);
        assert_eq!(m.orders[cur as usize].id, 0);
        cur = m.orders[cur as usize].next;
        n += 1;
    }
    assert_eq!(n, MAX_ORDERS);
    assert!(m.seats.iter().all(|s| *s == Seat::default()));
    assert_eq!(m.best_bid(), None);
    assert_eq!(m.best_ask(), None);
    m.check_invariants().unwrap();
    // Identity fields written before init_book are preserved.
    assert_eq!(m.expiry, EXPIRY);
    assert_eq!(m.strike, 15_000_000_000);
}
