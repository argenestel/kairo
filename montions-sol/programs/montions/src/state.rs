//! Account layouts and instruction argument types. FROZEN — the TypeScript SDK decodes these
//! byte-for-byte (see docs/SPEC.md §3 for offsets). Change only via the main agent.
use anchor_lang::prelude::*;

use crate::constants::*;

// ───────────────────────────── global config ─────────────────────────────

/// Parameters of the protocol market maker (an onchain, model-priced quoter; see `maker_model`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct MakerParams {
    /// Master switch for `refresh_quotes`.
    pub enabled: bool,
    /// Price levels posted per side (1..=4).
    pub levels: u8,
    /// Ticks between consecutive levels (>= 1).
    pub level_spacing: u8,
    /// Minimum distance in ticks from fair value to the best maker quote on each side (>= 1).
    pub min_half_spread: u8,
    /// Worst-case loss budget per market in collateral base units: the maker never escrows more
    /// than this in one market (resting orders + inventory at risk).
    pub max_market_exposure: u64,
    /// Target collateral per level in base units (actual size is clamped by `max_market_exposure`).
    pub level_notional: u64,
    /// Stop quoting when time to expiry is below this many seconds.
    pub min_tte: i64,
    /// Reject Pyth prices older than this many seconds when quoting.
    pub max_price_age: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Collateral mint (devnet: program-owned "tUSDC" PDA mint, 6 decimals, faucet-enabled).
    pub collateral_mint: Pubkey,
    /// Maker PDA (`["maker"]`): owner of the maker's seat in every market.
    pub maker: Pubkey,
    /// Maker treasury token account (`["treasury"]`, authority = maker PDA).
    pub treasury: Pubkey,
    /// Taker fee in bps of taker collateral consumed (<= MAX_FEE_BPS). Makers pay nothing.
    pub fee_bps: u16,
    /// Pauses NEW risk only (place_order that adds exposure, split, create_market, refresh_quotes).
    /// Cancels, merges, withdrawals, resolution and redemption always work.
    pub paused: bool,
    pub bump: u8,
    pub collateral_bump: u8,
    pub maker_bump: u8,
    pub treasury_bump: u8,
    /// Faucet mint per claim (base units) and cooldown between claims per wallet (seconds).
    pub faucet_amount: u64,
    pub faucet_cooldown: i64,
    pub market_count: u64,
    pub maker_params: MakerParams,
}

#[account]
#[derive(InitSpace)]
pub struct Asset {
    /// Ticker, e.g. "SOL". PDA seed: `["asset", symbol.as_bytes()]`.
    #[max_len(10)]
    pub symbol: String,
    /// Pyth price feed id.
    pub feed_id: [u8; 32],
    /// Canonical Pyth sponsored price account (PriceUpdateV2, shard 0) for quoting and settlement.
    pub price_account: Pubkey,
    /// Strike grid in 1e-8 USD; every market strike must be a positive multiple of it.
    pub strike_step: u64,
    /// Annualised volatility for the maker model, bps (8000 = 80%).
    pub vol_bps: u32,
    /// Max Pyth confidence / price, bps, accepted for quoting and settlement.
    pub max_conf_bps: u16,
    pub active: bool,
    pub bump: u8,
    /// A print is accepted for settlement iff `expiry <= publish_time <= expiry + settle_window`
    /// (or it is provably the first Pythnet print at/after expiry: `prev_publish_time < expiry`).
    pub settle_window: i64,
    pub market_count: u32,
}

#[account]
#[derive(InitSpace)]
pub struct FaucetClaim {
    pub last_claim: i64,
    pub bump: u8,
}

// ───────────────────────────── market (zero-copy) ─────────────────────────────

/// One price level (FIFO list of resting orders). Indices point into `Market::orders`.
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Level {
    pub head: u8,
    pub tail: u8,
}

/// A resting order. A slot is free iff `id == 0`.
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Order {
    /// Sequential per market, starting at 1. 0 = empty slot.
    pub id: u64,
    /// Remaining contracts.
    pub qty: u64,
    /// Placement time (unix seconds).
    pub ts: i64,
    /// Index of the maker's seat in `Market::seats`.
    pub seat: u8,
    /// SIDE_BID or SIDE_ASK.
    pub side: u8,
    /// Limit tick 1..=99.
    pub tick: u8,
    /// 1 if the order is backed by held tokens instead of cash:
    /// Ask → escrowed YES (selling YES); Bid → escrowed NO (closing NO, spec A3).
    pub from_held: u8,
    /// Previous / next order in the same level FIFO (NIL = none). When the slot is free, `next`
    /// links the free list.
    pub prev: u8,
    pub next: u8,
    pub _pad: [u8; 2],
}

/// A maker's balances inside one market. A seat is free iff `owner == Pubkey::default()`.
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Seat {
    pub owner: Pubkey,
    /// Free collateral (withdrawable).
    pub cash: u64,
    /// Collateral escrowed in resting orders.
    pub locked: u64,
    /// Free YES / NO contracts (withdrawable as SPL tokens).
    pub yes: u64,
    pub no: u64,
    /// YES escrowed in from_held Asks; NO escrowed in from_held Bids.
    pub yes_locked: u64,
    pub no_locked: u64,
    pub open_orders: u32,
    pub _pad: [u8; 4],
}

/// One fill, newest at `trade_head - 1` (mod TRADE_RING).
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Trade {
    pub ts: i64,
    pub qty: u32,
    pub tick: u8,
    /// 1 if the taker bought YES (lifted an Ask).
    pub taker_is_buyer: u8,
    pub _pad: [u8; 2],
}

/// A binary market: "is `asset` >= `strike` at `expiry`?". One YES + one NO = 1 UNIT, always
/// fully collateralised. PDA: `["market", asset, strike.to_le_bytes(), expiry.to_le_bytes()]`.
///
/// Accounting (all in collateral base units unless noted):
/// - `vault.amount == Σ seat.cash + Σ seat.locked + pool + fees` after every instruction.
/// - `yes_total` / `no_total` count every outstanding claim: SPL supply of the YES/NO mint plus
///   seat-internal `yes + yes_locked` / `no + no_locked`.
/// - Open: `pool == yes_total * UNIT == no_total * UNIT`.
#[account(zero_copy)]
#[derive(Debug)]
pub struct Market {
    pub asset: Pubkey,
    pub feed_id: [u8; 32],
    pub creator: Pubkey,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey,
    /// Strike in 1e-8 USD.
    pub strike: u64,
    /// Expiry (unix seconds). Trading allowed while `now < expiry`.
    pub expiry: i64,
    pub created_at: i64,
    /// Settlement price (1e-8 USD) and its Pyth publish time; 0 until resolved.
    pub settle_price: i64,
    pub settle_publish_time: i64,
    /// Collateral backing outstanding YES/NO pairs.
    pub pool: u64,
    pub yes_total: u64,
    pub no_total: u64,
    /// Accrued taker fees (claimable by admin).
    pub fees: u64,
    /// Contracts traded (sum of fill quantities).
    pub volume: u64,
    /// Next order id to assign (starts at 1).
    pub next_order_id: u64,
    /// Occupancy bitmaps: bit t (t in 1..=99) of the 128-bit value `[lo, hi]` is set iff the level
    /// at tick t is non-empty. `bits[0]` holds ticks 0..=63, `bits[1]` holds ticks 64..=127.
    pub bid_bits: [u64; 2],
    pub ask_bits: [u64; 2],
    /// STATUS_OPEN / STATUS_RESOLVED / STATUS_VOID.
    pub status: u8,
    /// 1 = YES won, 0 = NO won (meaningful only when Resolved).
    pub outcome: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub yes_mint_bump: u8,
    pub no_mint_bump: u8,
    /// Tick of the most recent fill (0 if none).
    pub last_trade_tick: u8,
    /// Next write position in `trades`.
    pub trade_head: u8,
    /// Total fills ever recorded.
    pub trade_count: u32,
    /// Head of the free list of order slots (NIL if full). Must be initialised by `engine::init`.
    pub free_head: u8,
    pub _pad0: [u8; 3],
    pub _reserved: [u64; 4],
    pub bid_levels: [Level; LEVELS],
    pub ask_levels: [Level; LEVELS],
    pub orders: [Order; MAX_ORDERS],
    pub seats: [Seat; MAX_SEATS],
    pub trades: [Trade; TRADE_RING],
}

/// Byte size of `Market` (without the 8-byte Anchor discriminator).
pub const MARKET_SIZE: usize = 5176;
const _: () = assert!(core::mem::size_of::<Market>() == MARKET_SIZE);
const _: () = assert!(core::mem::size_of::<Order>() == 32);
const _: () = assert!(core::mem::size_of::<Seat>() == 88);
const _: () = assert!(core::mem::size_of::<Trade>() == 16);

// ───────────────────────────── instruction args / returns ─────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlaceArgs {
    /// SIDE_BID (buy YES) or SIDE_ASK (sell YES).
    pub side: u8,
    /// Limit tick 1..=99.
    pub tick: u8,
    /// Contracts, 1..=MAX_ORDER_QTY.
    pub qty: u64,
    /// TIF_GTC / TIF_IOC / TIF_POST_ONLY.
    pub tif: u8,
    /// Ask: sell YES the caller holds. Bid: close NO the caller holds (spec A3).
    pub from_held: bool,
    /// Max resting orders matched or STP-cancelled (0 → DEFAULT_MAX_FILLS).
    pub max_fills: u8,
    /// Revert unless at least this many contracts fill immediately (slippage / FOK-style guard).
    pub min_filled: u64,
}

/// Returned by `place_order` (Anchor return data) and by the engine.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PlaceResult {
    /// Id of the resting remainder (0 if nothing rests).
    pub order_id: u64,
    pub filled: u64,
    pub resting: u64,
    /// Taker fee charged (base units).
    pub fee: u64,
    /// Amounts the instruction must push back to the taker's wallet after matching.
    pub cash_out: u64,
    pub yes_out: u64,
    pub no_out: u64,
}

/// What the instruction must pull from the taker's wallet before matching.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Escrow {
    pub cash: u64,
    pub yes: u64,
    pub no: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct InitParams {
    pub fee_bps: u16,
    pub faucet_amount: u64,
    pub faucet_cooldown: i64,
    pub maker_params: MakerParams,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ParamsUpdate {
    pub fee_bps: Option<u16>,
    pub paused: Option<bool>,
    pub faucet_amount: Option<u64>,
    pub faucet_cooldown: Option<i64>,
    pub maker_params: Option<MakerParams>,
    pub new_admin: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AddAssetArgs {
    pub symbol: String,
    pub feed_id: [u8; 32],
    pub strike_step: u64,
    pub vol_bps: u32,
    pub max_conf_bps: u16,
    pub settle_window: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AssetUpdate {
    pub vol_bps: Option<u32>,
    pub max_conf_bps: Option<u16>,
    pub active: Option<bool>,
    pub settle_window: Option<i64>,
    pub strike_step: Option<u64>,
}
