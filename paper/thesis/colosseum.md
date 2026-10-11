# Kairo — Colosseum submission

Kairo (formerly Montions).

**One-liner:** Say what you think a price will do, set your budget, and trade a fully collateralised YES/NO ticket on a Solana onchain order book.

As of **2026-10-11 18:36 UTC**: testnet, unaudited, mainnet not live. Solana deployment and 28 seeded markets are **manager-reported**; fresh devnet program/state reads failed due to RPC rate limits and transport errors. [Verification record](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md). The count and running keeper must be rechecked before final submission; no fresh Solana liveness claim is made here.

## Problem

A trader can say “SOL above $120 by Friday; I’ll risk $100,” but conventional options interfaces require strike chains and greeks. Perpetuals add liquidation risk; isolated prediction books fragment liquidity. A clear price-threshold ticket should have bounded loss, verifiable matching and explicit settlement rules.

## Solution

Kairo turns an asset, direction, strike, expiry and budget into a ticket against a public CLOB. YES pays $1 tUSDC when the price is at least the strike; NO pays the complement. Every YES/NO pair is backed by $1 of local collateral. The premium bounds a long holder’s loss; there is no margin engine. Price-time matching, escrow, split/merge and redemption run onchain.

## Why Solana

The Anchor program keeps each market’s CLOB, seats and accounting in **one zero-copy market account**, with bounded 64-order / 24-seat tables. SPL YES/NO outcome tokens and a collateral vault make the claims explicit. Solana transaction composition lets the app combine **permissionless market creation with the first trade in the same transaction**, where required accounts and compute/rent permit it.

Settlement uses fully verified **Pyth PriceUpdateV2** updates on devnet. The exact path checks `prev_publish_time < expiry <= publish_time`; the sponsored-feed fallback accepts a print inside a short settlement window and therefore permits print selection. Strict first-print settlement is a planned fix, not an achieved guarantee. Cheap execution and account composition support the ticket flow without a backend matcher.

## Solana devnet deployment and two-minute trial

- Program: `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`.
- [Solana devnet explorer](https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet).
- **28 seeded markets reported by the manager**; current total/open count and keeper uptime could not be verified in this refresh. Pyth settlement is implemented in the program; no fresh settlement transaction was independently confirmed.

1. Open [Kairo](https://kairo-nu-red.vercel.app), select **Solana**, and connect Phantom/Solflare on **Devnet**, or choose **Devnet burner** (local testnet wallet).
2. Click **Faucet**. The Solana adapter attempts a devnet SOL airdrop when gas is low and claims protocol tUSDC. If rate-limited, use the [Solana devnet faucet](https://faucet.solana.com/) and retry later. New market creation is budgeted at roughly 0.05 SOL by the UI; existing markets require less.
3. Pick asset → above/below → strike → expiry → budget. Check the quote and maximum loss; confirm the ticket in the wallet (or burner).
4. After valid resolution, claim winning tokens for $1 each; void tokens pay 50¢. Empty books, expired listings and unavailable RPCs can prevent a trade. Two minutes is a target when gas, faucet, liquidity and RPC are available; the website trading flow has not been independently browser-tested by this refresh.

## Canonical Events: Solana plus additional venues

The chain-independent key is `SYMBOL:strike:expiry`. Base Sepolia v2 and Arbitrum Sepolia v1 are **live additional Book deployments**, with **150 and 81 registered series** respectively at this snapshot; [addresses and explorers](../docs/chains.md). The UI can compare quotes only for identical keys and route to a tradable venue. Collateral and liabilities stay on that chain. The chains do not share one pool, asset coverage differs, and oracle prints can disagree near the strike.

Contingent-surplus netting, teleport and cross-venue inventory netting are **proposed, not built**. Hyperliquid is **PAUSED / Soon**, disabled and not routable. Base’s 29 stock/ETF tickers use a **keeper-reported demo oracle**; the Pyth equity path is built but API-key gated and not verified live. Optimistic real-world event markets are **deploying**, with no live event resolver in the current manifests.

## Technology

Anchor 0.32.1 / Rust, Solana, SPL Token, Pyth receiver PriceUpdateV2, TypeScript SDK and keeper; React 19 / Vite, Wallet Standard (Phantom/Solflare) and a devnet burner. Additional EVM venues use Solidity / Foundry, viem, Chainlink crypto feeds and ERC-1155 outcomes. Matching does not require an offchain matcher; keeper services support quoting and settlement liveness.

## Team and AI-assisted build disclosure

Human-directed, AI-assisted hackathon build. The workspace reports Grok via the `pi` harness and Codex contributions across implementation, review and documentation. Humans set scope and product direction. Contributor identities and individual roles are not independently verified in this brief, so this submission does not invent names or imply sole authorship. The historical EVM codebase is retained in `montions/`; this submission focuses on the implemented Solana program and its ticket flow.

## Known limitations

Testnet tUSDC is play money and is not Circle USDC. No professional audit. Solana per-market maker exposure omits inventory and there is no global maker cap; cheap orders can fill the 64-order / 24-seat tables; permissionless refresh with POST_ONLY skips can leave quotes one-sided; the sponsored Pyth window allows print selection. Planned fixes: inventory-aware exposure, global/per-asset caps, restricted or rate-limited refresh, larger/paged books and strict first-print settlement. Admin changes to live oracle rails and non-positive-price void behavior also need hardening.

EVM source fixes are not attested on both deployed runtimes, keeper liveness is unverified, and the planned event arbitrator is an owner EOA. [Full known limitations](../cross-chain-options.md#known-limitations). Do not use real funds or describe this as mainnet-ready.

## Links

- [Website](https://kairo-nu-red.vercel.app)
- [GitHub](https://github.com/argenestel/kairo)
- [Paper](https://kairo-nu-red.vercel.app/paper) · [source paper](../cross-chain-options.md)
- [Docs](https://kairo-nu-red.vercel.app/docs) · [source user guide](../docs/user-guide.md)
- Demo video: **{{DEMO_VIDEO_URL}}** — intentionally pending; replace before submission.

## Hackathon form answers

**Project name:** Kairo

**Tagline (≤ 80 characters):** Outcome-first tickets on a fully collateralised Solana order book.

**Short description (≤ 280 characters):** Kairo turns a price view and budget into a YES/NO ticket on a Solana onchain CLOB. Anchor, SPL outcome tokens and Pyth settlement; devnet deployment reported, fresh RPC checks unavailable. Base/Arbitrum are additional testnet venues. Unaudited.

**Long description (≤ 2,000 characters):** Kairo makes a price view tradable: “SOL above $120 by Friday; I’ll risk $100.” The app compiles asset, strike, expiry and budget into a YES/NO ticket. Each pair is backed by $1 of local tUSDC; a long holder’s loss is bounded by the premium. Matching, escrow and redemption run onchain.

The Solana Anchor program keeps each CLOB and its seats/accounting in one zero-copy market account, issues SPL outcome tokens, and permits market creation in the same transaction as the first trade. Pyth PriceUpdateV2 supports exact first-print settlement plus a sponsored-window fallback that currently permits print selection. Strict first-print settlement is planned.

The manager reports a devnet deployment at MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh with 28 seeded markets. Fresh RPC checks failed, so current markets and keeper uptime are unverified. Try the website with Phantom/Solflare on Devnet or the burner and faucet when RPC and liquidity are available.

Canonical Events identifies the same asset/strike/expiry across venues. Base and Arbitrum Books are deployed with 150/81 total series as of 2026-10-11 18:36 UTC. Collateral stays local; no unified pool or live cross-chain netting is claimed. Hyperliquid is paused. Base stocks use 29 keeper-reported demo feeds; Pyth equity tooling is API-key gated. Optimistic event markets are deploying.

Human-directed and AI-assisted (Grok/Codex). Testnet only, unaudited. Known Solana gaps include inventory/global maker caps, small-table DoS, one-sided refresh and settlement print selection. Website browser trading and continuous keeper operation remain unverified. https://kairo-nu-red.vercel.app · https://github.com/argenestel/kairo

**Tracks/categories:** DeFi / trading; consumer applications; infrastructure / cross-chain interoperability. Suggested categories only; map them to the actual form’s available tracks.

**Tech tags:** Solana, Anchor, Rust, SPL Token, Pyth, TypeScript, React, Vite, Wallet Standard, CLOB, binary options, devnet.
