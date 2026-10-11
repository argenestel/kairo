# Montions — hackathon submission

**One-liner.** Outcome-first binary options with a fully onchain CLOB: say *“I think SOL will be above $120 by Friday with $100,”* and trade it against a real book. Same event on every chain; dollars stay local.

**Thesis:** [thesis.md](./thesis.md) · **Litepaper:** [litepaper.md](./litepaper.md) · **Paper:** [Canonical Events](../cross-chain-options.md) · **Docs:** [overview](../docs/overview.md)

---

## What it is

A market is **is SYMBOL ≥ STRIKE at EXPIRY?** YES pays $1 if true, NO pays $1 if false. Price = implied probability (1–99¢). Every contract is **100% collateralised**. Matching, escrow and settlement are onchain — no backend matcher, no indexer required to trade.

The UI is a **ticket printer**, not a strike chain. Two modes, one machinery: **Serious** (night, short copy) and **UwU** (pastel/sakura, original mascots — never copied characters). Chain picker: Base · Arbitrum · Solana · Hyperliquid **Soon** (not routable).

Settlement is **first print at or after expiry** (Chainlink adjacency on Base/Arbitrum; Pyth on Solana). No valid print → void 50/50. Owner cannot move user funds or change an outcome.

Cross-chain: canonical key `SYMBOL:strike:expiry`, best-venue routing, local collateral. **Contingent-surplus netting is specified, not built.**

## Why it matters

Retail already has the view (perps) and the yes/no language (Polymarket, Kalshi). Listed options hid that behind greeks and desks; onchain options became vaults. Cheap matching now exists on Base, Arbitrum, and Solana, and USDC already lives there in the billions (DefiLlama, 11 Oct 2026). The missing product is a defined-risk ticket on a solvent public book, listed where the user already sits, without bridging while the ticket is open.

## What’s live (11 Oct 2026)

Scrupulous. Testnet play money. Unaudited. Mainnet is **not** live.

| Piece | Status | Pointer |
|---|---|---|
| Solana devnet program | **LIVE** — 28 markets, keeper running | `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh` |
| EVM Book + Chainlink settlement | Code complete (`forge test` 295) | `montions-base/` |
| Base Sepolia (84532) | **DEPLOYING** — fork rehearsal done; public bytecode not assumed | Book `{{BASE_BOOK}}` · Oracle `{{BASE_ORACLE}}` · Resolver `{{BASE_RESOLVER}}` · Vault `{{BASE_VAULT}}` · tUSDC `{{BASE_COLLATERAL}}` · Quoter `{{BASE_QUOTER}}` |
| Arbitrum Sepolia (421614) | **DEPLOYING** | Book `{{ARB_BOOK}}` · Oracle `{{ARB_ORACLE}}` · Resolver `{{ARB_RESOLVER}}` · Vault `{{ARB_VAULT}}` · tUSDC `{{ARB_COLLATERAL}}` · Quoter `{{ARB_QUOTER}}` |
| Hyperliquid | **Paused** — UI “Soon” | HyperCore oracle documented as planned |
| App | Ticket flow + canonical keys; UwU copy in progress | `montions-app/` |
| CSN / teleport / cross-venue netting | **Proposed** | [paper §6](../cross-chain-options.md) |

Explorers: Solana [devnet](https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet) · Base Sepolia `https://sepolia.basescan.org/address/{{BASE_BOOK}}` · Arbitrum Sepolia `https://sepolia.arbiscan.io/address/{{ARB_BOOK}}`.

## How to try it in two minutes

1. Open the Montions app (`montions-app/`, Vite **5180** in dev). Testnet — play money.
2. Pick **Solana** (the venue that is already deployed and seeded). Switch the wallet to **devnet**.
3. Get a little SOL from [faucet.solana.com](https://faucet.solana.com). Connect. Hit **Faucet** for tUSDC.
4. Asset → above/below → strike → expiry → budget. Read contracts, max loss, payout. **Print my ticket.** Confirm in the wallet.
5. After expiry, **Claim**. Winning tokens pay $1; void pays 50¢.

If Base or Arbitrum public deploys are up, pick that chain instead, use the chain’s ETH faucet, then the in-app tUSDC faucet. Hyperliquid is disabled.

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

No backend. Keepers are permissionless (create ladder, `refresh_quotes` / vault refresh, record, resolve). Specs: `montions/docs/SPEC.md`, `montions-sol/docs/SPEC.md`. Threat model: `montions/docs/THREAT_MODEL.md`.

## Team / AI-assisted build disclosure

This stack was built in a compressed hackathon window with **AI coding agents** (Grok via the `pi` harness; earlier Codex passes until credits ran out) under human direction. The original product thesis and Monad EVM Book live in `montions/` (read-only). Humans set scope (EVM first on Base + Arbitrum, Solana as side line, Hyperliquid paused), reviewed settlement rules, and required honest live-vs-proposed labelling. Treat the repo as AI-assisted engineering, not as a single-author from-scratch claim. **Unaudited.**

## Tracks it fits

| Track | Why it is a fit | Why it might not win the track |
|---|---|---|
| **Base** | EVM target #1; Chainlink on 84532; native USDC on mainnet later | Public Sepolia may still be deploying at submit time |
| **Arbitrum** | Same Book, Chainlink on 421614; native USDC | Same — deploying |
| **Solana / Colosseum** | Live devnet program, 28 markets, Pyth sponsored feeds, keeper | Declared a *side line*; EVM is the ship focus |
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
