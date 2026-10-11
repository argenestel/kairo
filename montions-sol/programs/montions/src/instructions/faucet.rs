//! Devnet collateral faucet. Accounts FROZEN; handler: program agent.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::MontionsError;
use crate::instructions::trade::{clock_now, token_mint};
use crate::state::*;

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, address = config.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(init_if_needed, payer = user, space = 8 + FaucetClaim::INIT_SPACE,
        seeds = [SEED_FAUCET, user.key().as_ref()], bump)]
    pub claim: Box<Account<'info, FaucetClaim>>,
    #[account(init_if_needed, payer = user,
        associated_token::mint = collateral_mint, associated_token::authority = user)]
    pub user_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn faucet(ctx: Context<Faucet>) -> Result<()> {
    let now = clock_now()?;
    let a = &ctx.accounts;
    let amount = a.config.faucet_amount;
    require!(amount > 0, MontionsError::BadArgs); // faucet disabled
    // A fresh claim account has last_claim = 0, so the first claim always passes.
    let elapsed = now.checked_sub(a.claim.last_claim).ok_or_else(|| error!(MontionsError::MathOverflow))?;
    require!(elapsed >= a.config.faucet_cooldown, MontionsError::FaucetCooldown);
    let bump = [a.config.bump];
    let seeds: [&[u8]; 2] = [SEED_CONFIG, &bump];
    token_mint(
        &a.token_program,
        a.collateral_mint.to_account_info(),
        a.user_collateral.to_account_info(),
        a.config.to_account_info(),
        &seeds,
        amount,
    )?;
    let claim = &mut ctx.accounts.claim;
    claim.last_claim = now;
    claim.bump = ctx.bumps.claim;
    Ok(())
}
