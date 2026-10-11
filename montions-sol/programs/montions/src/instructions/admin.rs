//! Admin instructions. Accounts structs are FROZEN (client interface); handlers: program agent.
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::MontionsError;
use crate::instructions::trade::{token_mint, token_transfer, MarketSigner};
use crate::oracle::load_price_update;
use crate::state::*;

/// Upper bounds for admin-set parameters (sanity rails, not economics).
const MAX_LEVELS: u8 = (crate::maker_model::MAX_LADDER / 2) as u8;
const MAX_TICK_SPAN: u8 = 49;
const MAX_VOL_BPS: u32 = 50_000;
const MAX_SETTLE_WINDOW: i64 = 3_600;
const MAX_SYMBOL_LEN: usize = 10;

fn validate_maker_params(p: &MakerParams) -> Result<()> {
    require!(p.levels >= 1 && p.levels <= MAX_LEVELS, MontionsError::BadArgs);
    require!(p.level_spacing >= 1 && p.level_spacing <= MAX_TICK_SPAN, MontionsError::BadArgs);
    require!(p.min_half_spread >= 1 && p.min_half_spread <= MAX_TICK_SPAN, MontionsError::BadArgs);
    require!(p.level_notional > 0, MontionsError::BadArgs);
    require!(p.min_tte >= 0 && p.min_tte <= MAX_DURATION, MontionsError::BadArgs);
    require!(p.max_price_age >= 1 && p.max_price_age <= 3_600, MontionsError::BadArgs);
    Ok(())
}

fn validate_asset_params(strike_step: u64, vol_bps: u32, max_conf_bps: u16, settle_window: i64) -> Result<()> {
    require!(strike_step > 0, MontionsError::BadStrike);
    require!(vol_bps >= 1 && vol_bps <= MAX_VOL_BPS, MontionsError::BadArgs);
    require!(max_conf_bps >= 1 && max_conf_bps <= 10_000, MontionsError::BadArgs);
    require!(settle_window >= 0 && settle_window <= MAX_SETTLE_WINDOW, MontionsError::BadArgs);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [SEED_CONFIG], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, seeds = [SEED_COLLATERAL], bump,
        mint::decimals = 6, mint::authority = config)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA used only as a signer / seat owner.
    #[account(seeds = [SEED_MAKER], bump)]
    pub maker: UncheckedAccount<'info>,
    #[account(init, payer = admin, seeds = [SEED_TREASURY], bump,
        token::mint = collateral_mint, token::authority = maker)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn initialize(ctx: Context<Initialize>, params: InitParams) -> Result<()> {
    require!(params.fee_bps <= MAX_FEE_BPS, MontionsError::FeeTooHigh);
    require!(params.faucet_cooldown >= 0, MontionsError::BadArgs);
    validate_maker_params(&params.maker_params)?;
    let cfg = &mut ctx.accounts.config;
    cfg.admin = ctx.accounts.admin.key();
    cfg.collateral_mint = ctx.accounts.collateral_mint.key();
    cfg.maker = ctx.accounts.maker.key();
    cfg.treasury = ctx.accounts.treasury.key();
    cfg.fee_bps = params.fee_bps;
    cfg.paused = false;
    cfg.bump = ctx.bumps.config;
    cfg.collateral_bump = ctx.bumps.collateral_mint;
    cfg.maker_bump = ctx.bumps.maker;
    cfg.treasury_bump = ctx.bumps.treasury;
    cfg.faucet_amount = params.faucet_amount;
    cfg.faucet_cooldown = params.faucet_cooldown;
    cfg.market_count = 0;
    cfg.maker_params = params.maker_params;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ MontionsError::BadAccount)]
    pub config: Box<Account<'info, Config>>,
    pub admin: Signer<'info>,
}

pub fn set_params(ctx: Context<AdminOnly>, update: ParamsUpdate) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    if let Some(fee) = update.fee_bps {
        require!(fee <= MAX_FEE_BPS, MontionsError::FeeTooHigh);
        cfg.fee_bps = fee;
    }
    if let Some(paused) = update.paused {
        cfg.paused = paused;
    }
    if let Some(amount) = update.faucet_amount {
        cfg.faucet_amount = amount;
    }
    if let Some(cooldown) = update.faucet_cooldown {
        require!(cooldown >= 0, MontionsError::BadArgs);
        cfg.faucet_cooldown = cooldown;
    }
    if let Some(mp) = update.maker_params {
        validate_maker_params(&mp)?;
        cfg.maker_params = mp;
    }
    if let Some(admin) = update.new_admin {
        require!(admin != Pubkey::default(), MontionsError::BadArgs);
        cfg.admin = admin;
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: AddAssetArgs)]
pub struct AddAsset<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ MontionsError::BadAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, space = 8 + Asset::INIT_SPACE,
        seeds = [SEED_ASSET, args.symbol.as_bytes()], bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: validated in the handler (Pyth PriceUpdateV2 with `args.feed_id`).
    pub price_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn add_asset(ctx: Context<AddAsset>, args: AddAssetArgs) -> Result<()> {
    let sym = args.symbol.as_bytes();
    require!(
        !sym.is_empty()
            && sym.len() <= MAX_SYMBOL_LEN
            && sym.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
        MontionsError::BadArgs
    );
    validate_asset_params(args.strike_step, args.vol_bps, args.max_conf_bps, args.settle_window)?;
    // Must be a fully verified Pyth PriceUpdateV2 for exactly this feed.
    let price = load_price_update(&ctx.accounts.price_account.to_account_info())?;
    require!(price.feed_id == args.feed_id, MontionsError::FeedMismatch);

    let asset = &mut ctx.accounts.asset;
    asset.symbol = args.symbol;
    asset.feed_id = args.feed_id;
    asset.price_account = ctx.accounts.price_account.key();
    asset.strike_step = args.strike_step;
    asset.vol_bps = args.vol_bps;
    asset.max_conf_bps = args.max_conf_bps;
    asset.active = true;
    asset.bump = ctx.bumps.asset;
    asset.settle_window = args.settle_window;
    asset.market_count = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct SetAsset<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ MontionsError::BadAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_ASSET, asset.symbol.as_bytes()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    pub admin: Signer<'info>,
}

pub fn set_asset(ctx: Context<SetAsset>, update: AssetUpdate) -> Result<()> {
    let asset = &mut ctx.accounts.asset;
    let vol_bps = update.vol_bps.unwrap_or(asset.vol_bps);
    let max_conf_bps = update.max_conf_bps.unwrap_or(asset.max_conf_bps);
    let settle_window = update.settle_window.unwrap_or(asset.settle_window);
    let strike_step = update.strike_step.unwrap_or(asset.strike_step);
    validate_asset_params(strike_step, vol_bps, max_conf_bps, settle_window)?;
    asset.vol_bps = vol_bps;
    asset.max_conf_bps = max_conf_bps;
    asset.settle_window = settle_window;
    asset.strike_step = strike_step;
    if let Some(active) = update.active {
        asset.active = active;
    }
    Ok(())
}

/// Devnet test collateral only: admin mints tUSDC (e.g. to fund the maker treasury).
#[derive(Accounts)]
pub struct MintCollateral<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ MontionsError::BadAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, address = config.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = collateral_mint)]
    pub destination: Box<Account<'info, TokenAccount>>,
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn mint_collateral(ctx: Context<MintCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, MontionsError::BadQty);
    let a = &ctx.accounts;
    let bump = [a.config.bump];
    let seeds: [&[u8]; 2] = [SEED_CONFIG, &bump];
    token_mint(
        &a.token_program,
        a.collateral_mint.to_account_info(),
        a.destination.to_account_info(),
        a.config.to_account_info(),
        &seeds,
        amount,
    )
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ MontionsError::BadAccount)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, constraint = market.load()?.vault == vault.key() @ MontionsError::BadAccount)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.collateral_mint)]
    pub destination: Box<Account<'info, TokenAccount>>,
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
    let a = &ctx.accounts;
    let (fees, signer) = {
        let mut m = a.market.load_mut()?;
        let fees = m.fees;
        m.fees = 0;
        (fees, MarketSigner::new(&m))
    };
    let seeds = signer.seeds();
    token_transfer(
        &a.token_program,
        a.vault.to_account_info(),
        a.destination.to_account_info(),
        a.market.to_account_info(),
        Some(&seeds),
        fees,
    )
}
