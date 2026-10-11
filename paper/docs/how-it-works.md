# How it works

A ticket is compiled to an order on one venue’s book. Matching, escrow and settlement are onchain. Numbers below use 6-decimal collateral (`UNIT = 1_000_000` = $1).

## 1. Sentence → market

“I think SOL will be above $120 by Friday with $100.”

- **Asset** `SOL`, **strike** `$120`, **expiry** Friday 16:00 UTC, **direction** above.
- Canonical key: `SOL:120:<unix>`.
- Above = buy **YES**. Below = buy **NO** on the same market.
- The UI asks every connected venue for a quote on that key and can pick the best book (most contracts per dollar, currently tradable).

## 2. Quote against the book

Prices are integer **ticks 1–99** (cents). YES at 41¢ means the book’s implied probability is 41%. NO at the same tick costs 59¢.

Suppose Solana’s ask is 41¢ with 180 contracts resting, and you spend $100:

| | |
|---|---|
| Contracts | `floor(100 / 0.41) = 243` YES (if the book is deep enough; otherwise you walk the book) |
| Cost (max loss) | ≈ `$99.63` |
| Payout if right | `$243` |
| Profit if right | ≈ `$143.37` |
| If wrong | you lose the premium; you never owe more |

A **write** (selling YES you don’t hold) locks the complement: writing 243 YES at 41¢ escrows `243 × $0.59`. The writer receives 243 NO. YES + NO still equal $1 locked in the pool.

## 3. Place the order

On Solana the program pulls tUSDC from your wallet in the same instruction as `place_order`. On EVM you deposit (optionally with EIP-2612 permit) then `placeOrder`, or multicall both.

Matching is **price-time priority**. Trade price = the resting maker’s tick. Self-trade prevention cancels your own resting order rather than filling it. Time-in-force: GTC, IOC, POST_ONLY.

You can also **split** $q into `q` YES + `q` NO, or **merge** a pair back into $q, while the market is open.

## 4. Hold, sell, or wait

- Sell back into the book (`fromHeld`).
- Wait for expiry.
- After resolution, **claim** / `redeem`: winning tokens pay $1; losers pay $0; void pays 50¢ per token.

## 5. Settlement

After expiry, anyone (usually a keeper) records the oracle print and calls `resolve`.

Worked YES: strike $120, first print $121.40 → YES wins. Your 243 YES redeem for $243.

Worked void: no valid print within the venue’s window, and `VOID_GRACE` has passed (24 h on Solana, 2 days on EVM) → anyone voids. 243 YES + 0 NO redeem for `$121.50`.

Exact per-oracle rules: [settlement](./settlement.md).

## 6. What does *not* happen (yet)

Collateral does not bridge when you trade. A proposed later step, **contingent-surplus netting**, would let a YES on venue A and a NO on venue B settle as a $1 pair after expiry. That is specified in the paper and is **not built**.
