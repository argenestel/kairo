# Overview

Kairo (formerly Montions).

Kairo is an **outcome-first binary options** venue with a fully onchain central limit order book. You type a sentence. The app turns it into a ticket against a real book.

> “I think SOL will be above $120 by Friday. I’ll risk $100.”

A market is a yes/no question: **is SYMBOL ≥ STRIKE at EXPIRY?** One YES contract pays **$1** of USDC-style collateral if the answer is yes, and $0 otherwise. NO pays the complement. The price of YES is the implied probability. Maximum loss is the premium. Every contract is **100% collateralised** — no margin, no liquidations, no socialised loss.

The same question is the same **economic event** on every chain. Kairo identifies it with a chain-agnostic key `(asset, strike, expiry)` and targets listings on Base, Arbitrum and Solana; Hyperliquid (HyperEVM) is paused, each with its own oracle under a shared rule: **the first print at or after expiry**. Collateral stays on the chain where you traded. The UI quotes every venue and can route a ticket to the best book.

## What you get

- A sentence, not a strike chain or a greek.
- A public onchain CLOB (price-time priority, ticks 1–99¢).
- Settlement from a named oracle, permissionless to record/resolve, with a 50/50 **void** if no valid print arrives.
- Testnet play money today. Mainnet is not live.

## What is live vs proposed

| Piece | Status |
|---|---|
| Per-venue CLOB, collateral, settlement | Base v2 and Arbitrum v1 Books deployed (150 / 81 total series); Solana reported deployed (28 seeded, fresh reads failed). Hyperliquid **PAUSED**. [Addresses](./chains.md). |
| Canonical keys + multi-chain UI | **In the app** — `canonicalMarketKey(symbol, strike, expiry)`, chain picker, best-venue quotes. |
| Contingent-surplus netting, teleport, cross-venue maker netting | **Proposed** — specified in the [paper](../cross-chain-options.md), not built. |

Read the paper for definitions, proofs, and related work: [Canonical Events](../cross-chain-options.md).

As of **2026-10-11 18:36 UTC**. [Website](https://kairo-nu-red.vercel.app) · [Evidence](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md) · [Known limitations](../cross-chain-options.md#known-limitations). Stocks: **29 keeper-reported demo-oracle tickers on Base**; API-key-gated Pyth path built. Event markets: **deploying**, not verified live.
