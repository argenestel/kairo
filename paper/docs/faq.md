# FAQ

Kairo (formerly Montions).

## Is this mainnet? Can I lose real money?

No. Testnets and play-money tUSDC. Mainnet is not live and is not ready for real funds. If someone is offering you “Kairo mainnet,” it is not this deployment.

## What is a ticket?

A sentence plus a budget: asset, direction (above/below), strike, expiry, dollars to risk. The app compiles it to a buy of YES or NO on a venue’s book.

## Why is the price 41¢?

That is the book’s price of one YES contract. It is an implied probability, not a spot price. If you are right you receive $1 per contract; if you are wrong you lose the 41¢.

## Which chain should I use?

Base v2 and Arbitrum v1 Books are deployed. Solana is reported deployed; current reads were rate-limited. Hyperliquid is **PAUSED**, not routable. [Current addresses, counts and gas instructions](./chains.md). You need gas and tUSDC on the chain you trade on.

## Do you bridge my USDC?

No. Each venue is fully collateralised in local tUSDC. Cross-venue surplus netting (a way to move a dollar *after* settlement) is specified in the paper and is **not built**.

## Who sets the expiry price?

The venue’s oracle, under “first print at or after expiry.” Chainlink: first round with a predecessor proof. Pyth: first signed print (`prev_publish_time` / unique parse), with a short sponsored-window fallback on Solana. HyperCore (planned, PAUSED): first `record()` in a short window — weaker, documented in [settlement](./settlement.md). Price outcomes follow oracle checks; Solana admin can change live oracle rails, and the planned event arbitrator is an owner EOA. If no valid print arrives, the market voids 50/50.

## What if two chains disagree?

Each chain pays according to its own oracle. Near the strike that can happen. You are not hedged across venues unless you hold both legs yourself. A future disagreement reserve is proposed, not shipped.

## What is a void?

No acceptable oracle result within the window + grace period (24 h Solana, 2 days EVM). Redeem YES and NO for 50¢ each. Better than stuck funds.

## Oracle trust

You trust Chainlink, Pyth, or HyperCore (plus the recorder on HyperEVM). You also trust Circle if mainnet USDC is used later (blacklist / upgrade). Pool-TWAP oracles in the original Monad demo are manipulable at low liquidity and are labelled MOCK.

## Maker vault / protocol maker

A model-priced maker (`N(d2)`) rests two-sided quotes so books are not empty. Solana’s per-market cap omits inventory and no global maker cap exists; intended cap protections remain incomplete. It can still lose money to informed flow. Vault deposits are not a savings product.

## Fees

Taker fee is 0 by default (cap 100 bps). Makers pay 0. Hyperliquid HIP-4 outcome markets are a different venue with their own fee schedule.

## Binary options and the law

Event contracts and binary options are regulated in many places (for example Kalshi operates as a CFTC-regulated DCM in the US; some offshore binaries are banned). Venue and product type matter. Nothing here is financial, legal, or tax advice. Geoblocking may be required before any mainnet launch. If this product is illegal for you, do not use it.

## I found a bug / the book looks wrong

Settlement, balances and outcomes are onchain — check the explorer. Keepers are permissionless; you can resolve/void yourself after the rules allow it. Do not send private keys to anyone.

## Where is the paper?

[Canonical Events](../cross-chain-options.md).

Status as of **2026-10-11 18:36 UTC**: [verification record](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md), [known limitations](../cross-chain-options.md#known-limitations). Stocks use a keeper-reported demo oracle (29 Base tickers); Pyth migration is API-key gated. Events are deploying, not live.
