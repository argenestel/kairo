//! Montions on Solana — outcome-first binary options with a fully onchain central limit order book.
//! See docs/SPEC.md.
use anchor_lang::prelude::*;

pub mod constants;
pub mod engine;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod maker_model;
pub mod oracle;
pub mod pricing;
pub mod state;

use instructions::*;
use state::*;

declare_id!("MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh");

#[program]
pub mod montions {
    use super::*;

    // ── admin ──
    pub fn initialize(ctx: Context<Initialize>, params: InitParams) -> Result<()> {
        instructions::admin::initialize(ctx, params)
    }
    pub fn set_params(ctx: Context<AdminOnly>, update: ParamsUpdate) -> Result<()> {
        instructions::admin::set_params(ctx, update)
    }
    pub fn add_asset(ctx: Context<AddAsset>, args: AddAssetArgs) -> Result<()> {
        instructions::admin::add_asset(ctx, args)
    }
    pub fn set_asset(ctx: Context<SetAsset>, update: AssetUpdate) -> Result<()> {
        instructions::admin::set_asset(ctx, update)
    }
    pub fn mint_collateral(ctx: Context<MintCollateral>, amount: u64) -> Result<()> {
        instructions::admin::mint_collateral(ctx, amount)
    }
    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        instructions::admin::withdraw_fees(ctx)
    }

    // ── users ──
    pub fn faucet(ctx: Context<Faucet>) -> Result<()> {
        instructions::faucet::faucet(ctx)
    }
    pub fn create_market(ctx: Context<CreateMarket>, strike: u64, expiry: i64) -> Result<()> {
        instructions::create_market::create_market(ctx, strike, expiry)
    }
    pub fn place_order(ctx: Context<UserMarket>, args: PlaceArgs) -> Result<PlaceResult> {
        instructions::trade::place_order(ctx, args)
    }
    pub fn cancel_order(ctx: Context<UserMarket>, order_id: u64) -> Result<()> {
        instructions::trade::cancel_order(ctx, order_id)
    }
    pub fn withdraw_seat(ctx: Context<UserMarket>) -> Result<()> {
        instructions::trade::withdraw_seat(ctx)
    }
    pub fn split(ctx: Context<UserMarket>, qty: u64) -> Result<()> {
        instructions::trade::split(ctx, qty)
    }
    pub fn merge(ctx: Context<UserMarket>, qty: u64) -> Result<()> {
        instructions::trade::merge(ctx, qty)
    }
    pub fn redeem(ctx: Context<UserMarket>, yes_qty: u64, no_qty: u64) -> Result<u64> {
        instructions::trade::redeem(ctx, yes_qty, no_qty)
    }

    // ── settlement ──
    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        instructions::resolve::resolve(ctx)
    }
    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        instructions::resolve::void_market(ctx)
    }

    // ── protocol maker ──
    pub fn refresh_quotes(ctx: Context<RefreshQuotes>) -> Result<()> {
        instructions::maker::refresh_quotes(ctx)
    }
    pub fn maker_sweep(ctx: Context<MakerSweep>) -> Result<()> {
        instructions::maker::maker_sweep(ctx)
    }
}
