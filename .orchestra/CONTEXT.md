# Shared context for every Montions job (read this first)

Montions = outcome-first binary options with a fully onchain central limit order book. A market asks
"is SYMBOL >= STRIKE at EXPIRY?"; YES pays $1 if true, NO pays $1 if false; a contract's price is its implied
probability; every contract is 100% collateralised. Original EVM project (Solidity, Monad): `montions/` —
READ-ONLY, never modify it.

We are shipping it on two chains plus one new UI (workspace root: /home/arg/projects/hack/colessolana):

| Dir | What | State (2026-10-11) |
|---|---|---|
| `montions-sol/` | Anchor 0.32.1 program (Solana **devnet**), program id `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`. Spec: `montions-sol/docs/SPEC.md` (normative). SDK `montions-sol/sdk`, keeper `montions-sol/keeper`, scripts `montions-sol/scripts`, assets `montions-sol/config/assets.devnet.json` | Program complete. Green: `cargo test -p montions` (76 host tests incl. fuzz), `npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'` (61 LiteSVM integration tests), `cd sdk && npx vitest run` (64). Not deployed yet. `.so` = 663 KB |
| `montions-base/` | Copy of montions + Chainlink settlement for **Base Sepolia** (84532): `src/oracle/chainlink/ChainlinkOracle.sol`, `src/resolvers/ChainlinkSettlementResolver.sol`, `script/DeployBase.s.sol`, `test/chainlink/*` | `forge test` = 295 passing. Deploy script/bots/sdk for 84532 unfinished. Not deployed |
| `montions-app/` | New multi-chain React 19 + Vite UI ("ticket printer" flow). The ONLY chain interface is the FROZEN `src/chains/types.ts` (`ChainAdapter`); adapters `src/chains/solana.ts` (exists, 800 lines), `src/chains/base.ts` (todo), `src/chains/mock.ts` | Typecheck clean; visual polish + screenshots unfinished |

Facts (verified):
- Solana devnet Pyth sponsored PriceUpdateV2 accounts are live (SOL, BTC, ETH, BNB, XRP, DOGE; addresses in assets.devnet.json). Pyth receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. Pyth does NOT exist on Solana testnet.
- Base Sepolia: Pyth is stale and Hermes returns 401 → settle on **Chainlink**: ETH/USD `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`, BTC/USD `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298`, LINK/USD `0xb113F5A928BCfF189C998ab20d753a47F9dE5A61` (8 decimals, update every ~10–20 min). RPC https://sepolia.base.org.
- Wallets: Solana admin = `~/.config/solana/id.json` (`BGWoqssaQxfj7k94m23sJuzcM6TrGmd15KGGctB3DY9a`, ~8.96 devnet SOL). Base deployer keystore `montions/.dev/keystore/montions-testnet` + password file `montions/.dev/testnet.pass` (address `0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39`, 0.06 Base Sepolia ETH).
- Toolchain: anchor-cli 0.32.1, solana-cli 3.1.8 (`solana-test-validator`, `solana-keygen` at ~/.local/share/solana/install/active_release/bin/), rustc 1.95, node 22, pnpm 11, yarn, foundry (forge/cast/anvil), ffmpeg, Python 3.

## DIRECTION UPDATE (2026-10-11, from the user) — supersedes anything above that conflicts

1. **EVM first, Solana is a side line.** Ship the Solidity stack on **Base Sepolia (84532), Arbitrum Sepolia
   (421614) and HyperEVM testnet (998)** from ONE codebase: `montions-base/` is now the multi-chain EVM repo
   (keep the directory name). Solana is already deployed + seeded on devnet (program
   `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`, 28 markets, keeper running) — no new Solana work unless a job says so.
2. **Oracles per chain** (all "first print at/after expiry" semantics):
   - Base Sepolia: Chainlink ETH/USD 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1, BTC/USD 0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298, LINK/USD 0xb113F5A928BCfF189C998ab20d753a47F9dE5A61.
   - Arbitrum Sepolia (RPC https://sepolia-rollup.arbitrum.io/rpc): Chainlink ETH/USD 0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165 (~60 s fresh), BTC/USD 0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69 (~30 s), LINK/USD 0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298.
   - HyperEVM testnet (RPC https://rpc.hyperliquid-testnet.xyz/evm, chain 998): **HyperCore native oracle** via the
     read precompile `0x0000000000000000000000000000000000000807` (`oraclePx(uint32 perpIndex)` → uint64, price =
     raw / 10^(6 − szDecimals)). Verified live on testnet: index 0 ≈ SOL 109.70 (raw 1097050, szDec 2), index 3 ≈ BTC
     83155 (raw 831550, szDec 5), index 4 ≈ ETH 2506.88 (raw 250688, szDec 4). Get the testnet perp universe +
     szDecimals from `POST https://api.hyperliquid-testnet.xyz/info {"type":"meta"}`. The precompile only exposes
     the CURRENT price, so settlement = a permissionless `record()` accepted only inside [expiry, expiry + window]
     (first recorder wins; keeper records within seconds) — document this honestly.
   - Large contract deploys on HyperEVM need **big blocks** (`evmUserModify {usingBigBlocks:true}` L1 action signed by
     the deployer, see Hyperliquid docs "HyperEVM > Dual-block architecture"); the deployer must exist on HyperCore.
3. **Wallets / gas:** deployer 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39 has 0.06 ETH on Base Sepolia; Arbitrum
   Sepolia and HyperEVM are **unfunded until the user tops them up** — check balances; never block other work on it.
4. **Cross-chain thesis:** the same (asset, strike, expiry) is the same economic event on every chain — the
   canonical key is `SYMBOL:strike:expiry` (see `canonicalMarketKey` in montions-app/src/chains/types.ts). Use the
   SAME strike grids and expiry schedule on every chain so markets line up; the UI quotes every chain and routes a
   ticket to the best venue. USDC-style 6-decimal collateral everywhere.
5. **UI:** one app, chain picker (Base · Arbitrum · Hyperliquid · Solana) + "Best venue" routing, and two visual
   modes: **Serious** (refined current night look — must feel distinct from the reference video) and **UwU**
   (pastel/sakura, kawaii copy, ORIGINAL anime-girl mascots — never copy existing characters or artwork).
6. **Docs + paper:** a paper on the new cross-chain options design, published on the website (`/paper`), plus
   `/docs`. Honest about what is live vs proposed.
7. **Engines:** Codex is out of credits — Grok (pi) does the jobs until further notice.
8. **SCOPE UPDATE (user, later on 2026-10-11): Hyperliquid is PAUSED.** Ship **Base Sepolia + Arbitrum Sepolia** now (deployer has 0.06 ETH on each). Do not deploy to HyperEVM or spend time on HyperCore code. In the UI show Hyperliquid as a disabled "Soon" chip (not routable); in the paper/docs describe HyperEVM + the HyperCore oracle as planned/in-progress, not live.

Hard rules for every job:
1. Only edit the paths your job owns (listed in the job). Never edit `montions/`, `montions-app/src/chains/types.ts`, or the frozen Solana interface files (`montions-sol/programs/montions/src/{constants,errors,state,events,lib}.rs` and `#[derive(Accounts)]` structs) unless your job explicitly allows it.
2. **Never print, log, echo or commit private keys / keystore passwords.** Pass secrets only through env vars or files to child processes, the way existing scripts do.
3. Never run `git` commands.
4. Do not spend devnet SOL or Base Sepolia ETH unless your job explicitly says so; when it does, print the cost estimate first and stay inside the stated budget.
5. Before you finish, re-run the test commands for everything you touched and paste the summary lines.
6. End with a report: files changed, commands run + results, decisions, open risks. Write it to your output (it is captured to a file).
9. **Known issues (Solana program, from .orchestra/out/sol-review-grok.md — not fixed yet, devnet play money):** (H1) the per-market maker exposure cap ignores inventory, so fills + repeated refresh_quotes can pull more treasury into one market; (H2) no global maker cap — permissionless create_market + refresh_quotes can spread/lock the treasury across many markets; (M3) settle-window print selection (two in-window prints on opposite sides of the strike); (M4) 64-order / 24-seat tables can be filled cheaply (DoS); (M5) permissionless refresh + POST_ONLY skips can leave the maker one-sided. Docs, paper and thesis must list these honestly as known limitations with planned fixes (inventory-aware exposure, global + per-asset caps, keeper-only or rate-limited refresh, larger/paged books, strict first-print settlement).
10. **NAME (user decision): the product is now "Kairo"** (from kairos, "the right moment"). Every user-facing
    string, title, logo wordmark, doc, paper and thesis says Kairo; "Montions" may remain only in repo/dir names,
    already-deployed contract names, and historical notes ("formerly Montions"). New deployments use Kairo names.
11. **Live EVM deployments (verified onchain):** Base Sepolia Book 0xB38658485ed69fA70BDe9aC0989926c33506Ac48,
    Arbitrum Sepolia Book **0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e** (0x635c…070d is its delegatecall
    engine, NOT the Book); 63 series each, vault NAV 1,000,000 tUSDC each. Manifests are in
    montions-base/deployments/{84532,421614}.json; read-only backups in .orchestra/deploy/manifests/. Never
    overwrite a live manifest from a rehearsal (write rehearsal output to deployments/rehearsal/). Prefer the RPC
    https://arbitrum-sepolia-rpc.publicnode.com (the official Arbitrum Sepolia RPC times out often).
    Gas cost reality: one MakerVault.refresh ≈ 0.00007 ETH on Base Sepolia (L1 data fee) — batch and throttle.
12. **New scope (user):** (a) **Stocks/ETFs** ("all the stonks"): no free onchain equity feed exists on these
    testnets (Chainlink equities on Arbitrum Sepolia are Data Streams needing an API key; Pyth equity accounts on
    Solana devnet / Monad mainnet are stale; Hermes needs a key). Use a keeper-reported **KeeperFeed** that
    implements AggregatorV3Interface so the existing ChainlinkOracle + ChainlinkSettlementResolver work unchanged —
    labelled everywhere as "keeper-reported demo oracle", upgradeable to Pyth/Chainlink Streams with an API key.
    (b) **Predictions = both**: polish the price flow AND add **event markets** (yes/no real-world questions) with
    an optimistic resolver (bonded assertion, challenge window, arbitration) — same Book, same YES/NO contracts.
    (c) **Production-ready** UI (no blank screens, error boundaries, order book views, markets explorer).
13. **Git:** the workspace root is now a git repo pushed to https://github.com/argenestel/kairo (branch main).
    Agents still NEVER run git — the main agent commits/pushes. Secrets only in gitignored places (`.env`, `.env.*`,
    `**/.dev/`, `.orchestra/secrets/`); never write a key into any tracked file (docs, configs, tests, logs).
