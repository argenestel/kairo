//! Events (Anchor `emit!`). Informational only: the UI reads accounts, never logs.
use anchor_lang::prelude::*;

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub asset: Pubkey,
    pub strike: u64,
    pub expiry: i64,
    pub creator: Pubkey,
}

#[event]
pub struct OrderPlaced {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub order_id: u64,
    pub side: u8,
    pub tick: u8,
    pub qty: u64,
    pub filled: u64,
    pub resting: u64,
    pub from_held: bool,
}

#[event]
pub struct OrderCancelled {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub order_id: u64,
    pub qty: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub yes: bool,
    pub price: i64,
    pub publish_time: i64,
}

#[event]
pub struct MarketVoided {
    pub market: Pubkey,
}

#[event]
pub struct Redeemed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub yes_qty: u64,
    pub no_qty: u64,
    pub payout: u64,
}

#[event]
pub struct QuotesRefreshed {
    pub market: Pubkey,
    pub fair_tick: u8,
    pub quotes: u8,
    pub spot: i64,
}
