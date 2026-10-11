# Chains

Every venue asks the same question — `SYMBOL ≥ STRIKE at EXPIRY?` — under the same first-print rule, with 6-decimal USDC-style collateral. Oracles differ. Status below is **testnet only**.

Canonical key: `SYMBOL:strike:expiry` (see `canonicalMarketKey` in `montions-app/src/chains/types.ts`). Intended strike grids, shared across venues: BTC $500, ETH $25, SOL $1. Expiries snap to a 5-minute unix grid on Solana; EVM venues should use the same schedule so books line up.

![Canonical event across venues](../figures/canonical-events.svg)

| | Base Sepolia | Arbitrum Sepolia | HyperEVM testnet | Solana devnet |
|---|---|---|---|---|
| Chain id | 84532 | 421614 | 998 | n/a (devnet) |
| RPC | `https://sepolia.base.org` | `https://sepolia-rollup.arbitrum.io/rpc` | `https://rpc.hyperliquid-testnet.xyz/evm` | `https://api.devnet.solana.com` |
| Collateral | tUSDC (6 dec) | tUSDC (6 dec) | tUSDC (6 dec) | tUSDC (6 dec, program mint) |
| Oracle | Chainlink | Chainlink | HyperCore `oraclePx` | Pyth PriceUpdateV2 |
| Settlement | First round with `updatedAt ≥ expiry`, proven by predecessor | Same as Base | Permissionless `record()` in `[expiry, expiry+W]` (first caller wins) | First print: `prev_publish_time < T ≤ publish_time`, else sponsored window 60 s |
| Feeds / indices | ETH/USD `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`, BTC/USD `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298`, LINK/USD `0xb113F5A928BCfF189C998ab20d753a47F9dE5A61` (8 dec; Sepolia often 10–20 min) | ETH/USD `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` (~60 s), BTC/USD `0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69` (~30 s), LINK/USD `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298` | Precompile `0x0000000000000000000000000000000000000807`. Testnet perps (verified): SOL index 0, BTC 3, ETH 4. Price = `raw / 10^(6 − szDecimals)` | Sponsored accounts (shard 0): SOL `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`, BTC `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo`, ETH `42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC`, plus BNB/XRP/DOGE in `montions-sol/config/assets.devnet.json`. Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |
| Explorer | [sepolia.basescan.org](https://sepolia.basescan.org) | [sepolia.arbiscan.io](https://sepolia.arbiscan.io) | Community: [purrsec.com](https://purrsec.com) (no official HyperEVM UI; JSON-RPC is the interface) | [explorer.solana.com](https://explorer.solana.com/?cluster=devnet) |
| Program / stack | `montions-base/` (Solidity Book + `ChainlinkSettlementResolver`) | same repo, Chainlink feeds for 421614 | same repo, HyperCore oracle + windowed resolver (in progress) | Anchor program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh` |
| Status (2026-10-11) | Code complete, Foundry tests green; **live Sepolia deploy not assumed** — check `montions-base/deployments/`. Fork rehearsal used a local Anvil fork of Sepolia. | In progress (unfunded deployer until topped up) | In progress. Precompile verified live. Large deploys need HyperEVM **big blocks**. Deployer must exist on HyperCore. | **Live on devnet**: program deployed, markets seeded, keeper running. Pyth does **not** exist on Solana testnet — use devnet. |
| Void grace | 2 days | 2 days | 2 days (EVM Book) | 24 hours |

Gas tokens: ETH on Base/Arbitrum Sepolia, HYPE on HyperEVM (18 dec), SOL on Solana.

Wallet: EVM venues need an injected wallet on the right chain id; Solana uses Wallet Standard (Phantom, Backpack, Solflare, …). The UI holds one adapter per chain; it does not bridge funds for you.
