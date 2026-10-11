//! Fixed-point digital-option pricing. OWNER: pricing agent. Pure, deterministic, no floats.
//!
//! Model (quoting aid only, never used for settlement): lognormal, zero rate, zero drift,
//! constant vol. `P(S_T >= K) = N(d2)`, `d2 = (ln(S/K) - σ²T/2) / (σ√T)`.
//!
//! # Number formats
//! Public inputs/outputs are WAD (1e18) like the EVM `PricingLib`. Internally everything is
//! binary fixed point so that rescaling is a shift (cheap on SBF) instead of a 128-bit division:
//! * `ln(S/K)`, `σ√T` and `d2` are Q60 (`i128`/`u128`, 1.0 = 2^60, resolution 8.7e-19).
//! * The normal CDF runs in Q52 (1.0 = 2^52, resolution 2.2e-16) — that keeps every Horner
//!   intermediate of the rational approximation below 2^124 (no 256-bit math needed).
//!
//! # Normal CDF approximation
//! Hart (1968) double-precision algorithm 5666 in the form published by G. West, "Better
//! approximations to cumulative normal functions" (2005) — the same algorithm as the EVM
//! `PricingLib.normCdfWad`, so both chains quote the same fair values:
//! * `|x| < 7.07106781186547`: `N(-|x|) = exp(-x²/2) · P6(|x|) / Q7(|x|)` (degree-6 / degree-7
//!   rational function, Horner form).
//! * otherwise: `N(-|x|) = exp(-x²/2) / (B · √(2π))` with the continued fraction
//!   `B = x + 1/(x + 2/(x + 3/(x + 4/(x + 0.65))))`.
//! The lower tail `q = N(-|x|)` is computed once and mirrored (`N(x) = 1 - q` for `x > 0`), so
//! `norm_cdf_wad(x) + norm_cdf_wad(-x) == WAD` exactly. `|x| >= 9` saturates to 0 / WAD.
//! The algorithm itself is accurate to ~1e-15; the Q52 evaluation adds < 1e-15. Measured max
//! absolute error vs a 100-digit reference (`tests/pricing_data`, 4,000+ points on [-10, 10]):
//! see `tests/pricing_golden.rs` (≈ 1e-15, i.e. ~10³ WAD units; target was 1e-6).
//!
//! `exp` uses range reduction `e^-y = 2^-k · e^-r`, `|r| <= ln2/2`, and a degree-13 Taylor
//! polynomial (truncation < 4e-18). `ln(S/K)` is computed from the exact integers: `S/K` is
//! scaled by a power of two into `[1/√2, √2]` and `ln(a/b) = 2·atanh((a-b)/(a+b))` (11-term odd
//! series, truncation < 2e-19), so `S == K` gives exactly 0 and `S ≈ K` keeps full relative
//! precision. `σ√T = sqrt(vol_bps² · tte / (1e8 · 31_536_000))` is evaluated from the exact
//! integer variance with one 128-bit integer square root (u64 Newton seed + ≤ 4 u128 steps).
//!
//! Every loop is bounded by a small constant; no allocation, no tables; all arithmetic is
//! range-checked by construction (the comments give the worst-case bit widths) so the
//! overflow-checked release build can never panic.

/// 1e18 fixed point.
pub const WAD: u128 = 1_000_000_000_000_000_000;

/// Seconds per year used to annualise volatility (365 days, same as the EVM version).
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

/// |x| at/above which `norm_cdf_wad` saturates (N(-9) = 1.1e-19 < 1 WAD unit).
pub const CDF_CLAMP_WAD: i128 = 9 * WAD as i128;

// ───────────────────────────── fixed-point constants ─────────────────────────────

/// Q60 one (ln / d2 stage).
const F60: u32 = 60;
const ONE60: i128 = 1 << F60;
/// Q52 one (CDF stage).
const F52: u32 = 52;
const ONE52: u128 = 1 << F52;

/// round(ln 2 · 2^60).
const LN2_Q60: i128 = 799_144_290_325_165_979;
/// round(ln 2 · 2^52).
const LN2_Q52: u128 = 3_121_657_384_082_680;
/// round(2^52 / ln 2).
const INV_LN2_Q52: u128 = 6_497_320_848_556_798;
/// round(√(2π) · 2^52).
const SQRT_2PI_Q52: u128 = 11_288_850_163_584_523;
/// West's branch point 7.07106781186547 (5√2) in Q52.
const HART_SPLIT_Q52: u128 = 31_845_258_362_628_839;
/// 0.65 in Q52 (continued-fraction tail seed).
const CF_SEED_Q52: u128 = 2_927_339_757_790_822;
/// Saturation point 9.0 in Q52 / Q60.
const CLAMP_Q52: u128 = 9 << F52;
const CLAMP_Q60: i128 = 9 << F60;

/// Hart/West numerator coefficients (x^6 .. x^0) in Q52:
/// 0.0352624965998911, 0.700383064443688, 6.37396220353165, 33.912866078383,
/// 112.079291497871, 221.213596169931, 220.206867912376.
const HART_NUM: [u128; 7] = [
    158_808_166_547_423,
    3_154_244_908_045_199,
    28_705_773_804_698_765,
    152_729_971_033_671_213,
    504_760_255_425_761_036,
    996_257_469_280_188_633,
    991_723_568_274_600_586,
];
/// Hart/West denominator coefficients (x^7 .. x^0) in Q52:
/// 0.0883883476483184, 1.75566716318264, 16.064177579207, 86.7807322029461,
/// 296.564248779674, 637.333633378831, 793.826512519948, 440.413735824752.
const HART_DEN: [u128; 8] = [
    398_065_729_532_861,
    7_906_821_981_895_953,
    72_346_624_159_730_122,
    390_825_673_212_126_858,
    1_335_606_640_295_550_899,
    2_870_295_513_795_587_603,
    3_575_076_785_981_658_190,
    1_983_447_136_549_201_172,
];

/// Variance denominator: σ²T = vol_bps² · tte / (1e4² · SECONDS_PER_YEAR).
const VAR_DEN: u128 = 100_000_000 * SECONDS_PER_YEAR as u128;

/// round(2^60 / (2k+1)), k = 0..=10 — atanh series coefficients.
const ATANH_C: [i128; 11] = {
    let mut c = [0i128; 11];
    let mut k = 0;
    while k < 11 {
        let d = 2 * k as i128 + 1;
        c[k] = (ONE60 + d / 2) / d;
        k += 1;
    }
    c
};

/// round(2^52 / j!), j = 0..=13 — Taylor coefficients of exp.
const EXP_C: [i128; 14] = {
    let mut c = [0i128; 14];
    let mut f: i128 = 1;
    let mut j = 0;
    while j < 14 {
        if j > 0 {
            f *= j as i128;
        }
        c[j] = (ONE52 as i128 + f / 2) / f;
        j += 1;
    }
    c
};

// ───────────────────────────── public API ─────────────────────────────

/// Standard normal CDF, WAD in → WAD out (result in `[0, WAD]`).
///
/// Hart/West rational approximation (see module docs); measured |error| ≈ 1e-15 (≪ 1e-6).
/// Exactly symmetric: `norm_cdf_wad(x) + norm_cdf_wad(-x) == WAD`. Saturates for `|x| >= 9`.
pub fn norm_cdf_wad(x_wad: i128) -> u128 {
    if x_wad <= -CDF_CLAMP_WAD {
        return 0;
    }
    if x_wad >= CDF_CLAMP_WAD {
        return WAD;
    }
    // |x| < 9e18 → |x| · 2^52 < 2^115.
    let ax = x_wad.unsigned_abs();
    let ax_q52 = ((ax << F52) + WAD / 2) / WAD;
    let q = q52_to_wad(lower_tail_q52(ax_q52));
    if x_wad < 0 {
        q
    } else {
        WAD - q
    }
}

/// P(S_T >= K) under zero-rate lognormal: N(d2), d2 = (ln(S/K) - σ²T/2) / (σ√T).
/// `spot_e8`, `strike_e8` in 1e-8 USD; `vol_bps` annualised (10_000 = 100%); `tte_secs` time to
/// expiry. Never panics: T <= 0 or σ = 0 → intrinsic (1 if spot >= strike else 0); clamps extremes.
///
/// Degenerate inputs: `strike == 0` → WAD (S_T >= 0 always); `spot == 0` (strike > 0) → 0.
/// No input clamping is needed: the full u64/u32/i64 ranges are representable; `|d2| >= 9`
/// saturates to exactly 0 / WAD.
pub fn digital_prob_above_wad(spot_e8: u64, strike_e8: u64, vol_bps: u32, tte_secs: i64) -> u128 {
    if strike_e8 == 0 {
        return WAD;
    }
    if spot_e8 == 0 {
        return 0;
    }
    if tte_secs <= 0 || vol_bps == 0 {
        return if spot_e8 >= strike_e8 { WAD } else { 0 };
    }
    let (sr, fs) = total_vol(vol_bps, tte_secs as u64);
    if sr == 0 {
        // Unreachable for vol >= 1 bps and tte >= 1 s; kept for safety: continuous limit of
        // N(d2) as σ√T → 0.
        return match spot_e8.cmp(&strike_e8) {
            core::cmp::Ordering::Greater => WAD,
            core::cmp::Ordering::Less => 0,
            core::cmp::Ordering::Equal => WAD / 2,
        };
    }
    // d2 = ln(S/K)/s − s/2 in Q60 (both terms < 2^121 by construction / saturation).
    let (neg, l_over_s) = ln_ratio_over_s_q60(spot_e8, strike_e8, sr, fs);
    // s/2 · 2^60 = sr · 2^(59 − fs).
    let half_s = if fs >= 59 {
        let sh = fs - 59;
        (sr + (1 << sh >> 1)) >> sh
    } else {
        sr << (59 - fs) // fs >= 25 → < 2^98
    };
    let d2: i128 = if neg {
        -(l_over_s as i128) - half_s as i128
    } else {
        l_over_s as i128 - half_s as i128
    };
    if d2 >= CLAMP_Q60 {
        return WAD;
    }
    if d2 <= -CLAMP_Q60 {
        return 0;
    }
    // Q60 → Q52, rounding the magnitude (keeps N(d) / N(−d) mirrored exactly).
    let ad = d2.unsigned_abs();
    let ax = (ad + (1 << (F60 - F52 - 1))) >> (F60 - F52);
    let q = q52_to_wad(lower_tail_q52(ax));
    if d2 < 0 {
        q
    } else {
        WAD - q
    }
}

/// Probability (WAD) → nearest tick, clamped to 1..=99.
/// Round-half-up (0.375 → 38); values > WAD are treated as WAD (same as the EVM `probToTick`).
pub fn prob_to_tick(p_wad: u128) -> u8 {
    let p = if p_wad > WAD { WAD } else { p_wad };
    let t = (p * 100 + WAD / 2) / WAD; // p·100 <= 1e20
    t.clamp(1, 99) as u8
}

// ───────────────────────────── internals ─────────────────────────────

/// Q52 probability → WAD, round-half-up. `q <= 2^52` → `q · 1e18 < 2^112`.
#[inline]
fn q52_to_wad(q: u128) -> u128 {
    (q * WAD + (1 << (F52 - 1))) >> F52
}

/// N(−x) for `x >= 0` in Q52 (Hart/West). Result in `[0, 2^51]`.
fn lower_tail_q52(x: u128) -> u128 {
    if x >= CLAMP_Q52 {
        return 0;
    }
    // x < 9 · 2^52 < 2^55.2 → x² < 2^110.4; y = x²/2 in Q52.
    let y = (x * x) >> (F52 + 1);
    let e = exp_neg_q52(y); // <= 2^52
    let q = if x < HART_SPLIT_Q52 {
        // Horner in Q52. x < 7.08 · 2^52 < 2^54.9. Largest |P| ≈ 5.2e4 (2^15.7 → 2^67.7 in Q52),
        // largest pre-multiplication |Q| ≈ 1.4e5 (2^69.1) → every product < 2^124.
        let mut n = HART_NUM[0];
        let mut i = 1;
        while i < HART_NUM.len() {
            n = ((n * x) >> F52) + HART_NUM[i];
            i += 1;
        }
        let mut d = HART_DEN[0];
        let mut i = 1;
        while i < HART_DEN.len() {
            d = ((d * x) >> F52) + HART_DEN[i];
            i += 1;
        }
        // e · n < 2^52 · 2^67.7; d >= 440 · 2^52 > 0.
        (e * n) / d
    } else {
        // Continued fraction (x >= 7.07): every b >= x >= 7 · 2^52, numerators <= 4 · 2^104.
        let mut b = x + CF_SEED_Q52;
        b = x + (4u128 << (2 * F52)) / b;
        b = x + (3u128 << (2 * F52)) / b;
        b = x + (2u128 << (2 * F52)) / b;
        b = x + (1u128 << (2 * F52)) / b;
        // b < 2^55.3, √(2π) < 2^53.4 → product < 2^109.
        let den = (b * SQRT_2PI_Q52) >> F52;
        (e << F52) / den
    };
    let half = ONE52 / 2;
    if q > half {
        half
    } else {
        q
    }
}

/// e^(−y) for `y >= 0` in Q52.
fn exp_neg_q52(y: u128) -> u128 {
    // e^-45 = 2.9e-20 < 2^-52 / 4: rounds to 0 in Q52.
    if y >= (45u128 << F52) {
        return 0;
    }
    // k = round(y / ln2) <= 65; y · (1/ln2) < 2^57.5 · 2^52.6 = 2^110.1.
    let k = ((y * INV_LN2_Q52 + (1u128 << (2 * F52 - 1))) >> (2 * F52)) as u32;
    // r = y − k·ln2, |r| <= ln2/2 + ε. We evaluate e^(−r) = Σ t^j/j!, t = −r.
    let t = (k as i128) * (LN2_Q52 as i128) - y as i128;
    let mut p = EXP_C[13];
    let mut j = 13;
    while j > 0 {
        j -= 1;
        // |p| < 1.5 · 2^52, |t| < 0.35 · 2^52 → product < 2^103.
        p = EXP_C[j] + ((p * t) >> F52);
    }
    // p ∈ [0.70, 1.42] · 2^52 > 0.
    let p = p as u128;
    if k == 0 {
        p
    } else if k >= 64 {
        0
    } else {
        (p + (1u128 << (k - 1))) >> k
    }
}

/// `ln(a/b) = e·ln2 + 2·atanh(z)`, `z = num/den` (exact integers, |z| <= 0.1716) and
/// `atanh(z) = z·p` with `p` in Q60.
struct LogRatio {
    e: i128,
    num: i128,
    den: i128,
    z: i128,
    p: i128,
}

/// Decompose ln(a/b) for `a, b >= 1` (see `LogRatio`).
fn log_ratio(a: u64, b: u64) -> LogRatio {
    let la = 64 - a.leading_zeros();
    let lb = 64 - b.leading_zeros();
    let (mut x, mut y) = (a as u128, b as u128);
    // a/b = (x/y) · 2^e after aligning bit lengths (shift left only → exact).
    let mut e: i128 = la as i128 - lb as i128;
    if la > lb {
        y <<= la - lb;
    } else {
        x <<= lb - la;
    }
    // x, y < 2^64 and x/y ∈ (1/2, 2); move the ratio into [1/√2, √2] (threshold need not be
    // exact, it only bounds |z| <= 0.1716).
    if x * 10_000 > y * 14_142 {
        y <<= 1;
        e += 1;
    } else if x * 14_142 < y * 10_000 {
        x <<= 1;
        e -= 1;
    }
    // x, y < 2^65; |x − y| <= 0.1716 (x + y) < 2^63.5; den >= 2.
    let num = x as i128 - y as i128;
    let den = (x + y) as i128;
    let z = (num << F60) / den; // |z| <= 0.1716 · 2^60
    let w = (z * z) >> F60;
    // atanh(z)/z = Σ w^k/(2k+1), k = 0..=10 (truncation < z^23/23 < 2e-19).
    let mut p = ATANH_C[10];
    let mut k = 10;
    while k > 0 {
        k -= 1;
        p = ATANH_C[k] + ((p * w) >> F60);
    }
    LogRatio { e, num, den, z, p }
}

/// ln(a / b) in Q60 for `a, b >= 1`. Exact 0 for `a == b`; |result| <= 44.4 · 2^60.
#[cfg(test)]
fn ln_ratio_q60(a: u64, b: u64) -> i128 {
    if a == b {
        return 0;
    }
    let r = log_ratio(a, b);
    r.e * LN2_Q60 + 2 * ((r.z * r.p) >> F60)
}

/// |ln(a/b)| / s in Q60 together with the sign of ln(a/b), where `s = sr · 2^-fs`
/// (`sr` normalised to [2^62, 2^64), see `total_vol`).
///
/// When `e != 0`, |ln(a/b)| >= 0.34 and the Q60 logarithm is accurate to ~1e-17 relative.
/// When `e == 0` the ratio may be extremely close to 1 (ln ≈ 1e-19) while s is tiny (1 bps over
/// 1 s → 1.8e-8), so a Q60 logarithm would lose all relative precision; instead
/// `2·|num|·p / (den · s)` is formed from a normalised numerator so the quotient keeps ≥ 60
/// significant bits.
fn ln_ratio_over_s_q60(a: u64, b: u64, sr: u128, fs: u32) -> (bool, u128) {
    if a == b {
        return (false, 0);
    }
    let r = log_ratio(a, b);
    if r.e != 0 {
        let l = r.e * LN2_Q60 + 2 * ((r.z * r.p) >> F60); // |l| < 2^65.5
        // |l|/s · 2^60 = |l| · 2^fs / sr.
        return (l < 0, div_shl(l.unsigned_abs(), fs, sr));
    }
    // pp = |num| · p < 2^63.5 · 2^60.1; bitlen(pp) >= 61 → k <= 65.
    let pp = r.num.unsigned_abs() * r.p as u128;
    let k = 126 - (128 - pp.leading_zeros());
    // q = |atanh(z)| · 2^(60+k) (126-bit numerator, den >= 2).
    let q = (pp << k) / r.den as u128;
    // |ln|/s · 2^60 = 2q/2^(60+k) · 2^fs/sr · 2^60 = q · 2^(1 + fs − k) / sr.
    let m = 1 + fs as i32 - k as i32; // in [-39, 87]
    let mag = if m >= 0 {
        div_shl(q, m as u32, sr)
    } else {
        // Only when σ√T is huge (fs small): the quotient is far below 1 and only needs
        // absolute Q60 precision.
        (q >> (-m) as u32) / sr
    };
    (r.num < 0, mag)
}

/// floor(n · 2^m / d) for `d` in [2^62, 2^64), saturating at 2^120 (callers clamp |d2| at 9 · 2^60).
fn div_shl(n: u128, m: u32, d: u128) -> u128 {
    const SAT: u128 = 1 << 120;
    if n == 0 {
        return 0;
    }
    // First shift as far as the numerator allows, then finish with the remainder (< d < 2^64).
    let m1 = m.min(n.leading_zeros());
    let nn = n << m1;
    let q = nn / d;
    let rem = nn % d;
    let m2 = m - m1;
    if m2 == 0 {
        return q;
    }
    if m2 > 64 || (q >> (120 - m2.min(120))) != 0 {
        return SAT;
    }
    (q << m2) | ((rem << m2) / d)
}

/// σ√T from the exact integer variance `vol_bps² · tte / VAR_DEN`, as `(sr, fs)` with
/// `σ√T = sr · 2^-fs`, `sr` in [2^62, 2^64) (≥ 62 significant bits for every input).
/// `vol_bps >= 1`, `tte >= 1` → σ√T in [1.78e-8, 1.4e11], fs in [25, 87].
fn total_vol(vol_bps: u32, tte: u64) -> (u128, u32) {
    let vol = vol_bps as u128;
    // vol² < 2^64, tte < 2^63 → v < 2^127 (exact).
    let v = vol * vol * tte as u128;
    if v == 0 {
        return (0, 0);
    }
    // Radicand v · 2^(sh1+sh2) / VAR_DEN with ~126 significant bits: largest even pre-shift that
    // fits, one division, then a second even shift.
    let bl = 128 - v.leading_zeros(); // 1..=127
    let sh1 = ((127 - bl) & !1).min(120);
    let x = (v << sh1) / VAR_DEN; // >= 2^68 (v << sh1 >= 2^120 > VAR_DEN · 2^68)
    let blx = 128 - x.leading_zeros();
    let sh2 = (127 - blx) & !1;
    (isqrt_u128(x << sh2), (sh1 + sh2) / 2)
}

/// floor(√n) for u64 (native 64-bit Newton; ≤ 7 iterations from an over-estimate).
fn isqrt_u64(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    let bits = 64 - n.leading_zeros();
    let mut x: u64 = 1 << ((bits + 1) / 2); // > √n, <= 2^32
    let mut i = 0;
    while i < 40 {
        let y = (x + n / x) >> 1;
        if y >= x {
            break;
        }
        x = y;
        i += 1;
    }
    x
}

/// floor(√n) for u128: u64 seed from the top bits, then Newton from above (≤ 4 u128 divisions).
fn isqrt_u128(n: u128) -> u128 {
    if n <= u64::MAX as u128 {
        return isqrt_u64(n as u64) as u128;
    }
    let bits = 128 - n.leading_zeros(); // 65..=128
    let shift = (bits - 63 + 1) & !1; // even; n >> shift < 2^64 (shift <= 66)
    let top = isqrt_u64((n >> shift) as u64) as u128;
    // (top + 1)² > n >> shift  ⇒  x > √n; relative error ≈ 2^-31.
    let mut x = (top + 1) << (shift / 2);
    let mut i = 0;
    while i < 8 {
        let y = (x + n / x) >> 1;
        if y >= x {
            break;
        }
        x = y;
        i += 1;
    }
    x
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn isqrt_exact() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, u64::MAX as u128, 1 << 64, (1 << 64) + 1, u128::MAX >> 1, u128::MAX] {
            let r = isqrt_u128(n);
            assert!(r * r <= n, "n={n}");
            let r1 = r + 1;
            assert!(r1.checked_mul(r1).map_or(true, |s| s > n), "n={n}");
        }
    }

    #[test]
    fn ln_ratio_basic() {
        let l = ln_ratio_q60(2, 1);
        assert!((l - LN2_Q60).abs() <= 2);
        assert_eq!(ln_ratio_q60(7, 7), 0);
        assert!((ln_ratio_q60(3, 5) + ln_ratio_q60(5, 3)).abs() <= 2);
    }
}
