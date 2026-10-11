//! Pyth PriceUpdateV2 parsing (sponsored push feeds and posted updates). OWNER: program agent.
//!
//! We parse the Borsh layout by hand instead of depending on `pyth-solana-receiver-sdk` (keeps the
//! dependency tree and the program binary small). Layout (docs/SPEC.md §7):
//!
//! ```text
//! 0   disc[8] = sha256("account:PriceUpdateV2")[..8]
//! 8   write_authority [32]
//! 40  verification_level: 0 = Partial { num_signatures: u8 } (2 bytes) | 1 = Full (1 byte)
//! 41  feed_id [32]           (Full; Partial would shift everything below by one byte)
//! 73  price i64   81 conf u64   89 exponent i32   93 publish_time i64   101 prev_publish_time i64
//! 109 ema_price i64   117 ema_conf u64   125 posted_slot u64   → 133 bytes for Full
//! ```
use anchor_lang::prelude::*;

use crate::constants::{PRICE_DECIMALS, PYTH_RECEIVER_ID};
use crate::errors::MontionsError;

/// `sha256("account:PriceUpdateV2")[..8]` (checked against the hash in the host tests).
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

const VERIFICATION_OFFSET: usize = 40;
const VERIFICATION_PARTIAL: u8 = 0;
const VERIFICATION_FULL: u8 = 1;
/// Offsets for a Full-verified update.
const FEED_ID_OFFSET: usize = 41;
const PRICE_OFFSET: usize = 73;
const CONF_OFFSET: usize = 81;
const EXPO_OFFSET: usize = 89;
const PUBLISH_TIME_OFFSET: usize = 93;
const PREV_PUBLISH_TIME_OFFSET: usize = 101;
/// Minimum data length of a Full-verified PriceUpdateV2 (through `posted_slot`).
pub const PRICE_UPDATE_V2_FULL_LEN: usize = 133;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PythPrice {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
}

impl PythPrice {
    /// `conf / |price| <= max_conf_bps / 10_000`, in exact u128 arithmetic.
    pub fn conf_ok(&self, max_conf_bps: u16) -> bool {
        (self.conf as u128) * 10_000 <= (max_conf_bps as u128) * (self.price.unsigned_abs() as u128)
    }
}

/// Load a PriceUpdateV2 account: owner == PYTH_RECEIVER_ID, discriminator, verification Full.
pub fn load_price_update(acc: &AccountInfo) -> Result<PythPrice> {
    require_keys_eq!(*acc.owner, PYTH_RECEIVER_ID, MontionsError::BadPriceAccount);
    let data = acc.try_borrow_data()?;
    parse_price_update(&data)
}

/// Parse raw PriceUpdateV2 bytes (owner already checked by the caller). Exposed for host tests.
pub fn parse_price_update(data: &[u8]) -> Result<PythPrice> {
    require!(data.len() > VERIFICATION_OFFSET, MontionsError::BadPriceAccount);
    require!(data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR, MontionsError::BadPriceAccount);
    match data[VERIFICATION_OFFSET] {
        VERIFICATION_FULL => {}
        VERIFICATION_PARTIAL => return err!(MontionsError::PriceNotVerified),
        _ => return err!(MontionsError::BadPriceAccount),
    }
    require!(data.len() >= PRICE_UPDATE_V2_FULL_LEN, MontionsError::BadPriceAccount);

    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[FEED_ID_OFFSET..FEED_ID_OFFSET + 32]);
    Ok(PythPrice {
        feed_id,
        price: i64::from_le_bytes(read8(data, PRICE_OFFSET)),
        conf: u64::from_le_bytes(read8(data, CONF_OFFSET)),
        expo: i32::from_le_bytes(read4(data, EXPO_OFFSET)),
        publish_time: i64::from_le_bytes(read8(data, PUBLISH_TIME_OFFSET)),
        prev_publish_time: i64::from_le_bytes(read8(data, PREV_PUBLISH_TIME_OFFSET)),
    })
}

#[inline]
fn read8(data: &[u8], off: usize) -> [u8; 8] {
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[off..off + 8]);
    b
}

#[inline]
fn read4(data: &[u8], off: usize) -> [u8; 4] {
    let mut b = [0u8; 4];
    b.copy_from_slice(&data[off..off + 4]);
    b
}

/// Rescale a Pyth fixed-point value to 1e-8 (PRICE_DECIMALS). Errors on overflow / non-positive.
///
/// Finer exponents (`expo < -8`) are truncated toward zero, which is exact for the settlement
/// comparison `price >= strike` because strikes are integers in 1e-8 (`x >= k ⇔ floor(x) >= k`).
/// A positive value that truncates to 0 is rejected like a non-positive one.
pub fn to_e8(value: i64, expo: i32) -> Result<i64> {
    require!(value > 0, MontionsError::BadPriceAccount);
    // shift = expo + 8: > 0 → multiply by 10^shift, < 0 → divide by 10^-shift.
    let shift = (expo as i64) + (PRICE_DECIMALS as i64);
    let v = value as i128;
    let scaled: i128 = if shift >= 0 {
        // i64::MAX < 10^19, so any shift >= 19 overflows for every positive value.
        require!(shift <= 18, MontionsError::MathOverflow);
        let f = 10i128.pow(shift as u32);
        v.checked_mul(f).ok_or_else(|| error!(MontionsError::MathOverflow))?
    } else {
        let d = shift.unsigned_abs();
        if d > 18 {
            0 // value < 10^19 <= 10^d: truncates to zero
        } else {
            v / 10i128.pow(d as u32)
        }
    };
    require!(scaled > 0, MontionsError::BadPriceAccount);
    i64::try_from(scaled).map_err(|_| error!(MontionsError::MathOverflow))
}
