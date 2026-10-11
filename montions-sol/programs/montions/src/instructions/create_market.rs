//! Permissionless market creation. Accounts FROZEN; handler: program agent.
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::MontionsError;
use crate::events::MarketCreated;
use crate::instructions::trade::clock_now;
use crate::state::*;

#[derive(Accounts)]
#[instruction(strike: u64, expiry: i64)]
pub struct CreateMarket<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_ASSET, asset.symbol.as_bytes()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(init, payer = payer, space = 8 + MARKET_SIZE,
        seeds = [SEED_MARKET, asset.key().as_ref(), &strike.to_le_bytes(), &expiry.to_le_bytes()], bump)]
    pub market: AccountLoader<'info, Market>,
    #[account(init, payer = payer, seeds = [SEED_YES, market.key().as_ref()], bump,
        mint::decimals = 0, mint::authority = market)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = payer, seeds = [SEED_NO, market.key().as_ref()], bump,
        mint::decimals = 0, mint::authority = market)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = payer, seeds = [SEED_VAULT, market.key().as_ref()], bump,
        token::mint = collateral_mint, token::authority = market)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn create_market(ctx: Context<CreateMarket>, strike: u64, expiry: i64) -> Result<()> {
    let now = clock_now()?;
    require!(!ctx.accounts.config.paused, MontionsError::Paused);
    let asset = &ctx.accounts.asset;
    require!(asset.active, MontionsError::AssetInactive);
    require!(
        strike > 0 && asset.strike_step > 0 && strike % asset.strike_step == 0,
        MontionsError::BadStrike
    );
    let earliest = now.checked_add(MIN_DURATION).ok_or_else(|| error!(MontionsError::MathOverflow))?;
    let latest = now.checked_add(MAX_DURATION).ok_or_else(|| error!(MontionsError::MathOverflow))?;
    require!(
        expiry.rem_euclid(EXPIRY_GRID) == 0 && expiry >= earliest && expiry <= latest,
        MontionsError::BadExpiry
    );

    let market_key = ctx.accounts.market.key();
    {
        let mut m = ctx.accounts.market.load_init()?;
        m.asset = asset.key();
        m.feed_id = asset.feed_id;
        m.creator = ctx.accounts.payer.key();
        m.yes_mint = ctx.accounts.yes_mint.key();
        m.no_mint = ctx.accounts.no_mint.key();
        m.vault = ctx.accounts.vault.key();
        m.strike = strike;
        m.expiry = expiry;
        m.created_at = now;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;
        m.yes_mint_bump = ctx.bumps.yes_mint;
        m.no_mint_bump = ctx.bumps.no_mint;
        m.init_book();
    }

    let cfg = &mut ctx.accounts.config;
    cfg.market_count = cfg.market_count.checked_add(1).ok_or_else(|| error!(MontionsError::MathOverflow))?;
    let asset = &mut ctx.accounts.asset;
    asset.market_count = asset.market_count.checked_add(1).ok_or_else(|| error!(MontionsError::MathOverflow))?;

    emit!(MarketCreated {
        market: market_key,
        asset: asset.key(),
        strike,
        expiry,
        creator: ctx.accounts.payer.key(),
    });
    Ok(())
}
