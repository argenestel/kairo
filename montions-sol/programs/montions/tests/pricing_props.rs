//! Property / edge-case tests for `pricing.rs` (no external crates: a SplitMix64 PRNG).
use montions::pricing::{digital_prob_above_wad, norm_cdf_wad, prob_to_tick, CDF_CLAMP_WAD, WAD};

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
    /// Log-uniform in [1, 2^bits).
    fn log_u64(&mut self, bits: u32) -> u64 {
        let b = 1 + self.below(bits as u64) as u32;
        let v = self.next() >> (64 - b);
        v.max(1)
    }
}

const DAY: i64 = 86_400;
const VOLS: [u32; 8] = [1, 10, 100, 1_000, 2_500, 8_000, 20_000, 50_000];
const TTES: [i64; 9] = [1, 10, 60, 600, 3_600, DAY, 7 * DAY, 30 * DAY, 90 * DAY];

#[test]
fn cdf_symmetry_exact() {
    let mut rng = Rng(1);
    for _ in 0..20_000 {
        let x = (rng.next() as i128 % (12 * WAD as i128)).abs();
        assert_eq!(norm_cdf_wad(x) + norm_cdf_wad(-x), WAD, "x={x}");
    }
    for x in [0i128, 1, 7_071_067_811_865_470_000, CDF_CLAMP_WAD - 1, CDF_CLAMP_WAD, i128::MAX] {
        assert_eq!(norm_cdf_wad(x) + norm_cdf_wad(-x.max(-i128::MAX)), WAD);
    }
    assert_eq!(norm_cdf_wad(0), WAD / 2);
    assert_eq!(norm_cdf_wad(i128::MIN), 0);
    assert_eq!(norm_cdf_wad(i128::MAX), WAD);
}

#[test]
fn cdf_monotone_grid_and_adjacent() {
    // Grid step 1e-4 over [-10, 10].
    let mut prev = 0u128;
    let mut x = -10 * WAD as i128;
    while x <= 10 * WAD as i128 {
        let y = norm_cdf_wad(x);
        assert!(y >= prev, "not monotone at x={x}: {y} < {prev}");
        prev = y;
        x += 100_000_000_000_000;
    }
    // Random nearby pairs, including both branch boundaries (±7.0710678…) and tiny steps.
    let mut rng = Rng(2);
    let mut worst_dip = 0u128;
    for i in 0..200_000 {
        let base = match i % 4 {
            0 => 7_071_067_811_865_470_000i128,
            1 => -7_071_067_811_865_470_000,
            _ => 0,
        };
        let x = base + (rng.next() as i128 % (9 * WAD as i128)) / if base == 0 { 1 } else { 1_000_000 };
        let bits = rng.below(50) as u32 + 1;
        let dx = 1 + rng.below(1 << bits) as i128;
        let (a, b) = (norm_cdf_wad(x), norm_cdf_wad(x + dx));
        if b < a {
            worst_dip = worst_dip.max(a - b);
        }
    }
    // Fixed-point rounding may produce dips at the 1e-16 level between near-identical inputs;
    // they must stay far below one tick (1e16) and below the model accuracy.
    println!("max adjacent-input dip: {worst_dip} WAD");
    assert!(worst_dip <= 1_000, "dip {worst_dip}");
}

#[test]
fn cdf_known_values() {
    let close = |x: i128, want: f64| {
        let got = norm_cdf_wad(x) as f64 / 1e18;
        assert!((got - want).abs() < 1e-15, "N({x}) = {got}, want {want}");
    };
    close(WAD as i128, 0.841_344_746_068_542_9);
    close(-(WAD as i128), 0.158_655_253_931_457_05);
    close(1_959_963_984_540_054_000, 0.975);
    close(-3 * WAD as i128, 0.001_349_898_031_630_094_6);
}

#[test]
fn digital_intrinsic_and_degenerate() {
    for tte in [0i64, -1, -1_000_000, i64::MIN] {
        assert_eq!(digital_prob_above_wad(100, 100, 8_000, tte), WAD);
        assert_eq!(digital_prob_above_wad(101, 100, 8_000, tte), WAD);
        assert_eq!(digital_prob_above_wad(99, 100, 8_000, tte), 0);
    }
    for tte in [1i64, DAY, i64::MAX] {
        assert_eq!(digital_prob_above_wad(100, 100, 0, tte), WAD);
        assert_eq!(digital_prob_above_wad(99, 100, 0, tte), 0);
    }
    assert_eq!(digital_prob_above_wad(0, 100, 8_000, DAY), 0);
    assert_eq!(digital_prob_above_wad(100, 0, 8_000, DAY), WAD);
    assert_eq!(digital_prob_above_wad(0, 0, 8_000, DAY), WAD);
    // ATM with tiny total vol → just below 1/2 (−s/2 drift term).
    let p = digital_prob_above_wad(10_000_000_000, 10_000_000_000, 1, 1);
    assert!(p < WAD / 2 && WAD / 2 - p < 10_000_000_000, "{p}");
    // Extreme moneyness saturates exactly.
    assert_eq!(digital_prob_above_wad(1, u64::MAX, 50_000, 90 * DAY), 0);
    assert_eq!(digital_prob_above_wad(u64::MAX, 1, 50_000, 90 * DAY), WAD);
    // ln(S/K) = 5.4e-20 vs σ√T = 1.78e-8: d2 ≈ −σ√T/2, N ≈ 1/2 − 3.55e-9.
    let p = digital_prob_above_wad(u64::MAX, u64::MAX - 1, 1, 1);
    let sig = 1e-4 * (1.0f64 / 31_536_000.0).sqrt();
    let d2 = (1.0 / u64::MAX as f64) / sig - sig / 2.0;
    let want = 0.5 + d2 / (2.0 * std::f64::consts::PI).sqrt();
    assert!((p as f64 / 1e18 - want).abs() < 1e-15, "{p} vs {want}");
}

#[test]
fn digital_never_panics_and_in_range() {
    let mut rng = Rng(3);
    let specials_u64 = [0u64, 1, 2, 3, 99, 100, 101, 1 << 32, u64::MAX / 2, u64::MAX - 1, u64::MAX];
    let specials_vol = [0u32, 1, 2, 9_999, 10_000, 50_000, 1_000_000, u32::MAX];
    let specials_tte = [i64::MIN, -1, 0, 1, 2, 600, DAY, 90 * DAY, 100 * 365 * DAY, i64::MAX];
    for &s in &specials_u64 {
        for &k in &specials_u64 {
            for &v in &specials_vol {
                for &t in &specials_tte {
                    let p = digital_prob_above_wad(s, k, v, t);
                    assert!(p <= WAD);
                }
            }
        }
    }
    for _ in 0..300_000 {
        let s = rng.log_u64(64);
        let k = if rng.below(3) == 0 { s.wrapping_add(rng.below(5)).wrapping_sub(2).max(1) } else { rng.log_u64(64) };
        let v = (rng.log_u64(32)) as u32;
        let t = rng.log_u64(63) as i64 - if rng.below(10) == 0 { 1 << 20 } else { 0 };
        let p = digital_prob_above_wad(s, k, v, t);
        assert!(p <= WAD);
    }
}

#[test]
fn digital_monotone_in_spot_and_strike() {
    let k: u64 = 15_000_000_000; // $150
    for &v in &VOLS {
        for &t in &TTES {
            let mut prev = 0u128;
            // spot from $100 to $225, steps of 0.1% (relative), plus exact ATM.
            let mut s = 10_000_000_000u64;
            while s < 22_500_000_000 {
                let p = digital_prob_above_wad(s, k, v, t);
                assert!(p >= prev, "spot not monotone v={v} t={t} s={s}");
                prev = p;
                s += s / 1_000;
            }
            let mut prev = WAD;
            let mut kk = 10_000_000_000u64;
            while kk < 22_500_000_000 {
                let p = digital_prob_above_wad(k, kk, v, t);
                assert!(p <= prev, "strike not monotone v={v} t={t} k={kk}");
                prev = p;
                kk += kk / 1_000;
            }
        }
    }
    // Unit steps around ATM with tiny and normal total vol.
    for &(v, t) in &[(1u32, 1i64), (100, 60), (8_000, 600), (8_000, DAY)] {
        let mut prev = 0u128;
        for s in (k - 2_000)..(k + 2_000) {
            let p = digital_prob_above_wad(s, k, v, t);
            assert!(p + 1_000 >= prev, "unit-step spot dip v={v} t={t} s={s}: {p} < {prev}");
            prev = prev.max(p);
        }
    }
}

#[test]
fn digital_tte_and_vol_shape() {
    // d2 = L/s − s/2 with s = σ√T. ITM/ATM (L >= 0): N(d2) is non-increasing in s.
    // OTM (L < 0): non-decreasing while s² < −2L, non-increasing afterwards.
    let k: u64 = 6_000_000_000_000; // $60k
    for &s in &[5_400_000_000_000u64, 5_940_000_000_000, k, 6_060_000_000_000, 6_600_000_000_000] {
        let l = (s as f64 / k as f64).ln();
        for &v in &VOLS {
            let mut prev: Option<(u128, f64)> = None;
            let mut t = 1i64;
            while t <= 90 * DAY {
                let p = digital_prob_above_wad(s, k, v, t);
                let sig = v as f64 / 1e4 * (t as f64 / 31_536_000.0).sqrt();
                if let Some((q, sig0)) = prev {
                    // Both points must lie on the same side of the peak s² = −2L.
                    let increasing_zone = l < 0.0 && sig * sig < -2.0 * l * 0.98;
                    let decreasing_zone = l >= 0.0 || sig0 * sig0 > -2.0 * l * 1.02;
                    if increasing_zone {
                        assert!(p + 1_000 >= q, "OTM should rise s={s} v={v} t={t}");
                    } else if decreasing_zone {
                        assert!(p <= q + 1_000, "should fall s={s} v={v} t={t}");
                    }
                }
                prev = Some((p, sig));
                t += t / 8 + 1;
            }
        }
    }
    // Same shape in vol at fixed tte.
    for &t in &TTES {
        let mut prev = WAD;
        for v in (1..=50_000u32).step_by(997) {
            let p = digital_prob_above_wad(k, k, v, t);
            assert!(p <= prev, "ATM must fall with vol t={t} v={v}");
            prev = p;
        }
    }
}

#[test]
fn digital_extreme_ratios_and_ranges() {
    for &v in &VOLS {
        for &t in &TTES {
            // spot/strike ~ 1e-10 and 1e10: at most 2.48 total vol → |d2| >= 8.0 → < 1e-15.
            assert!(digital_prob_above_wad(100, 1_000_000_000_000, v, t) < 1_000, "v={v} t={t}");
            assert!(digital_prob_above_wad(1_000_000_000_000, 100, v, t) > WAD - 1_000, "v={v} t={t}");
            // close to 1/2 at the money for small total vol
            let p = digital_prob_above_wad(1_000_000_000, 1_000_000_000, v, t);
            assert!(p <= WAD / 2);
        }
    }
    // A realistic quote: SOL $150, strike $155, 80% vol, 1 day ≈ 0.21070.
    let p = digital_prob_above_wad(15_000_000_000, 15_500_000_000, 8_000, DAY);
    assert!((p as f64 / 1e18 - 0.210_699_118_831_643_6).abs() < 1e-15, "{p}");
}

#[test]
fn prob_to_tick_rounding_and_clamping() {
    let c = WAD / 100; // one cent
    let cases: [(u128, u8); 16] = [
        (0, 1),
        (1, 1),
        (c / 2 - 1, 1),
        (c / 2, 1),
        (c + c / 2 - 1, 1),
        (c + c / 2, 2),
        (37 * c, 37),
        (37 * c + c / 2 - 1, 37),
        (37 * c + c / 2, 38),
        (WAD / 2, 50),
        (98 * c + c / 2 - 1, 98),
        (98 * c + c / 2, 99),
        (99 * c, 99),
        (WAD, 99),
        (WAD + 1, 99),
        (u128::MAX, 99),
    ];
    for (p, t) in cases {
        assert_eq!(prob_to_tick(p), t, "p={p}");
    }
    let mut prev = 1;
    for i in 0..=10_000u128 {
        let t = prob_to_tick(i * WAD / 10_000);
        assert!((1..=99).contains(&t) && t >= prev);
        prev = t;
    }
}
