//! Error codes. Owners may APPEND variants at the end of the enum (never reorder or remove).
use anchor_lang::prelude::*;

#[error_code]
pub enum MontionsError {
    #[msg("tick must be in 1..=99")]
    BadTick,
    #[msg("quantity out of range")]
    BadQty,
    #[msg("bad side / time-in-force / argument")]
    BadArgs,
    #[msg("market is not open")]
    MarketNotOpen,
    #[msg("trading has ended for this market")]
    Expired,
    #[msg("market has not expired yet")]
    NotExpired,
    #[msg("market already settled")]
    AlreadySettled,
    #[msg("market is not settled")]
    NotSettled,
    #[msg("expiry outside the allowed window or off the 5-minute grid")]
    BadExpiry,
    #[msg("strike must be positive and on the asset's strike grid")]
    BadStrike,
    #[msg("order not found or not open")]
    OrderNotOpen,
    #[msg("caller does not own this order")]
    NotOrderOwner,
    #[msg("insufficient collateral")]
    InsufficientCash,
    #[msg("insufficient outcome tokens")]
    InsufficientTokens,
    #[msg("POST_ONLY order would cross the book")]
    WouldCross,
    #[msg("order book is full for this market")]
    BookFull,
    #[msg("seat table is full for this market")]
    SeatsFull,
    #[msg("filled quantity below min_filled")]
    MinFillNotMet,
    #[msg("protocol is paused for new risk")]
    Paused,
    #[msg("fee too high")]
    FeeTooHigh,
    #[msg("asset is not active")]
    AssetInactive,
    #[msg("price account is not a valid Pyth PriceUpdateV2")]
    BadPriceAccount,
    #[msg("price account feed id does not match the asset")]
    FeedMismatch,
    #[msg("price update is not fully verified")]
    PriceNotVerified,
    #[msg("price is not usable for settlement yet")]
    PriceNotReady,
    #[msg("price is stale")]
    PriceStale,
    #[msg("price confidence interval too wide")]
    PriceTooUncertain,
    #[msg("void grace period has not elapsed")]
    VoidTooEarly,
    #[msg("faucet cooldown active")]
    FaucetCooldown,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("maker is disabled")]
    MakerDisabled,
    #[msg("account constraint violated")]
    BadAccount,
    #[msg("internal invariant violated")]
    InvariantViolated,
}
