# Kairo litepaper

Kairo (formerly Montions).

11 October 2026 · two pages · the long form is [the thesis](./thesis.md); the mechanism is [Canonical Events](../cross-chain-options.md)

---

**Options are the right product, sold through the wrong interface, on the wrong venue.**

People already buy unbounded direction (perps) and bounded yes/no (prediction markets). An option is the thing in between — asymmetric payoff, max loss equal to the premium — sold through strike chains and greeks, on desks and siloed chains. Kairo sells it as a ticket.

> “I think SOL will be above $120 by Friday with $100.”

## The product

A market is one question: **is SYMBOL ≥ STRIKE at EXPIRY?** YES pays $1 if true, NO pays $1 if false. The price of YES is an implied probability (ticks 1–99¢). Every contract is **100% collateralised**: YES + NO = $1 locked. No margin, no liquidation, no insurance fund. Matching is a fully onchain CLOB (price-time priority). If you are right on a 41¢ YES, you receive $1; if you are wrong you lose 41¢ and never owe more.

A vanilla call is a stack of these binaries. We start at the atom.

**One ticket.** Budget $100, best ask 41¢, 400 resting: buy 243 YES, pay $99.63 (max loss), receive $243 if SOL’s first print is ≥ $120. A writer locked $143.37 and received 243 NO. The pool went up $243. If the next level is 70¢, you do not get 243 contracts — the quote walks the book.

**Settlement** is the same sentence on every chain: the **first oracle print at or after expiry**. Chainlink proves it with a predecessor round (Base, Arbitrum). Pyth proves it with `prev_publish_time` when posted (Solana; sponsored-feed window otherwise). If no valid print arrives, the market **voids 50/50**. Nobody in Kairo picks the timestamp except where an oracle cannot prove first-print — those cases are labelled.

## Why multi-chain, without bridging the ticket

USDC already sits in size on Ethereum ($45.2b), Hyperliquid L1 ($7.1b), Solana ($6.8b), Base ($4.4b) and Arbitrum ($2.3b) — DefiLlama, 11 Oct 2026. Users will not bridge mid-hunch. Bridging *while a ticket is open* adds messenger risk on top of options risk.

So:

1. **Canonical event.** The market is `SYMBOL:strike:expiry` on every venue. Same strike grid, same expiry schedule.
2. **Collateral-local.** Each book is fully funded in local USDC-style collateral. A Base fill is a Base liability.
3. **Liquidity-global (routing).** The UI quotes every live book and sends the ticket to the best tradable price. It does not bridge the $100.
4. **Contingent-surplus netting (proposed, not built).** Unpaired YES on chain A and unpaired NO on chain B are worth $1 whenever the oracles agree, paid *after* settlement from whichever venue holds leftover collateral. Until that ships, we are honest multi-venue, not unified liquidity.

Hyperliquid is **paused** (UI: “Soon”). Ship order: Base Sepolia + Arbitrum Sepolia; Base and Arbitrum Books are deployed; Solana devnet is reported deployed (fresh reads unavailable).

## Market, in one table

Retrieved 11 Oct 2026. Snapshots, not forecasts.

| Flow | Size | Source |
|---|---|---|
| Hyperliquid perps | $2.96b notional that day; $12.1b OI | Hyperliquid info API |
| Deribit BTC+ETH options | ~$202m notional / ~$1.5m premium that day; large OI | Deribit public API (Sunday) |
| Onchain listed options | **$90.0m premium / 30d**, of which Derive $82.0m | DefiLlama options |
| Polymarket US+Intl | $188m / 1d, **$5.09b / 30d** | DefiLlama DEX volumes |
| Kalshi | $459m / 1d, **$13.05b / 30d** | DefiLlama DEX volumes |

Event-contract UX already has the volume. Onchain vanilla options do not. We are building the price-threshold binary that those users would recognise, with an onchain matcher.

## Interface, two modes, one book

**Serious** — night palette, short copy, for people who have been liquidated on a perp and want a defined-risk ticket.

**UwU** — pastel/sakura, original mascots only (never copied characters), same numbers and the same max-loss line. The ticket is meant to be screenshotted. If it reads as a costume on a bucket shop, we turn it off.

## Why this can work — and when it doesn’t

It works if a sentence fills against a two-sided, solvent book and settles on a named print. Cheap matching now exists on Base, Arbitrum, and Solana; USDC is already there; Polymarket/Kalshi trained the probability UI.

It fails if the maker is picked off and LPs leave; if Polymarket, Kalshi, or Hyperliquid HIP-4 list the same questions with deeper books; if regulators treat us as banned retail binaries (EU/UK/AU bans are real; US event contracts live on DCMs); if we split one thin book across three chains; if we ship mainnet unaudited.

Liquidity, not UX, is the bottleneck. A model-priced maker (\(N(d_2)\)) is designed to rest bounded quotes and stop near expiry; Solana maker cap gaps remain unresolved. Cold start is per chain. Cross-chain netting is later.

## Business (intended; testnet fee = 0)

Taker fee 10–30 bps of premium (hard cap 100 bps, makers 0). Vault spread to LPs; optional later performance fee on *profits*, never sold as yield. Venue/API licensing as a third line. A $100 ticket at 41¢ and 20 bps pays about **$0.20** of protocol take. Interesting only at real flow.

## Status (honest)

As of **2026-10-11 18:36 UTC**. [Website](https://kairo-nu-red.vercel.app) · [Evidence](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md) · [Addresses](../docs/chains.md).

| Piece | Status |
|---|---|
| Base Sepolia / Arbitrum Sepolia | **LIVE Book deployments**, Base v2 / Arb v1, **150 / 81 total registered series**; liquidity and runtime fixes not attested |
| Solana devnet | **Reported deployed**, 28 seeded historically; fresh RPC failed, current count and keeper unverified |
| Stocks / ETFs | **29 Base tickers**, keeper-reported demo oracle; Pyth path API-key gated |
| Event markets | **DEPLOYING**, optimistic resolver fork-rehearsed; no live resolver in manifests |
| Hyperliquid | **PAUSED / Soon**, not routable |
| UI | Serious/UwU and routing source implemented; HTTP 200; browser E2E unverified |
| CSN / teleport / netting | **PROPOSED, not built** |
| Mainnet | **NOT LIVE**; testnet, unaudited |

Known unresolved Solana maker caps, print selection, table DoS and one-sided quotes; EVM source fixes are not verified on both live runtimes. [Full limitations](../cross-chain-options.md#known-limitations).

Read next: [thesis](./thesis.md) · [paper](../cross-chain-options.md) · [how it works](../docs/how-it-works.md)
