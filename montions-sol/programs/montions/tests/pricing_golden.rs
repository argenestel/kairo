//! Golden comparison of `pricing.rs` against a 110-digit decimal reference
//! (`tests/pricing_data/gen_golden.py`) and, when present, the EVM golden table
//! (`../../montions/test/pricing/golden.json`, Python `math.erf`).
use montions::pricing::{digital_prob_above_wad, norm_cdf_wad, WAD};
use std::path::PathBuf;

/// Spec tolerance is 1e-4 (target 1e-6); assert the much tighter level we actually achieve.
const CDF_TOL_WAD: u128 = 2_000; // 2e-15
const DIGITAL_TOL_WAD: u128 = 2_000; // 2e-15

fn data_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/pricing_data").join(name)
}

fn rows(name: &str) -> Vec<Vec<i128>> {
    let text = std::fs::read_to_string(data_path(name)).expect("golden file");
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| l.split_whitespace().map(|t| t.parse::<i128>().unwrap()).collect())
        .collect()
}

#[test]
fn cdf_matches_decimal_reference() {
    let rows = rows("golden_cdf.txt");
    assert!(rows.len() > 4000);
    let (mut worst, mut at) = (0u128, 0i128);
    for r in &rows {
        let got = norm_cdf_wad(r[0]);
        let err = got.abs_diff(r[1] as u128);
        if err > worst {
            worst = err;
            at = r[0];
        }
    }
    println!("cdf: {} rows, max |err| = {worst} WAD ({:.3e}) at x = {at}", rows.len(), worst as f64 / 1e18);
    assert!(worst <= CDF_TOL_WAD, "max cdf err {worst} at {at}");
}

#[test]
fn digital_matches_decimal_reference() {
    let rows = rows("golden_digital.txt");
    assert!(rows.len() > 4000);
    let (mut worst, mut at) = (0u128, vec![]);
    for r in &rows {
        let got = digital_prob_above_wad(r[0] as u64, r[1] as u64, r[2] as u32, r[3] as i64);
        let err = got.abs_diff(r[4] as u128);
        if err > worst {
            worst = err;
            at = r.clone();
        }
    }
    println!("digital: {} rows, max |err| = {worst} WAD ({:.3e}) at {at:?}", rows.len(), worst as f64 / 1e18);
    assert!(worst <= DIGITAL_TOL_WAD, "max digital err {worst} at {at:?}");
}

/// Extract the integer array `"key": [ ... ]` from the EVM golden.json without a JSON dependency.
fn json_ints(text: &str, key: &str) -> Vec<i128> {
    let start = text.find(&format!("\"{key}\"")).expect("key");
    let open = start + text[start..].find('[').unwrap();
    let close = open + text[open..].find(']').unwrap();
    text[open + 1..close]
        .split(',')
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| t.parse::<i128>().unwrap())
        .collect()
}

#[test]
fn cdf_matches_evm_golden_table() {
    // montions-sol/programs/montions → ../../../montions (also tolerate one extra level for
    // the agent sandboxes under montions-sol-wt/<name>/).
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let found = ["../../../montions", "../../../../montions"]
        .iter()
        .map(|d| root.join(d).join("test/pricing/golden.json"))
        .find_map(|p| std::fs::read_to_string(&p).ok());
    let Some(text) = found else {
        println!("EVM golden.json not found next to the repo; skipping");
        return;
    };
    let xs = json_ints(&text, "cdfX");
    let ys = json_ints(&text, "cdfExpected");
    assert_eq!(xs.len(), ys.len());
    let mut worst = 0u128;
    for (x, y) in xs.iter().zip(&ys) {
        worst = worst.max(norm_cdf_wad(*x).abs_diff(*y as u128));
    }
    println!("EVM golden cdf: {} rows, max |err| = {worst} WAD", xs.len());
    // The EVM table is itself double precision (math.erf), ~1e-16.
    assert!(worst <= CDF_TOL_WAD);

    // Digital rows: EVM uses WAD prices / WAD vol. Convert the rows that are exactly
    // representable in our units (price multiple of 1e10, vol multiple of 1e14 = 1 bps).
    let spot = json_ints(&text, "spot");
    let strike = json_ints(&text, "strike");
    let vol = json_ints(&text, "vol");
    let secs = json_ints(&text, "seconds");
    let exp = json_ints(&text, "expected");
    let (mut n, mut worst) = (0, 0u128);
    for i in 0..spot.len() {
        let (s, k, v, t) = (spot[i], strike[i], vol[i], secs[i]);
        if s % 10_000_000_000 != 0 || k % 10_000_000_000 != 0 || v % 100_000_000_000_000 != 0 {
            continue;
        }
        let (s8, k8, vb) = (s / 10_000_000_000, k / 10_000_000_000, v / 100_000_000_000_000);
        if s8 > u64::MAX as i128 || k8 > u64::MAX as i128 || vb > u32::MAX as i128 {
            continue;
        }
        if (s8 == 0) != (s == 0) || (k8 == 0) != (k == 0) || (vb == 0) != (v == 0) {
            continue;
        }
        n += 1;
        let got = digital_prob_above_wad(s8 as u64, k8 as u64, vb as u32, t as i64);
        worst = worst.max(got.abs_diff(exp[i] as u128));
    }
    println!("EVM golden digital: {n} comparable rows, max |err| = {worst} WAD");
    assert!(n > 100);
    // math.log/erf double-precision reference: allow 1e-9.
    assert!(worst <= 1_000_000_000, "worst {worst}");
}

#[test]
fn golden_errors_far_below_spec() {
    // Explicit statement of the contract: |err| < 1e-6 everywhere in the tables.
    let one_e_minus_6 = WAD / 1_000_000;
    assert!(CDF_TOL_WAD < one_e_minus_6 && DIGITAL_TOL_WAD < one_e_minus_6);
}
