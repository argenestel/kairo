//! Protocol maker: permissionless, model-priced quotes. Accounts FROZEN; handlers: program agent.
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::MontionsError;
use crate::events::QuotesRefreshed;
use crate::instructions::trade::{clock_now, token_transfer, MarketSigner};
use crate::maker_model::{build_ladder, LadderInput};
use crate::oracle::{load_price_update, to_e8};
use crate::pricing::digital_prob_above_wad;
use crate::state::*;

#[derive(Accounts)]
pub struct RefreshQuotes<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,
        constraint = market.load()?.asset == asset.key() @ MontionsError::BadAccount,
        constraint = market.load()?.vault == vault.key() @ MontionsError::BadAccount)]
    pub market: AccountLoader<'info, Market>,
    #[account(seeds = [SEED_ASSET, asset.symbol.as_bytes()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: Pyth PriceUpdateV2 for the asset's feed; validated in the handler.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: maker PDA signer.
    #[account(seeds = [SEED_MAKER], bump = config.maker_bump)]
    pub maker: UncheckedAccount<'info>,
    #[account(mut, address = config.treasury)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Cancel the maker's quotes in this market and post a fresh ladder around Pyth-priced fair value.
pub fn refresh_quotes(ctx: Context<RefreshQuotes>) -> Result<()> {
    let a = &ctx.accounts;
    let params = a.config.maker_params;
    require!(params.enabled, MontionsError::MakerDisabled);
    require!(!a.config.paused, MontionsError::Paused);
    let now = clock_now()?;
    let maker = a.maker.key();
    let market_key = a.market.key();

    let (strike, expiry, feed_id) = {
        let m = a.market.load()?;
        require!(m.status == STATUS_OPEN, MontionsError::MarketNotOpen);
        (m.strike, m.expiry, m.feed_id)
    };
    let tte = expiry.saturating_sub(now);
    if tte <= 0 || tte < params.min_tte {
        // Too close to expiry: only pull the maker's quotes (funds stay in the seat until maker_sweep).
        let mut m = a.market.load_mut()?;
        if let Some(seat) = m.find_seat(&maker) {
            m.cancel_all(seat)?;
        }
        return Ok(());
    }

    // Quote only off the asset's canonical (sponsored) feed account: a caller-chosen posted update
    // could replay an older verified print inside `max_price_age`.
    require_keys_eq!(a.price_update.key(), a.asset.price_account, MontionsError::BadPriceAccount);
    let p = load_price_update(&a.price_update.to_account_info())?;
    require!(p.feed_id == feed_id, MontionsError::FeedMismatch);
    require!(now.saturating_sub(p.publish_time) <= params.max_price_age, MontionsError::PriceStale);
    require!(p.conf_ok(a.asset.max_conf_bps), MontionsError::PriceTooUncertain);
    let spot = to_e8(p.price, p.expo)?;
    let fair = digital_prob_above_wad(spot as u64, strike, a.asset.vol_bps, tte);

    // Phase 1: cancel the old ladder and snapshot the seat.
    let (seat, seat_cash, seat_locked, seat_yes, seat_no) = {
        let mut m = a.market.load_mut()?;
        let seat = m.seat_or_alloc(&maker)?;
        m.cancel_all(seat)?;
        let s = &m.seats[seat];
        (seat, s.cash, s.locked, s.yes, s.no)
    };
    let exposure = seat_cash.saturating_add(seat_locked);
    let topup_available = a.treasury.amount.min(params.max_market_exposure.saturating_sub(exposure));
    let ladder = build_ladder(&LadderInput {
        fair_wad: fair,
        tte_secs: tte,
        vol_bps: a.asset.vol_bps,
        seat_cash,
        seat_yes,
        seat_no,
        topup_available,
        params,
    });

    // Top up the seat from the treasury (maker PDA signs).
    let topup = ladder.cash_needed.saturating_sub(seat_cash).min(topup_available);
    let maker_bump = [a.config.maker_bump];
    let maker_seeds: [&[u8]; 2] = [SEED_MAKER, &maker_bump];
    token_transfer(
        &a.token_program,
        a.treasury.to_account_info(),
        a.vault.to_account_info(),
        a.maker.to_account_info(),
        Some(&maker_seeds),
        topup,
    )?;

    // Phase 2: credit and post. A quote that would cross / overdraw / not fit is skipped (the
    // engine leaves the market unchanged on error).
    let mut posted: u8 = 0;
    {
        let mut m = a.market.load_mut()?;
        if topup > 0 {
            m.credit_seat_cash(seat, topup)?;
        }
        for q in ladder.quotes.iter().take(ladder.len) {
            if q.qty == 0 {
                continue;
            }
            let args = PlaceArgs {
                side: q.side,
                tick: q.tick,
                qty: q.qty,
                tif: TIF_POST_ONLY,
                from_held: q.from_held,
                max_fills: 0,
                min_filled: 0,
            };
            // POST_ONLY never takes and makers pay no fee, so the seat is never asked for a
            // taker-fee reserve beyond the ladder's `cash_needed`.
            if m.place_from_seat(seat, &args, 0, now).is_ok() {
                posted = posted.saturating_add(1);
            }
        }
    }

    emit!(QuotesRefreshed { market: market_key, fair_tick: ladder.fair_tick, quotes: posted, spot });
    Ok(())
}

#[derive(Accounts)]
pub struct MakerSweep<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, constraint = market.load()?.vault == vault.key() @ MontionsError::BadAccount)]
    pub market: AccountLoader<'info, Market>,
    /// CHECK: maker PDA signer.
    #[account(seeds = [SEED_MAKER], bump = config.maker_bump)]
    pub maker: UncheckedAccount<'info>,
    #[account(mut, address = config.treasury)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Move the maker seat's free cash back to the treasury (after settlement: redeem its inventory
/// first; while open: cancel its quotes when the market is within `min_tte` of expiry).
pub fn maker_sweep(ctx: Context<MakerSweep>) -> Result<()> {
    let a = &ctx.accounts;
    let now = clock_now()?;
    let params = a.config.maker_params;
    let maker = a.maker.key();

    let (cash, signer) = {
        let mut m = a.market.load_mut()?;
        let Some(seat) = m.find_seat(&maker) else {
            return Ok(());
        };
        if m.status == STATUS_RESOLVED || m.status == STATUS_VOID {
            m.cancel_all(seat)?;
            m.redeem_seat(seat)?;
        } else if m.status == STATUS_OPEN
            && (m.expiry.saturating_sub(now) < params.min_tte || a.config.paused || !params.enabled)
        {
            // Risk-reducing: pull quotes near expiry, and whenever new maker risk is switched off.
            m.cancel_all(seat)?;
        }
        let s = m.seats[seat];
        let cash = if s.yes == 0 && s.no == 0 {
            // Nothing but cash is free: take it all (frees the seat if nothing is locked).
            m.take_seat_free(seat).0
        } else {
            // Keep the maker's open-market inventory in the seat; only move its free cash.
            m.seats[seat].cash = 0;
            s.cash
        };
        (cash, MarketSigner::new(&m))
    };

    let seeds = signer.seeds();
    token_transfer(
        &a.token_program,
        a.vault.to_account_info(),
        a.treasury.to_account_info(),
        a.market.to_account_info(),
        Some(&seeds),
        cash,
    )
}
