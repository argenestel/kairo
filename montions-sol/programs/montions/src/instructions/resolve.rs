//! Settlement. Accounts FROZEN; handlers: program agent.
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MontionsError;
use crate::events::{MarketResolved, MarketVoided};
use crate::instructions::trade::clock_now;
use crate::oracle::{load_price_update, to_e8};
use crate::state::*;

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(mut, constraint = market.load()?.asset == asset.key() @ MontionsError::BadAccount)]
    pub market: AccountLoader<'info, Market>,
    #[account(seeds = [SEED_ASSET, asset.symbol.as_bytes()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: any PriceUpdateV2 owned by the Pyth receiver with the market's feed id
    /// (the sponsored feed account, or a posted update). Validated in the handler.
    pub price_update: UncheckedAccount<'info>,
}

/// Permissionless, after expiry. YES iff the accepted Pyth print >= strike (spec §7).
pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
    let now = clock_now()?;
    let asset = &ctx.accounts.asset;
    let mut m = ctx.accounts.market.load_mut()?;
    require!(m.status == STATUS_OPEN, MontionsError::AlreadySettled);
    require!(now > m.expiry, MontionsError::NotExpired);

    let p = load_price_update(&ctx.accounts.price_update.to_account_info())?;
    require!(p.feed_id == m.feed_id, MontionsError::FeedMismatch);
    // The print must be at/after expiry …
    require!(p.publish_time >= m.expiry, MontionsError::PriceNotReady);
    // … and inside the settlement window, unless it is provably the first Pythnet print at/after
    // expiry (its predecessor was published before expiry).
    let window_end = m
        .expiry
        .checked_add(asset.settle_window)
        .ok_or_else(|| error!(MontionsError::MathOverflow))?;
    require!(
        p.publish_time <= window_end || p.prev_publish_time < m.expiry,
        MontionsError::PriceStale
    );
    require!(p.conf_ok(asset.max_conf_bps), MontionsError::PriceTooUncertain);
    let price_e8 = to_e8(p.price, p.expo)?;
    // to_e8 guarantees price_e8 > 0, so the cast is lossless.
    let yes = price_e8 as u64 >= m.strike;
    m.settle(yes, price_e8, p.publish_time)?;

    emit!(MarketResolved {
        market: ctx.accounts.market.key(),
        yes,
        price: price_e8,
        publish_time: p.publish_time,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct VoidMarket<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
}

/// Permissionless, after `expiry + VOID_GRACE` if still Open: 50/50 void.
pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
    let now = clock_now()?;
    let mut m = ctx.accounts.market.load_mut()?;
    require!(m.status == STATUS_OPEN, MontionsError::AlreadySettled);
    let void_at = m.expiry.checked_add(VOID_GRACE).ok_or_else(|| error!(MontionsError::MathOverflow))?;
    require!(now >= void_at, MontionsError::VoidTooEarly);
    m.void()?;
    emit!(MarketVoided { market: ctx.accounts.market.key() });
    Ok(())
}
