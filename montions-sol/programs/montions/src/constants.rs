//! Protocol constants. FROZEN — change only via the main agent (see docs/SPEC.md).
use anchor_lang::prelude::*;

/// Payout of one winning contract, in collateral base units (USDC has 6 decimals → $1).
pub const UNIT: u64 = 1_000_000;
/// Value of one price tick (1¢) in collateral base units.
pub const TICK_UNIT: u64 = 10_000;
/// Valid limit prices are ticks 1..=99 (cents of $1).
pub const MIN_TICK: u8 = 1;
pub const MAX_TICK: u8 = 99;
/// Number of level slots per side (index == tick; index 0 unused).
pub const LEVELS: usize = 100;

/// Capacity of the per-market order arena.
pub const MAX_ORDERS: usize = 64;
/// Capacity of the per-market seat table (makers with resting orders or unsettled fills).
pub const MAX_SEATS: usize = 24;
/// Recent-trade ring buffer length.
pub const TRADE_RING: usize = 16;
/// Null index for the u8 linked lists inside the order arena.
pub const NIL: u8 = u8::MAX;

/// Market lifecycle bounds (seconds).
pub const MIN_DURATION: i64 = 120;
pub const MAX_DURATION: i64 = 90 * 86_400;
/// Expiries must be multiples of this many seconds (unix time).
pub const EXPIRY_GRID: i64 = 300;
/// After `expiry + VOID_GRACE` an unresolved market can be voided 50/50 by anyone.
pub const VOID_GRACE: i64 = 86_400;

/// Max contracts in one order (keeps trade-ring quantities inside u32).
pub const MAX_ORDER_QTY: u64 = 1_000_000_000;
/// `max_fills == 0` means this many.
pub const DEFAULT_MAX_FILLS: u8 = 32;
/// Hard cap on the taker fee.
pub const MAX_FEE_BPS: u16 = 100;

/// Strikes and settlement prices are fixed-point USD with this many decimals (1e-8).
pub const PRICE_DECIMALS: i32 = 8;

/// Pyth Solana Receiver program (owner of PriceUpdateV2 accounts, incl. the sponsored push feeds).
pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Market status values.
pub const STATUS_OPEN: u8 = 1;
pub const STATUS_RESOLVED: u8 = 2;
pub const STATUS_VOID: u8 = 3;

/// Order sides. A Bid buys YES; an Ask sells YES (writes it, or sells held YES).
pub const SIDE_BID: u8 = 0;
pub const SIDE_ASK: u8 = 1;

/// Time in force.
pub const TIF_GTC: u8 = 0;
pub const TIF_IOC: u8 = 1;
pub const TIF_POST_ONLY: u8 = 2;

/// PDA seeds.
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_COLLATERAL: &[u8] = b"collateral";
pub const SEED_MAKER: &[u8] = b"maker";
pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_ASSET: &[u8] = b"asset";
pub const SEED_MARKET: &[u8] = b"market";
pub const SEED_YES: &[u8] = b"yes";
pub const SEED_NO: &[u8] = b"no";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_FAUCET: &[u8] = b"faucet";
