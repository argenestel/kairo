//! Ladder (`maker_model.rs`) properties, the worked example, and the TS parity fixture.
use montions::constants::{MAX_ORDER_QTY, SIDE_ASK, SIDE_BID, TICK_UNIT};
use montions::maker_model::{
    build_ladder, cash_per_contract, half_spread, level_qty, time_decay_width, Ladder, LadderInput, LadderQuote,
    MAX_LADDER,
};
use montions::pricing::{prob_to_tick, WAD};
use montions::state::MakerParams;
use std::path::PathBuf;

const USDC: u64 = 1_000_000;

fn params(levels: u8, spacing: u8, mhs: u8, notional: u64) -> MakerParams {
    MakerParams {
        enabled: true,
        levels,
        level_spacing: spacing,
        min_half_spread: mhs,
        max_market_exposure: 1_000 * USDC,
        level_notional: notional,
        min_tte: 600,
        max_price_age: 60,
    }
}

fn input(fair: f64, tte: i64, cash: u64, topup: u64, yes: u64, no: u64, p: MakerParams) -> LadderInput {
    LadderInput {
        fair_wad: (fair * 1e18) as u128,
        tte_secs: tte,
        vol_bps: 8_000,
        seat_cash: cash,
        seat_yes: yes,
        seat_no: no,
        topup_available: topup,
        params: p,
    }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick(&mut self, xs: &[u64]) -> u64 {
        xs[self.below(xs.len() as u64) as usize]
    }
}

fn random_input(rng: &mut Rng) -> LadderInput {
    let fair_wad = match rng.below(6) {
        0 => rng.pick(&[0, 1, WAD as u64 / 200, WAD as u64 / 100, WAD as u64 / 100 * 99, WAD as u64]) as u128,
        1 => WAD + rng.below(1_000) as u128,
        _ => (rng.next() as u128 % (WAD + 1)) as u128,
    };
    let amounts = [0, 1, 9_999, 10_000, 350_000, 50 * USDC, 1_000 * USDC, u64::MAX / 2, u64::MAX];
    let inv = [0, 1, 5, 80, 1_000, 10_000_000, u64::MAX];
    LadderInput {
        fair_wad,
        tte_secs: match rng.below(4) {
            0 => rng.below(20) as i64 - 10,
            1 => i64::MAX - rng.below(3) as i64,
            _ => rng.below(100 * 86_400) as i64,
        },
        vol_bps: rng.below(60_000) as u32,
        seat_cash: if rng.below(2) == 0 { rng.pick(&amounts) } else { rng.below(1_000 * USDC) },
        seat_yes: if rng.below(2) == 0 { 0 } else { rng.pick(&inv) },
        seat_no: if rng.below(2) == 0 { 0 } else { rng.pick(&inv) },
        topup_available: if rng.below(2) == 0 { rng.pick(&amounts) } else { rng.below(1_000 * USDC) },
        params: params(
            rng.below(7) as u8,
            rng.below(5) as u8,
            rng.below(16) as u8,
            if rng.below(2) == 0 { rng.pick(&amounts) } else { rng.below(500 * USDC) },
        ),
    }
}

fn check_invariants(inp: &LadderInput, l: &Ladder) {
    let ctx = format!("{inp:?} -> {l:?}");
    assert!(l.len <= MAX_LADDER, "{ctx}");
    assert_eq!(l.fair_tick, prob_to_tick(inp.fair_wad), "{ctx}");
    for q in &l.quotes[l.len..] {
        assert_eq!(*q, LadderQuote::default(), "{ctx}");
    }
    let qs = &l.quotes[..l.len];
    let bids: Vec<&LadderQuote> = qs.iter().filter(|q| q.side == SIDE_BID).collect();
    let asks: Vec<&LadderQuote> = qs.iter().filter(|q| q.side == SIDE_ASK).collect();
    assert_eq!(bids.len() + asks.len(), l.len, "{ctx}");
    let levels = (inp.params.levels as usize).min(MAX_LADDER / 2);
    assert!(bids.len() <= levels && asks.len() <= levels, "{ctx}");
    let mut cash: u128 = 0;
    let (mut held_yes, mut held_no) = (0u128, 0u128);
    for q in qs {
        assert!((1..=99).contains(&q.tick), "{ctx}");
        assert!(q.qty >= 1 && q.qty <= MAX_ORDER_QTY, "{ctx}");
        if q.from_held {
            if q.side == SIDE_ASK {
                held_yes += q.qty as u128;
            } else {
                held_no += q.qty as u128;
            }
        } else {
            cash += q.qty as u128 * cash_per_contract(q.side, q.tick) as u128;
        }
    }
    // Every bid < fair_tick < every ask; strictly ordered, no duplicates.
    for w in bids.windows(2) {
        assert!(w[0].tick > w[1].tick, "{ctx}");
    }
    for w in asks.windows(2) {
        assert!(w[0].tick < w[1].tick, "{ctx}");
    }
    for b in &bids {
        assert!(b.tick < l.fair_tick, "{ctx}");
        for a in &asks {
            assert!(b.tick < a.tick, "{ctx}");
        }
    }
    for a in &asks {
        assert!(a.tick > l.fair_tick, "{ctx}");
    }
    // Budget.
    assert_eq!(cash, l.cash_needed as u128, "{ctx}");
    assert!(cash <= inp.seat_cash as u128 + inp.topup_available as u128, "{ctx}");
    // Inventory never over-committed, and used first: a cash-backed quote on a side only after
    // that side's inventory is fully offered, and never before a from_held one.
    assert!(held_yes <= inp.seat_yes as u128 && held_no <= inp.seat_no as u128, "{ctx}");
    for (side, held, inv) in [(&asks, held_yes, inp.seat_yes), (&bids, held_no, inp.seat_no)] {
        let first_cash = side.iter().position(|q| !q.from_held);
        if let Some(i) = first_cash {
            assert!(side[i..].iter().all(|q| !q.from_held), "{ctx}");
            assert_eq!(held, inv as u128, "inventory not exhausted before cash {ctx}");
        }
    }
    // Determinism.
    let again = build_ladder(inp);
    assert_eq!(&again.quotes[..again.len], qs, "{ctx}");
    assert_eq!(again.cash_needed, l.cash_needed);
}

#[test]
fn worked_example_fair_037_one_day() {
    // fair 0.37, tte 1 day, vol 80%, levels 3, spacing 2, min half-spread 2, 50 USDC per level.
    let p = params(3, 2, 2, 50 * USDC);
    let inp = input(0.37, 86_400, 0, 1_000 * USDC, 0, 0, p);
    let l = build_ladder(&inp);
    check_invariants(&inp, &l);
    assert_eq!(time_decay_width(86_400), 1); // ceil(4·sqrt(600/86400)) = ceil(0.333)
    assert_eq!(half_spread(&p, 86_400), 2);
    assert_eq!(l.fair_tick, 37);
    let want = [
        (SIDE_BID, 35, 142),
        (SIDE_ASK, 39, 81),
        (SIDE_BID, 33, 151),
        (SIDE_ASK, 41, 84),
        (SIDE_BID, 31, 161),
        (SIDE_ASK, 43, 87),
    ];
    assert_eq!(l.len, want.len());
    for (q, (side, tick, qty)) in l.as_slice().iter().zip(want) {
        assert_eq!((q.side, q.tick, q.qty, q.from_held), (side, tick, qty, false));
    }
    // 142·0.35 + 81·0.61 + 151·0.33 + 84·0.59 + 161·0.31 + 87·0.57 USDC
    assert_eq!(l.cash_needed, 298_000_000);
}

#[test]
fn worked_example_with_inventory_and_tight_budget() {
    let p = params(3, 2, 2, 50 * USDC);
    // 100 YES held: first ask (81) and 19 of the second come from inventory.
    let l = build_ladder(&input(0.37, 86_400, 0, 1_000 * USDC, 100, 0, p));
    let asks: Vec<_> = l.as_slice().iter().filter(|q| q.side == SIDE_ASK).map(|q| (q.tick, q.qty, q.from_held)).collect();
    assert_eq!(asks, vec![(39, 81, true), (41, 19, true), (43, 87, false)]);
    // Only 100 USDC available: cash quotes scaled to fit, inventory quotes untouched.
    let inp = input(0.37, 86_400, 30 * USDC, 70 * USDC, 100, 0, p);
    let l = build_ladder(&inp);
    check_invariants(&inp, &l);
    assert!(l.cash_needed <= 100 * USDC && l.cash_needed > 99 * USDC, "{l:?}");
    assert_eq!(l.len, 6);
    // Zero budget: only the inventory-backed quotes remain.
    let inp = input(0.37, 86_400, 0, 0, 100, 0, p);
    let l = build_ladder(&inp);
    check_invariants(&inp, &l);
    assert_eq!(l.cash_needed, 0);
    assert!(l.as_slice().iter().all(|q| q.from_held && q.side == SIDE_ASK) && l.len == 2);
    // A budget below one contract of the inner bid: nothing to post.
    let l = build_ladder(&input(0.37, 86_400, 300_000, 0, 0, 0, p));
    assert_eq!(l.len, 0);
    // Exactly one inner bid contract.
    let l = build_ladder(&input(0.37, 86_400, 350_000, 0, 0, 0, p));
    assert_eq!(l.as_slice(), &[LadderQuote { side: SIDE_BID, tick: 35, qty: 1, from_held: false }]);
}

#[test]
fn held_no_backs_bids() {
    let p = params(2, 1, 1, 10 * USDC);
    let inp = input(0.50, 3 * 86_400, 0, 1_000 * USDC, 0, 25, p);
    let l = build_ladder(&inp);
    check_invariants(&inp, &l);
    let bids: Vec<_> = l.as_slice().iter().filter(|q| q.side == SIDE_BID).map(|q| (q.tick, q.qty, q.from_held)).collect();
    // level size at 49: 10 USDC / 0.49 = 20 → 20 from held NO, the remaining 5 at 48.
    assert_eq!(bids, vec![(49, 20, true), (48, 5, true)]);
}

#[test]
fn time_decay_width_matches_makervault() {
    // MakerVault: halfSpread = clamp(ceil(4 · sqrt(600 / tte)), 2, 12).
    let p = params(3, 2, 2, 50 * USDC);
    for tte in (1..200_000i64).step_by(7).chain([2_399, 2_400, 2_401, 9_599, 9_600, 9_601, 600, 599, 601]) {
        let w = (4.0 * (600.0 / tte as f64).sqrt() - 1e-12).ceil().clamp(2.0, 12.0) as u8;
        assert_eq!(half_spread(&p, tte), w, "tte={tte}");
    }
    assert_eq!(time_decay_width(0), 12);
    assert_eq!(time_decay_width(-5), 12);
    assert_eq!(time_decay_width(600), 4);
    assert_eq!(time_decay_width(2_400), 2);
    assert_eq!(time_decay_width(9_600), 1);
    assert_eq!(time_decay_width(i64::MAX), 1);
}

#[test]
fn extremes_of_fair() {
    let p = params(3, 2, 2, 50 * USDC);
    // fair ~0 → fair_tick 1: no bids, asks at 3, 5, 7.
    let l = build_ladder(&input(0.0, 86_400, 0, 1_000 * USDC, 0, 0, p));
    let t: Vec<_> = l.as_slice().iter().map(|q| (q.side, q.tick)).collect();
    assert_eq!(t, vec![(SIDE_ASK, 3), (SIDE_ASK, 5), (SIDE_ASK, 7)]);
    // fair 0.03 → bids clamp to 1 once (no duplicates).
    let l = build_ladder(&input(0.03, 86_400, 0, 1_000 * USDC, 0, 0, p));
    let t: Vec<_> = l.as_slice().iter().map(|q| (q.side, q.tick)).collect();
    assert_eq!(t, vec![(SIDE_BID, 1), (SIDE_ASK, 5), (SIDE_ASK, 7), (SIDE_ASK, 9)]);
    // fair ~1 → no asks.
    let l = build_ladder(&input(1.0, 86_400, 0, 1_000 * USDC, 0, 0, p));
    assert!(l.as_slice().iter().all(|q| q.side == SIDE_BID) && l.len == 3);
    // levels = 0 or notional = 0 → empty.
    assert_eq!(build_ladder(&input(0.5, 86_400, 0, 1_000 * USDC, 0, 0, params(0, 2, 2, 50 * USDC))).len, 0);
    assert_eq!(build_ladder(&input(0.5, 86_400, 0, 1_000 * USDC, 0, 0, params(3, 2, 2, 0))).len, 0);
    // levels > 4 is capped at 4 per side.
    let l = build_ladder(&input(0.5, 86_400, 0, 1_000_000 * USDC, 0, 0, params(9, 1, 1, USDC)));
    assert_eq!(l.len, MAX_LADDER);
    // Sizes: level_qty floors at 1 contract and caps at MAX_ORDER_QTY.
    assert_eq!(level_qty(1, SIDE_BID, 50), 1);
    assert_eq!(level_qty(u64::MAX, SIDE_BID, 1), MAX_ORDER_QTY);
    assert_eq!(level_qty(50 * USDC, SIDE_ASK, 39), 50 * USDC / (61 * TICK_UNIT));
}

#[test]
fn random_ladders_satisfy_invariants() {
    let mut rng = Rng(7);
    for _ in 0..200_000 {
        let inp = random_input(&mut rng);
        let l = build_ladder(&inp);
        check_invariants(&inp, &l);
        // Ample budget and no inventory ⇒ every cash level gets exactly its target size.
        if inp.seat_yes == 0 && inp.seat_no == 0 {
            let wanted: u128 = l.as_slice().iter().map(|q| q.qty as u128 * cash_per_contract(q.side, q.tick) as u128).sum();
            if (inp.seat_cash as u128 + inp.topup_available as u128) >= wanted {
                for q in l.as_slice() {
                    let target = level_qty(inp.params.level_notional, q.side, q.tick);
                    assert!(q.qty <= target);
                }
            }
        }
    }
}

// ───────────────────────── TS parity fixture ─────────────────────────

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/pricing_data/ladder_vectors.txt")
}

fn fixture_line(inp: &LadderInput, l: &Ladder) -> String {
    let p = &inp.params;
    let mut s = format!(
        "{} {} {} {} {} {} {} {} {} {} {} | {} {} {}",
        inp.fair_wad,
        inp.tte_secs,
        inp.vol_bps,
        inp.seat_cash,
        inp.seat_yes,
        inp.seat_no,
        inp.topup_available,
        p.levels,
        p.level_spacing,
        p.min_half_spread,
        p.level_notional,
        l.fair_tick,
        l.cash_needed,
        l.len
    );
    for q in l.as_slice() {
        s.push_str(&format!(" {}:{}:{}:{}", q.side, q.tick, q.qty, q.from_held as u8));
    }
    s
}

/// `tests/pricing_data/ladder_vectors.txt` pins the Rust ladder for the TS twin
/// (`sdk/test/pricing.test.ts`). Regenerate with `UPDATE_PRICING_FIXTURES=1`.
#[test]
fn ladder_fixture_is_current() {
    let mut rng = Rng(20261011);
    let mut lines = vec!["# fair_wad tte vol cash yes no topup levels spacing min_hs notional | fair_tick cash_needed len side:tick:qty:held...".to_string()];
    let p = params(3, 2, 2, 50 * USDC);
    let mut inputs = vec![
        input(0.37, 86_400, 0, 1_000 * USDC, 0, 0, p),
        input(0.37, 86_400, 0, 1_000 * USDC, 100, 0, p),
        input(0.37, 86_400, 30 * USDC, 70 * USDC, 100, 0, p),
        input(0.5, 600, 0, 1_000 * USDC, 0, 50, p),
        input(0.03, 86_400, 0, 1_000 * USDC, 0, 0, p),
    ];
    for _ in 0..400 {
        inputs.push(random_input(&mut rng));
    }
    for inp in &inputs {
        lines.push(fixture_line(inp, &build_ladder(inp)));
    }
    let text = lines.join("\n") + "\n";
    if std::env::var("UPDATE_PRICING_FIXTURES").is_ok() {
        std::fs::write(fixture_path(), &text).unwrap();
    }
    let on_disk = std::fs::read_to_string(fixture_path()).expect("run with UPDATE_PRICING_FIXTURES=1 to create");
    assert_eq!(on_disk, text, "ladder fixture out of date: rerun with UPDATE_PRICING_FIXTURES=1");
}
