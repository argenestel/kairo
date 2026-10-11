//! Host tests for the Pyth PriceUpdateV2 parser against real devnet bytes.
//! Fixtures: `solana account <addr> --url devnet --output json` (SOL + BTC sponsored feeds, shard 0).
use anchor_lang::prelude::*;
use montions::constants::PYTH_RECEIVER_ID;
use montions::errors::MontionsError;
use montions::oracle::*;

const SOL_FEED: &str = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const BTC_FEED: &str = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

fn b64(s: &str) -> Vec<u8> {
    let val = |c: u8| -> u32 {
        match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => panic!("bad base64"),
        }
    };
    let bytes: Vec<u8> = s.bytes().filter(|&c| c != b'=').collect();
    let mut out = Vec::new();
    for chunk in bytes.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= val(c) << (18 - 6 * i);
        }
        out.push((acc >> 16) as u8);
        if chunk.len() > 2 {
            out.push((acc >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(acc as u8);
        }
    }
    out
}

/// Extract (owner, data) from a `solana account --output json` dump without a JSON dependency.
fn load_fixture(name: &str) -> (Pubkey, Vec<u8>) {
    let path = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    let json = std::fs::read_to_string(path).unwrap();
    let data_start = json.find("\"data\"").unwrap();
    let q1 = data_start + json[data_start..].find('[').unwrap();
    let s1 = q1 + json[q1..].find('"').unwrap() + 1;
    let s2 = s1 + json[s1..].find('"').unwrap();
    let data = b64(&json[s1..s2]);
    let o = json.find("\"owner\"").unwrap();
    let o1 = o + 7 + json[o + 7..].find('"').unwrap() + 1;
    let o2 = o1 + json[o1..].find('"').unwrap();
    (json[o1..o2].parse().unwrap(), data)
}

fn code(e: Error) -> u32 {
    match e {
        Error::AnchorError(a) => a.error_code_number,
        Error::ProgramError(p) => panic!("unexpected program error {p:?}"),
    }
}

fn mcode(e: MontionsError) -> u32 {
    code(e.into())
}

fn with_account<R>(owner: &Pubkey, data: &mut [u8], f: impl FnOnce(&AccountInfo) -> R) -> R {
    let key = Pubkey::new_unique();
    let mut lamports = 1_000_000u64;
    let acc = AccountInfo::new(&key, false, false, &mut lamports, data, owner, false, 0);
    f(&acc)
}

/// Minimal SHA-256 (FIPS 180-4) so the test needs no extra dependency.
fn sha256(msg: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] =
        [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut m = msg.to_vec();
    let bit_len = (msg.len() as u64) * 8;
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0);
    }
    m.extend_from_slice(&bit_len.to_be_bytes());
    for block in m.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[4 * i], block[4 * i + 1], block[4 * i + 2], block[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 32];
    for (i, x) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&x.to_be_bytes());
    }
    out
}

#[test]
fn discriminator_is_sha256_prefix() {
    // Self-check of the helper against the FIPS test vector for "abc".
    assert_eq!(sha256(b"abc")[..4], [0xba, 0x78, 0x16, 0xbf]);
    assert_eq!(sha256(b"account:PriceUpdateV2")[..8], PRICE_UPDATE_V2_DISCRIMINATOR);
}

#[test]
fn parses_live_sol_devnet_account() {
    let (owner, mut data) = load_fixture("pyth_sol_devnet.json");
    assert_eq!(owner, PYTH_RECEIVER_ID);
    assert_eq!(data.len(), 134);
    let p = with_account(&owner, &mut data, |a| load_price_update(a)).unwrap();
    assert_eq!(p.feed_id, hex32(SOL_FEED));
    assert_eq!(p.expo, -8);
    assert!(p.price > 0);
    assert!(p.conf > 0 && p.conf_ok(200), "conf {} price {}", p.conf, p.price);
    assert!(p.publish_time > 1_700_000_000);
    assert!(p.prev_publish_time <= p.publish_time && p.prev_publish_time > p.publish_time - 3_600);
    // SOL in a sane USD range, in 1e-8.
    let e8 = to_e8(p.price, p.expo).unwrap();
    assert_eq!(e8, p.price);
    assert!(e8 > 1_00000000 && e8 < 100_000_00000000, "SOL e8 = {e8}");
}

#[test]
fn parses_live_btc_devnet_account() {
    let (owner, mut data) = load_fixture("pyth_btc_devnet.json");
    let p = with_account(&owner, &mut data, |a| load_price_update(a)).unwrap();
    assert_eq!(p.feed_id, hex32(BTC_FEED));
    let e8 = to_e8(p.price, p.expo).unwrap();
    assert!(e8 > 1_000_00000000 && e8 < 10_000_000_00000000, "BTC e8 = {e8}");
}

#[test]
fn rejects_wrong_owner() {
    let (_, mut data) = load_fixture("pyth_sol_devnet.json");
    let other = Pubkey::new_unique();
    let e = with_account(&other, &mut data, |a| load_price_update(a)).unwrap_err();
    assert_eq!(code(e), mcode(MontionsError::BadPriceAccount));
}

#[test]
fn rejects_bad_discriminator() {
    let (owner, mut data) = load_fixture("pyth_sol_devnet.json");
    data[0] ^= 1;
    let e = with_account(&owner, &mut data, |a| load_price_update(a)).unwrap_err();
    assert_eq!(code(e), mcode(MontionsError::BadPriceAccount));
}

#[test]
fn rejects_partial_verification() {
    let (owner, data) = load_fixture("pyth_sol_devnet.json");
    // Re-encode as Partial { num_signatures: 5 }: tag 0 + one extra byte, rest shifted by one.
    let mut partial = data[..40].to_vec();
    partial.push(0);
    partial.push(5);
    partial.extend_from_slice(&data[41..133]);
    assert_eq!(partial.len(), 134);
    let e = with_account(&owner, &mut partial, |a| load_price_update(a)).unwrap_err();
    assert_eq!(code(e), mcode(MontionsError::PriceNotVerified));
}

#[test]
fn rejects_unknown_verification_tag_and_short_data() {
    let (owner, data) = load_fixture("pyth_sol_devnet.json");
    let mut bad = data.clone();
    bad[40] = 2;
    let e = with_account(&owner, &mut bad, |a| load_price_update(a)).unwrap_err();
    assert_eq!(code(e), mcode(MontionsError::BadPriceAccount));
    for len in [0usize, 8, 40, 41, 100, 132] {
        let mut short = data[..len].to_vec();
        let e = with_account(&owner, &mut short, |a| load_price_update(a)).unwrap_err();
        assert_eq!(code(e), mcode(MontionsError::BadPriceAccount), "len {len}");
    }
    // Exactly 133 bytes (Full without padding) is fine.
    let mut exact = data[..133].to_vec();
    assert!(with_account(&owner, &mut exact, |a| load_price_update(a)).is_ok());
}

#[test]
fn field_offsets_round_trip() {
    let (_, mut data) = load_fixture("pyth_sol_devnet.json");
    data[73..81].copy_from_slice(&123_456_789i64.to_le_bytes());
    data[81..89].copy_from_slice(&42u64.to_le_bytes());
    data[89..93].copy_from_slice(&(-5i32).to_le_bytes());
    data[93..101].copy_from_slice(&1_800_000_000i64.to_le_bytes());
    data[101..109].copy_from_slice(&1_799_999_999i64.to_le_bytes());
    let p = parse_price_update(&data).unwrap();
    assert_eq!(
        (p.price, p.conf, p.expo, p.publish_time, p.prev_publish_time),
        (123_456_789, 42, -5, 1_800_000_000, 1_799_999_999)
    );
}

#[test]
fn conf_check_boundary() {
    let mut p = PythPrice { feed_id: [0; 32], price: 10_000, conf: 200, expo: -8, publish_time: 0, prev_publish_time: 0 };
    assert!(p.conf_ok(200)); // 2% exactly
    p.conf = 201;
    assert!(!p.conf_ok(200));
    p.price = -10_000;
    p.conf = 200;
    assert!(p.conf_ok(200)); // |price|
    p.price = i64::MIN;
    p.conf = u64::MAX;
    assert!(!p.conf_ok(1)); // no overflow
}

#[test]
fn to_e8_rescales() {
    assert_eq!(to_e8(15_012_345_678, -8).unwrap(), 15_012_345_678);
    assert_eq!(to_e8(150_123, -5).unwrap(), 150_123_000);
    assert_eq!(to_e8(150, 0).unwrap(), 15_000_000_000);
    assert_eq!(to_e8(3, 2).unwrap(), 30_000_000_000);
    // Finer exponents truncate toward zero.
    assert_eq!(to_e8(1_501_234_567_899, -10).unwrap(), 15_012_345_678);
    assert_eq!(to_e8(100, -10).unwrap(), 1);
    // i64::MIN expo (pathological) does not panic on the shift computation.
    assert!(to_e8(1, i32::MIN).is_err());
}

#[test]
fn to_e8_errors() {
    let bad = mcode(MontionsError::BadPriceAccount);
    let ovf = mcode(MontionsError::MathOverflow);
    assert_eq!(code(to_e8(0, -8).unwrap_err()), bad);
    assert_eq!(code(to_e8(-5, -8).unwrap_err()), bad);
    assert_eq!(code(to_e8(i64::MIN, -8).unwrap_err()), bad);
    // Truncates to zero.
    assert_eq!(code(to_e8(99, -10).unwrap_err()), bad);
    assert_eq!(code(to_e8(i64::MAX, -40).unwrap_err()), bad);
    assert_eq!(code(to_e8(i64::MAX, i32::MIN).unwrap_err()), bad);
    // Overflow.
    assert_eq!(code(to_e8(i64::MAX, -7).unwrap_err()), ovf);
    assert_eq!(code(to_e8(1, 11).unwrap_err()), ovf); // 1e19 > i64::MAX
    assert_eq!(code(to_e8(1, i32::MAX).unwrap_err()), ovf);
    // Largest representable.
    assert_eq!(to_e8(9, 10).unwrap(), 9_000_000_000_000_000_000);
    assert_eq!(to_e8(i64::MAX, -8).unwrap(), i64::MAX);
    assert_eq!(to_e8(i64::MAX, -26).unwrap(), 9);
}
