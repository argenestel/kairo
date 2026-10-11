//! User trading instructions (all share the `UserMarket` accounts). Accounts FROZEN; handlers:
//! program agent. Every handler leaves `vault.amount == Σ seat.cash + Σ seat.locked + pool + fees`.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::MontionsError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct UserMarket<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,
        constraint = market.load()?.vault == vault.key() @ MontionsError::BadAccount,
        constraint = market.load()?.yes_mint == yes_mint.key() @ MontionsError::BadAccount,
        constraint = market.load()?.no_mint == no_mint.key() @ MontionsError::BadAccount)]
    pub market: AccountLoader<'info, Market>,
    pub user: Signer<'info>,
    #[account(mut, token::mint = config.collateral_mint, token::authority = user)]
    pub user_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub no_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

// ───────────────────────────── shared CPI helpers (used by every handler module) ─────────────────────────────

/// Owned copy of a market's PDA seeds: `["market", asset, strike_le, expiry_le, [bump]]`.
pub(crate) struct MarketSigner {
    asset: [u8; 32],
    strike: [u8; 8],
    expiry: [u8; 8],
    bump: [u8; 1],
}

impl MarketSigner {
    pub(crate) fn new(m: &Market) -> Self {
        Self {
            asset: m.asset.to_bytes(),
            strike: m.strike.to_le_bytes(),
            expiry: m.expiry.to_le_bytes(),
            bump: [m.bump],
        }
    }

    pub(crate) fn seeds(&self) -> [&[u8]; 5] {
        [SEED_MARKET, &self.asset, &self.strike, &self.expiry, &self.bump]
    }
}

/// SPL transfer; `seeds` = PDA signer seeds of `authority` (None → `authority` signed the tx).
pub(crate) fn token_transfer<'info>(
    token_program: &Program<'info, Token>,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    seeds: Option<&[&[u8]]>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let accounts = Transfer { from, to, authority };
    match seeds {
        Some(s) => {
            let signer: &[&[&[u8]]] = &[s];
            token::transfer(CpiContext::new_with_signer(token_program.to_account_info(), accounts, signer), amount)
        }
        None => token::transfer(CpiContext::new(token_program.to_account_info(), accounts), amount),
    }
}

/// SPL mint_to signed by a PDA mint authority.
pub(crate) fn token_mint<'info>(
    token_program: &Program<'info, Token>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let signer: &[&[&[u8]]] = &[seeds];
    token::mint_to(
        CpiContext::new_with_signer(token_program.to_account_info(), MintTo { mint, to, authority }, signer),
        amount,
    )
}

/// SPL burn from an account whose owner signed the transaction.
pub(crate) fn token_burn<'info>(
    token_program: &Program<'info, Token>,
    mint: AccountInfo<'info>,
    from: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::burn(CpiContext::new(token_program.to_account_info(), Burn { mint, from, authority }), amount)
}

pub(crate) fn clock_now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

impl<'info> UserMarket<'info> {
    /// Collateral wallet → vault (user signs).
    fn pull_cash(&self, amount: u64) -> Result<()> {
        require!(self.user_collateral.amount >= amount, MontionsError::InsufficientCash);
        token_transfer(
            &self.token_program,
            self.user_collateral.to_account_info(),
            self.vault.to_account_info(),
            self.user.to_account_info(),
            None,
            amount,
        )
    }

    /// Burn the caller's SPL YES / NO (taken into the market's custody or redeemed).
    fn burn_tokens(&self, yes: u64, no: u64) -> Result<()> {
        require!(
            self.user_yes.amount >= yes && self.user_no.amount >= no,
            MontionsError::InsufficientTokens
        );
        token_burn(
            &self.token_program,
            self.yes_mint.to_account_info(),
            self.user_yes.to_account_info(),
            self.user.to_account_info(),
            yes,
        )?;
        token_burn(
            &self.token_program,
            self.no_mint.to_account_info(),
            self.user_no.to_account_info(),
            self.user.to_account_info(),
            no,
        )
    }

    /// Vault → wallet collateral and freshly minted YES / NO, all signed by the market PDA.
    /// The caller must have dropped every `Market` borrow (the market is the CPI authority).
    fn pay_out(&self, signer: &MarketSigner, cash: u64, yes: u64, no: u64) -> Result<()> {
        let seeds = signer.seeds();
        let market = self.market.to_account_info();
        token_transfer(
            &self.token_program,
            self.vault.to_account_info(),
            self.user_collateral.to_account_info(),
            market.clone(),
            Some(&seeds),
            cash,
        )?;
        token_mint(
            &self.token_program,
            self.yes_mint.to_account_info(),
            self.user_yes.to_account_info(),
            market.clone(),
            &seeds,
            yes,
        )?;
        token_mint(&self.token_program, self.no_mint.to_account_info(), self.user_no.to_account_info(), market, &seeds, no)
    }
}

/// Pull `required_escrow` from the wallet (transfer collateral, burn held YES/NO), match, push
/// `cash_out` / mint `yes_out` / `no_out` back. Returns the engine result as return data.
pub fn place_order(ctx: Context<UserMarket>, args: PlaceArgs) -> Result<PlaceResult> {
    let a = &ctx.accounts;
    // Paused: only orders backed by held tokens (they can only reduce the caller's exposure).
    require!(!a.config.paused || args.from_held, MontionsError::Paused);
    let fee_bps = a.config.fee_bps;
    let esc = Market::required_escrow(&args, fee_bps)?;
    a.pull_cash(esc.cash)?;
    a.burn_tokens(esc.yes, esc.no)?;

    let now = clock_now()?;
    let (r, signer) = {
        let mut m = a.market.load_mut()?;
        let r = m.place_taker(a.user.key, &args, fee_bps, now)?;
        (r, MarketSigner::new(&m))
    };
    a.pay_out(&signer, r.cash_out, r.yes_out, r.no_out)?;

    emit!(OrderPlaced {
        market: a.market.key(),
        owner: a.user.key(),
        order_id: r.order_id,
        side: args.side,
        tick: args.tick,
        qty: args.qty,
        filled: r.filled,
        resting: r.resting,
        from_held: args.from_held,
    });
    Ok(r)
}

/// Cancel one resting order, then pay out the seat's free balances to the wallet.
pub fn cancel_order(ctx: Context<UserMarket>, order_id: u64) -> Result<()> {
    let a = &ctx.accounts;
    let (qty, (cash, yes, no), signer) = {
        let mut m = a.market.load_mut()?;
        let qty = m.cancel_order(a.user.key, order_id)?;
        let free = match m.find_seat(a.user.key) {
            Some(seat) => m.take_seat_free(seat),
            None => (0, 0, 0),
        };
        (qty, free, MarketSigner::new(&m))
    };
    a.pay_out(&signer, cash, yes, no)?;
    emit!(OrderCancelled { market: a.market.key(), owner: a.user.key(), order_id, qty });
    Ok(())
}

/// Pay out the caller's seat free balances (cash → collateral ATA, YES/NO → minted SPL).
/// No-op if the caller has no seat.
pub fn withdraw_seat(ctx: Context<UserMarket>) -> Result<()> {
    let a = &ctx.accounts;
    let ((cash, yes, no), signer) = {
        let mut m = a.market.load_mut()?;
        let free = match m.find_seat(a.user.key) {
            Some(seat) => m.take_seat_free(seat),
            None => (0, 0, 0),
        };
        (free, MarketSigner::new(&m))
    };
    a.pay_out(&signer, cash, yes, no)
}

/// Deposit `qty * UNIT` collateral, receive `qty` YES + `qty` NO.
pub fn split(ctx: Context<UserMarket>, qty: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, MontionsError::Paused);
    let now = clock_now()?;
    let (amount, signer) = {
        let mut m = a.market.load_mut()?;
        let amount = m.split(qty, now)?;
        (amount, MarketSigner::new(&m))
    };
    a.pull_cash(amount)?;
    a.pay_out(&signer, 0, qty, qty)
}

/// Burn `qty` YES + `qty` NO, receive `qty * UNIT` collateral (until settlement).
pub fn merge(ctx: Context<UserMarket>, qty: u64) -> Result<()> {
    let a = &ctx.accounts;
    a.burn_tokens(qty, qty)?;
    let (payout, signer) = {
        let mut m = a.market.load_mut()?;
        let payout = m.merge(qty)?;
        (payout, MarketSigner::new(&m))
    };
    a.pay_out(&signer, payout, 0, 0)
}

/// After settlement: burn SPL YES/NO and receive the payout. Returns the payout.
pub fn redeem(ctx: Context<UserMarket>, yes_qty: u64, no_qty: u64) -> Result<u64> {
    let a = &ctx.accounts;
    a.burn_tokens(yes_qty, no_qty)?;
    let (payout, signer) = {
        let mut m = a.market.load_mut()?;
        let payout = m.redeem(yes_qty, no_qty)?;
        (payout, MarketSigner::new(&m))
    };
    a.pay_out(&signer, payout, 0, 0)?;
    emit!(Redeemed { market: a.market.key(), owner: a.user.key(), yes_qty, no_qty, payout });
    Ok(payout)
}
