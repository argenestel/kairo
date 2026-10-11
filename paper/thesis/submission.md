# Kairo — hackathon submission

Kairo (formerly Montions).

**One-liner.** Outcome-first binary options with a fully onchain CLOB: say *“I think SOL will be above $120 by Friday with $100,”* and trade it against a real book. Same event on every chain; dollars stay local.

**Thesis:** [thesis.md](./thesis.md) · **Litepaper:** [litepaper.md](./litepaper.md) · **Paper:** [Canonical Events](../cross-chain-options.md) · **Docs:** [overview](../docs/overview.md)

---

## What it is

A market is **is SYMBOL ≥ STRIKE at EXPIRY?** YES pays $1 if true, NO pays $1 if false. Price = implied probability (1–99¢). Every contract is **100% collateralised**. Matching, escrow and settlement are onchain — no backend matcher, no indexer required to trade.

The UI is a **ticket printer**, not a strike chain. Two modes, one machinery: **Serious** (night, short copy) and **UwU** (pastel/sakura, original mascots — never copied characters). Chain picker: Base · Arbitrum · Solana · Hyperliquid **Soon** (not routable).

Settlement is **first print at or after expiry** (Chainlink adjacency on Base/Arbitrum; Pyth on Solana). No valid print → void 50/50. Price-market outcomes follow oracle checks; event arbitration (deploying) trusts an owner EOA, and Solana admin can alter live oracle rails.

Cross-chain: canonical key `SYMBOL:strike:expiry`, best-venue routing, local collateral. **Contingent-surplus netting is specified, not built.**

## Why it matters

Retail already has the view (perps) and the yes/no language (Polymarket, Kalshi). Listed options hid that behind greeks and desks; onchain options became vaults. Cheap matching now exists on Base, Arbitrum, and Solana, and USDC already lives there in the billions (DefiLlama, 11 Oct 2026). The missing product is a defined-risk ticket on a solvent public book, listed where the user already sits, without bridging while the ticket is open.

## What’s live

As of **2026-10-11 18:36 UTC**. Testnet tUSDC only; unaudited; mainnet is not live. Website: [Kairo](https://kairo-nu-red.vercel.app); [GitHub](https://github.com/argenestel/kairo). Counts include registered series, not necessarily open or liquid books. Bytecode confirms deployment, not successful trading or settlement.

| Component | Verified status | Address / evidence |
|---|---|---|
| Base Sepolia (84532) | **LIVE**, current v2 manifest; **150 registered series** from Book | [Book `0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659`](https://sepolia.basescan.org/address/0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659) |
| Arbitrum Sepolia (421614) | **LIVE**, existing v1 manifest; **81 registered series** from Book; v2 fixes not assumed deployed | [Book `0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e`](https://sepolia.arbiscan.io/address/0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e) |
| Solana devnet | **Reported live on devnet** — 28 seeded markets and keeper running per manager; fresh program/market reads failed (public RPC 429 / CLI transport error). Current market count and keeper liveness are not independently confirmed. | [Program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`](https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet) |
| Stocks / ETFs | **29 tickers** in Base v2 manifests; **keeper-reported demo oracle**; hub bytecode present. Fresh equity price/settlement liveness not measured | Pyth path built; API key absent; signed equity updates still need acceptance/entitlement verification |
| Event markets | **DEPLOYING** — optimistic resolver built and fork-rehearsed; no live event resolver in either current manifest | Bonded assertion → challenge window → owner-EOA arbitration on testnet; no live event trading claimed |
| Hyperliquid / HyperEVM | **PAUSED** — planned/in-progress; not live or routable | Disabled “Soon”; HyperCore windowed record is a proposed weaker settlement path |
| UI / canonical keys / routing | Implemented in source, website responds HTTP 200; Serious and UwU copy exist; browser trading E2E unverified | UI modes report empty; app-e2e report missing at this snapshot |
| Model maker | Deployed components; active quotes and continuous keeper operation not verified by this refresh | Solana `refresh_quotes`, EVM MakerVault; inventory remains local |
| CSN / teleport / cross-venue maker netting / disagreement reserve | **PROPOSED, not built** | Paper §6 |
| Mainnet | **NOT LIVE** | Audit, operational hardening and production collateral/oracles required |

Ground truth and reproducible commands: [verification record](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md). Historical reports and `montions-base/docs/EVM.md` contain v1 Base addresses and 63-series snapshots; current manifests and fresh RPC reads supersede them.

[Current contract addresses](../docs/chains.md). [Known limitations](../cross-chain-options.md#known-limitations).

## How to try it in two minutes

1. Open [Kairo](https://kairo-nu-red.vercel.app). Testnet — play money.
2. Pick **Solana** (reported deployed and seeded; fresh count unverified). Switch the wallet to **devnet**.
3. Get a little SOL from [faucet.solana.com](https://faucet.solana.com). Connect. Hit **Faucet** for tUSDC.
4. Asset → above/below → strike → expiry → budget. Read contracts, max loss, payout. **Print my ticket.** Confirm in the wallet.
5. After expiry, **Claim**. Winning tokens pay $1; void pays 50¢.

Base and Arbitrum Books are deployed; to try either, pick that chain, use the chain’s ETH faucet, then the in-app tUSDC faucet. Hyperliquid is disabled.

User guide: [docs/user-guide](../docs/user-guide.md).

## Architecture

```
ticket (sentence + $)
        │
        ▼
canonical key  SYMBOL:strike:expiry
        │
        ▼
quote all live adapters → route to best tradable book
        │
        ├─ Solana devnet ── Anchor program ── Pyth PriceUpdateV2 ── SPL YES/NO
        ├─ Base Sepolia  ── MontionsBook ──── Chainlink first round ── ERC-1155
        └─ Arbitrum Sep  ── same Book ─────── Chainlink first round ── ERC-1155
                │
                ▼
        100% local tUSDC · resolve / void · redeem
```

No backend matcher; operational keepers are needed for liveness. Protocol instructions are permissionless (create ladder, `refresh_quotes` / vault refresh, record, resolve). Specs: `montions/docs/SPEC.md`, `montions-sol/docs/SPEC.md`. Threat model: `montions/docs/THREAT_MODEL.md`.

## Team / AI-assisted build disclosure

This stack was built in a compressed hackathon window with **AI coding agents** (Grok via the `pi` harness; earlier Codex passes until credits ran out) under human direction. The original product thesis and Monad EVM Book live in `montions/` (read-only). Humans set scope (EVM first on Base + Arbitrum, Solana as side line, Hyperliquid paused), reviewed settlement rules, and required honest live-vs-proposed labelling. Treat the repo as AI-assisted engineering, not as a single-author from-scratch claim. **Unaudited.**

## Tracks it fits

| Track | Why it is a fit | Why it might not win the track |
|---|---|---|
| **Base** | EVM target #1; Chainlink on 84532; native USDC on mainnet later | Base v2 deployed; runtime fixes and browser E2E need verification |
| **Arbitrum** | Same Book, Chainlink on 421614; native USDC | Arbitrum v1 deployed; v2 fixes not verified live |
| **Solana / Colosseum** | Reported devnet program, 28 seeded markets, Pyth sponsored feeds; current liveness unverified | Dedicated Solana-first submission: [Colosseum](https://github.com/argenestel/kairo/blob/main/paper/thesis/colosseum.md); current Solana reads unavailable |
| **Cross-chain / infra** | Canonical events, oracle-equivalent first-print, CSN spec | CSN itself is not implemented; do not judge as a live bridge |
| **Consumer** | Ticket printer, Serious/UwU, shareable slip, defined-risk copy | Culture mode must not be cringe; still a financial product |

Finance & trading is the home category. We are not submitting as a prediction-market clone for elections.

## Honest limitations

- Testnet tUSDC, not Circle USDC. Faucets, not deposits.
- No third-party audit, no legal review, no multisig on production.
- Binary options / event contracts are regulated or banned for retail in several jurisdictions (EU, UK, AU; US DCM path). Nothing here is advice. Geoblocking is required before mainnet.
- Pyth sponsored-window fallback on Solana lets a resolver pick a print inside 60 s unless a unique first-print update is posted.
- Maker vaults can lose money to informed flow.

Demo script: [demo-script.md](./demo-script.md). Pitch outline: [pitch.md](./pitch.md).
