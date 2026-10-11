//! Engine-produced `Market` account fixture for the TypeScript decoder (SPEC §8):
//! `tests/fixtures/market_fixture.bin` = 8-byte Anchor discriminator + `Market` bytes (5184 bytes),
//! `tests/fixtures/market_fixture.json` = the expected decoded fields.
//!
//! The scenario is scripted and deterministic. The test regenerates both files and compares them
//! with the committed copies; set `MONTIONS_WRITE_FIXTURE=1` (or delete the files) to rewrite them.
use std::fmt::Write as _;
use std::path::PathBuf;

use anchor_lang::prelude::Pubkey;
use anchor_lang::Discriminator;
use montions::constants::*;
use montions::state::*;

mod engine_common;
use engine_common::*;

const FEE_BPS: u16 = 30;

fn key(tag: u8) -> Pubkey {
    let mut b = [0u8; 32];
    for (i, x) in b.iter_mut().enumerate() {
        *x = tag.wrapping_mul(31).wrapping_add(i as u8 * 7);
    }
    Pubkey::new_from_array(b)
}

struct Scenario {
    m: Box<Market>,
    maker: Pubkey,
    alice: Pubkey,
    bob: Pubkey,
}

fn build() -> Scenario {
    let mut m: Box<Market> = Box::new(bytemuck::Zeroable::zeroed());
    m.asset = key(1);
    for (i, x) in m.feed_id.iter_mut().enumerate() {
        *x = 0xe0u8.wrapping_add(i as u8);
    }
    m.creator = key(2);
    m.yes_mint = key(3);
    m.no_mint = key(4);
    m.vault = key(5);
    m.strike = 15_000_000_000; // $150.00
    m.expiry = 1_760_004_000; // on the 300 s grid
    m.created_at = 1_759_999_700;
    m.bump = 254;
    m.vault_bump = 253;
    m.yes_mint_bump = 252;
    m.no_mint_bump = 251;
    m.init_book();

    let maker = key(10);
    let alice = key(11);
    let bob = key(12);
    let carol = key(13);
    let dave = key(14);
    let mut now = 1_760_000_000i64;

    // Protocol-maker-like seat: funded, POST_ONLY ladder 43/45 x 55/57.
    let ms = m.seat_or_alloc(&maker).unwrap();
    m.credit_seat_cash(ms, 50 * UNIT).unwrap();
    for (side, tick) in [(SIDE_BID, 45), (SIDE_BID, 43), (SIDE_ASK, 55), (SIDE_ASK, 57)] {
        m.place_from_seat(ms, &with_tif(pa(side, tick, 10, TIF_GTC, false), TIF_POST_ONLY), FEE_BPS, now).unwrap();
    }
    now += 3;
    // Alice bids 47 x5 (rests, best bid).
    m.place_taker(&alice, &bid(47, 5), FEE_BPS, now).unwrap();
    now += 2;
    // Bob splits 20 and offers 8 held YES at 60.
    m.split(20, now).unwrap();
    m.place_taker(&bob, &held_ask(60, 8), FEE_BPS, now).unwrap();
    now += 4;
    // Alice lifts 6 @ 55 (IOC, limit 56).
    m.place_taker(&alice, &with_tif(bid(56, 6), TIF_IOC), FEE_BPS, now).unwrap();
    now += 5;
    // Carol writes 12 @ limit 44: hits Alice 5 @ 47, then the maker 7 @ 45.
    m.place_taker(&carol, &with_tif(ask(44, 12), TIF_IOC), FEE_BPS, now).unwrap();
    now += 1;
    // Bob offers to close 4 NO via a held-NO bid at 52 (rests below the 55 ask).
    m.place_taker(&bob, &held_bid(52, 4), FEE_BPS, now).unwrap();
    now += 6;
    // Alice writes 3 @ 58 (rests).
    m.place_taker(&alice, &ask(58, 3), FEE_BPS, now).unwrap();
    now += 2;
    // Dave lifts 10 @ limit 57: 4 @ 55 (maker), 6 @ 57 (maker).
    m.place_taker(&dave, &with_tif(bid(57, 10), TIF_IOC), FEE_BPS, now).unwrap();
    now += 3;
    // Maker posts part of its YES inventory as a held ask at 62.
    m.place_from_seat(ms, &with_tif(held_ask(62, 5), TIF_POST_ONLY), FEE_BPS, now).unwrap();
    now += 1;
    // Carol lifts 2 more (IOC limit 58): price priority picks the maker's 57 before Alice's 58.
    m.place_taker(&carol, &with_tif(bid(58, 2), TIF_IOC), FEE_BPS, now).unwrap();
    now += 2;
    // Multi-order FIFO levels for the decoder: Bob joins the maker's 43 bid, Alice adds to her 58.
    m.place_taker(&bob, &bid(43, 2), FEE_BPS, now).unwrap();
    m.place_taker(&alice, &ask(58, 1), FEE_BPS, now).unwrap();

    m.check_invariants().unwrap();
    Scenario { m, maker, alice, bob }
}

fn s(v: impl std::fmt::Display) -> String {
    format!("\"{v}\"")
}

fn to_json(sc: &Scenario) -> String {
    let m = &*sc.m;
    let mut j = String::new();
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    j.push_str("{\n");
    let _ = writeln!(j, "  \"comment\": \"Market account produced by programs/montions/tests/engine_fixture.rs. u64/i64 as decimal strings; side 0=bid 1=ask; NIL=255; levels best-first with FIFO order ids; orders = live slots by slot index; seats = allocated seats; trades newest first.\",");
    let _ = writeln!(j, "  \"accountSize\": {},", 8 + MARKET_SIZE);
    let _ = writeln!(j, "  \"discriminatorHex\": {},", s(hex(Market::DISCRIMINATOR)));
    let _ = writeln!(j, "  \"actors\": {{ \"maker\": {}, \"alice\": {}, \"bob\": {} }},", s(sc.maker), s(sc.alice), s(sc.bob));
    j.push_str("  \"header\": {\n");
    let fields: Vec<(&str, String)> = vec![
        ("asset", s(m.asset)),
        ("feedIdHex", s(hex(&m.feed_id))),
        ("creator", s(m.creator)),
        ("yesMint", s(m.yes_mint)),
        ("noMint", s(m.no_mint)),
        ("vault", s(m.vault)),
        ("strike", s(m.strike)),
        ("expiry", s(m.expiry)),
        ("createdAt", s(m.created_at)),
        ("settlePrice", s(m.settle_price)),
        ("settlePublishTime", s(m.settle_publish_time)),
        ("pool", s(m.pool)),
        ("yesTotal", s(m.yes_total)),
        ("noTotal", s(m.no_total)),
        ("fees", s(m.fees)),
        ("volume", s(m.volume)),
        ("nextOrderId", s(m.next_order_id)),
        ("bidBits", format!("[{}, {}]", s(m.bid_bits[0]), s(m.bid_bits[1]))),
        ("askBits", format!("[{}, {}]", s(m.ask_bits[0]), s(m.ask_bits[1]))),
        ("status", m.status.to_string()),
        ("outcome", m.outcome.to_string()),
        ("bump", m.bump.to_string()),
        ("vaultBump", m.vault_bump.to_string()),
        ("yesMintBump", m.yes_mint_bump.to_string()),
        ("noMintBump", m.no_mint_bump.to_string()),
        ("lastTradeTick", m.last_trade_tick.to_string()),
        ("tradeHead", m.trade_head.to_string()),
        ("tradeCount", m.trade_count.to_string()),
        ("freeHead", m.free_head.to_string()),
    ];
    let n = fields.len();
    for (i, (k, v)) in fields.into_iter().enumerate() {
        let _ = writeln!(j, "    \"{k}\": {v}{}", if i + 1 < n { "," } else { "" });
    }
    j.push_str("  },\n");
    let opt = |t: Option<u8>| t.map(|t| t.to_string()).unwrap_or_else(|| "null".into());
    let _ = writeln!(j, "  \"bestBid\": {},", opt(m.best_bid()));
    let _ = writeln!(j, "  \"bestAsk\": {},", opt(m.best_ask()));
    for (name, side) in [("bids", SIDE_BID), ("asks", SIDE_ASK)] {
        let mut ticks: Vec<u8> = (MIN_TICK..=MAX_TICK).filter(|&t| m.level_qty(side, t) > 0).collect();
        if side == SIDE_BID {
            ticks.reverse();
        }
        let rows: Vec<String> = ticks
            .iter()
            .map(|&t| {
                let ids: Vec<String> = level_orders(m, side, t).iter().map(|(id, _)| s(id)).collect();
                format!("    {{ \"tick\": {t}, \"qty\": {}, \"orderIds\": [{}] }}", s(m.level_qty(side, t)), ids.join(", "))
            })
            .collect();
        let _ = writeln!(j, "  \"{name}\": [\n{}\n  ],", rows.join(",\n"));
    }
    let rows: Vec<String> = m
        .orders
        .iter()
        .enumerate()
        .filter(|(_, o)| o.id != 0)
        .map(|(i, o)| {
            format!(
                "    {{ \"slot\": {i}, \"id\": {}, \"qty\": {}, \"ts\": {}, \"seat\": {}, \"owner\": {}, \"side\": {}, \"tick\": {}, \"fromHeld\": {}, \"prev\": {}, \"next\": {} }}",
                s(o.id), s(o.qty), s(o.ts), o.seat, s(m.seats[o.seat as usize].owner), o.side, o.tick, o.from_held == 1, o.prev, o.next
            )
        })
        .collect();
    let _ = writeln!(j, "  \"orders\": [\n{}\n  ],", rows.join(",\n"));
    let rows: Vec<String> = m
        .seats
        .iter()
        .enumerate()
        .filter(|(_, x)| x.owner != Pubkey::default())
        .map(|(i, x)| {
            format!(
                "    {{ \"index\": {i}, \"owner\": {}, \"cash\": {}, \"locked\": {}, \"yes\": {}, \"no\": {}, \"yesLocked\": {}, \"noLocked\": {}, \"openOrders\": {} }}",
                s(x.owner), s(x.cash), s(x.locked), s(x.yes), s(x.no), s(x.yes_locked), s(x.no_locked), x.open_orders
            )
        })
        .collect();
    let _ = writeln!(j, "  \"seats\": [\n{}\n  ],", rows.join(",\n"));
    let rows: Vec<String> = recent_trades(m)
        .iter()
        .map(|t| format!("    {{ \"ts\": {}, \"qty\": {}, \"tick\": {}, \"takerIsBuyer\": {} }}", s(t.ts), t.qty, t.tick, t.taker_is_buyer == 1))
        .collect();
    let _ = writeln!(j, "  \"trades\": [\n{}\n  ]", rows.join(",\n"));
    j.push_str("}\n");
    j
}

fn account_bytes(m: &Market) -> Vec<u8> {
    let mut v = Market::DISCRIMINATOR.to_vec();
    v.extend_from_slice(bytemuck::bytes_of(m));
    v
}

#[test]
fn market_fixture_scenario_is_sane() {
    let sc = build();
    let m = &*sc.m;
    assert_eq!(account_bytes(m).len(), 5184);
    // Three seats, both sides populated, a non-trivial trade ring.
    assert_eq!(m.seats.iter().filter(|x| x.owner != Pubkey::default()).count(), 3);
    assert_eq!(m.best_bid(), Some(52));
    assert_eq!(m.best_ask(), Some(57));
    assert_eq!(m.level_qty(SIDE_ASK, 57), 2);
    assert_eq!(m.level_qty(SIDE_ASK, 58), 4);
    assert_eq!(level_orders(m, SIDE_ASK, 58), vec![(8, 3), (11, 1)]);
    assert_eq!(level_orders(m, SIDE_BID, 43), vec![(2, 10), (10, 2)]);
    assert_eq!(m.trade_count, 6);
    assert!(m.fees > 0 && m.volume == 6 + 5 + 7 + 4 + 6 + 2);
    // Byte-level spot checks at SPEC §3.1 offsets.
    let b = account_bytes(m);
    let u64_at = |o: usize| u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
    assert_eq!(u64_at(200), m.strike);
    assert_eq!(u64_at(240), m.pool);
    assert_eq!(u64_at(280), m.next_order_id);
    assert_eq!(b[320], STATUS_OPEN);
    assert_eq!(b[326], m.last_trade_tick);
    assert_eq!(b[332], m.free_head);
    assert_eq!(&b[2816..2848], m.seats[0].owner.as_ref());
}

#[test]
fn market_fixture_matches_committed_files() {
    let sc = build();
    let bin = account_bytes(&sc.m);
    let json = to_json(&sc);
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let bin_path = dir.join("market_fixture.bin");
    let json_path = dir.join("market_fixture.json");
    let rewrite = std::env::var("MONTIONS_WRITE_FIXTURE").is_ok() || !bin_path.exists() || !json_path.exists();
    if rewrite {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&bin_path, &bin).unwrap();
        std::fs::write(&json_path, &json).unwrap();
        println!("wrote {} and {}", bin_path.display(), json_path.display());
    } else {
        assert!(std::fs::read(&bin_path).unwrap() == bin, "market_fixture.bin is stale (MONTIONS_WRITE_FIXTURE=1 to rewrite)");
        assert_eq!(std::fs::read_to_string(&json_path).unwrap(), json, "market_fixture.json is stale");
    }
}
