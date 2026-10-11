# Kairo on EVM (Chainlink venues)

One Solidity stack, many chains. `montions-base/` is the multi-chain EVM
repo. Every venue lists the same economic events: canonical key
`SYMBOL:strike:expiry` (see `canonicalMarketKey` in the SDK). Strike grids and
the expiry schedule are shared in `config/chains.json`.

| chainId | Name | Oracle | RPC | Status |
|---|---|---|---|---|
| 84532 | Base Sepolia | Chainlink | https://sepolia.base.org | LIVE |
| 421614 | Arbitrum Sepolia | Chainlink | https://sepolia-rollup.arbitrum.io/rpc | LIVE |
| 998 | HyperEVM testnet | HyperCore `oraclePx` precompile | https://rpc.hyperliquid-testnet.xyz/evm | schema only; Hyperliquid is paused |

HyperCore settlement is **not** “first Chainlink round”. The precompile only
exposes the current price, so a permissionless `record()` is accepted only
inside `[expiry, expiry + window]` (first recorder wins). That stack lives in
`src/oracle/hypercore/**` and is out of scope here.

## Architecture (Chainlink chains)

```
TestUSDC (6 dp, faucet)
  └─ MontionsBook ──delegatecall──► MontionsBookEngine
        │
        ├─ ChainlinkSettlementResolver ──► ChainlinkOracle ──► AggregatorV3 proxies
        ├─ Quoter.fair  (digital N(d2) on Chainlink spot + configured vol)
        └─ MakerVault   (quotes the same resolver data layout as Pyth)
```

EIP-170: matching lives in `MontionsBookEngine` so the Book fits Base’s 24 KB
limit. Collateral is 6-decimal tUSDC everywhere.

### Settlement

Price = the **first** Chainlink round with `updatedAt >= expiry`, proven by a
permissionless

```
record(feed, expiry, roundIdHint)
```

which checks `getRoundData(hint).updatedAt >= expiry` and that the previous
round of the **same phase** has `updatedAt < expiry`. Answers must be `> 0`;
8-decimal feeds scale to WAD. `resolve` reads the recorded price. If nothing
valid is recorded within `VOID_GRACE` (2 days) the Book voids 50/50.

A later phase’s first round is unrecordable (no provable predecessor through
the proxy) and follows the void path. If the previous phase aggregator still
has a round with `updatedAt >= expiry`, the proxy was upgraded *after* expiry:
`record` reverts `PhaseChangedAfterExpiry` and the Book voids 50/50 rather than
accepting the new aggregator’s pre-seeded history. A phase upgrade that
happened *before* expiry (previous phase’s last print `< expiry`) is still
recordable on the current phase. Nobody — not the keeper, not the owner —
picks the timestamp or the round.

**Aggregator phase upgrades are a hard fail-closed.** Testnet operators should
treat a Chainlink proxy upgrade during an open series as “this expiry voids”.

`Quoter.fair` and `MakerVault` price these series the same way as the Pyth
path: resolver data is `abi.encode(oracle, assetId, strikeWad, above, maxDelay)`
with `maxDelay == oracle.settleDelayOf(assetId)`.

### Shared market keys

From `config/chains.json`:

- Grids: ETH **$25**, BTC **$500**, LINK **$0.25**, SOL **$1**
- Seven strikes on that absolute grid. The window is centred on
  `floor(spot / (4 × step)) * (4 × step)` (ETH centres on $100) so a few
  dollars of cross-chain basis cannot shift `SYMBOL:strike:expiry`.
- Expiries: tomorrow 16:00 UTC, next Friday 16:00 UTC, last Friday of next
  month 16:00 UTC

Seed and keeper derive `(asset, strike, expiry)` from that file, so Base and
Arbitrum list the same keys for ETH/BTC/LINK. New deploys register **only**
ladder assets. Live Base Sepolia still has extra feeds (cbETH, stables, ratio)
from the first deploy — they are not seeded; a redeployed vault/resolver will
refuse to quote/validate them. Quoting also refuses a Chainlink print older
than two heartbeats (Quoter default 40 minutes) and widens the vault spread
for a 20-minute heartbeat.

## Commands

Secrets stay in the keystore. Never `echo`, `set -x`, or log `BOT_PRIVATE_KEY`.

```sh
export KEYSTORE="${KEYSTORE:-$PWD/../montions/.dev/keystore/montions-testnet}"
export PASSFILE="${PASSFILE:-$PWD/../montions/.dev/testnet.pass}"
export DEPLOYER="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSFILE")"
```

### Estimate + deploy

```sh
# Print gas / L1-fee ceiling and refuse if the deployer is short:
ESTIMATE_ONLY=1 scripts/evm-deploy.sh 84532

# Live Base Sepolia (budget ≤ 0.04 ETH). Requires a successful fork rehearsal.
scripts/evm-deploy.sh 84532

# Live Arbitrum Sepolia (configured budget ≤ 0.03 ETH, job cap 0.04):
scripts/evm-deploy.sh 421614
```

`scripts/evm-deploy.sh` reads RPC, explorer, feeds and budget from
`config/chains.json`, writes `deployments/<chainId>.contracts.json`, builds
`deployments/<chainId>.json`, seeds the 63-market ladder and refreshes vault
quotes. It will not run against oracle `"hypercore"`.

### Fork rehearsal (mandatory before live)

```sh
# Base Sepolia, Anvil :8547
scripts/evm-fork-rehearse.sh 84532

# Arbitrum Sepolia, Anvil :8548
scripts/evm-fork-rehearse.sh 421614
```

Each run: fork → deploy → seed → vault refresh → buy YES and buy NO from vault
quotes → rewind a real Chainlink cursor locally → create a series whose expiry
sits on a real round pair → `record` that successor → resolve → redeem.
Writes **only** `deployments/logs/<chainId>/fork.contracts.json` and
`fork-manifest.json`. It will refuse to overwrite the live
`deployments/<chainId>.json` (opt in with `ALLOW_LIVE_MANIFEST_OVERWRITE=1`).
Report: `deployments/logs/<chainId>/fork-rehearsal.json`.

Manual equivalent:

```sh
anvil --fork-url https://sepolia.base.org --port 8547
# or: anvil --fork-url https://sepolia-rollup.arbitrum.io/rpc --port 8548
```

### Seed / keeper (per chain)

```sh
# Preview the ladder (no signing):
CHAIN_ID=84532 DEPLOYMENT="$PWD/deployments/84532.json" \
  pnpm --dir bots evm-seed -- --dry-run

# One keeper pass / rolling loop. Do not start a long-running process from a job.
(
  export DEPLOYMENT="$PWD/deployments/84532.json"
  export CHAIN_ID=84532
  export BOT_PRIVATE_KEY="$(cast wallet private-key --keystore "$KEYSTORE" --password-file "$PASSFILE")"
  pnpm --dir bots evm-keeper -- --once
  # pnpm --dir bots evm-keeper
)
```

Replace `84532` / `deployments/84532.json` with `421614` for Arbitrum Sepolia.

Useful env: `ONLY_SYMBOLS=ETH,BTC`, `EVM_STRIKE_COUNT=5..7`,
`EVM_REFRESH_LIMIT`, `EVM_REDEEM_LIMIT`, `EVM_KEEPER_CREATE=0`,
`EVM_KEEPER_INTERVAL_MS`, `EVM_BUDGET_WEI`, `SKIP_SPEND_GUARD=1` (forks),
`DRY_RUN=1`. `BASE_*` aliases still work.

### SDK

```ts
import { loadDeployment, chainForId, baseSepolia, arbitrumSepolia,
         parseChainsConfig, canonicalMarketKey } from "@montions/sdk";
import { chainlinkOracleAbi, chainlinkSettlementResolverAbi } from "@montions/sdk/abi";

const d = loadDeployment(84532);          // deployments/84532.json
const chain = chainForId(d.chainId);      // viem chain
```

`loadDeployment` is node-only (`@montions/sdk/deployments`). Browser code should
fetch the JSON and `parseDeployment`.

## Addresses

### Base Sepolia (84532) — archived v1

Explorer: https://sepolia.basescan.org  
Manifest: `deployments/84532.json`  
Start block: see manifest. Deployer `0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39`.  
ETH spent (deploy + 63-market seed + vault refresh): **0.002639449374 ETH** (budget 0.04).

| Contract | Address |
|---|---|
| `MontionsBook` | [`0xB38658485ed69fA70BDe9aC0989926c33506Ac48`](https://sepolia.basescan.org/address/0xB38658485ed69fA70BDe9aC0989926c33506Ac48) |
| `MontionsBookEngine` | [`0xd58853346B47682489F53a514703ADED7157ed59`](https://sepolia.basescan.org/address/0xd58853346B47682489F53a514703ADED7157ed59) |
| `Quoter` | [`0x44e6DaD01Cfe0BbAf390be7ec6bBA2A5be0507Eb`](https://sepolia.basescan.org/address/0x44e6DaD01Cfe0BbAf390be7ec6bBA2A5be0507Eb) |
| `MakerVault` | [`0x194866ea03AC3257e41d7851d00396C2fEe425dF`](https://sepolia.basescan.org/address/0x194866ea03AC3257e41d7851d00396C2fEe425dF) |
| tUSDC | [`0x844EAC441D9c70Dc6745Ca1a41643995B7B04612`](https://sepolia.basescan.org/address/0x844EAC441D9c70Dc6745Ca1a41643995B7B04612) |
| `ChainlinkOracle` | [`0xAE3Bc21Cf5A4bF961DbBeC69066A937b88e2704B`](https://sepolia.basescan.org/address/0xAE3Bc21Cf5A4bF961DbBeC69066A937b88e2704B) |
| `ChainlinkSettlementResolver` | [`0x80989961022FcC8fa91240217605104aE0c8B894`](https://sepolia.basescan.org/address/0x80989961022FcC8fa91240217605104aE0c8B894) |

Sample txs:

- [TestUSDC create](https://sepolia.basescan.org/tx/0x7c82f3b20dacd0744752480f8e26effe9a33dec2c963a3124b70e03a79ae4df4)
- [ChainlinkOracle create](https://sepolia.basescan.org/tx/0x41cc3a573874d760a1feda78ff3777a5f42fd926d606946ce2c1f68d1eefb0b8)
- [MontionsBook create](https://sepolia.basescan.org/tx/0x6a90e1942821ba6fbe3f39bc88e62be71131a5b7533c9d62977571019f3e1689)

Readback: 63 series, 9 registered feeds, vault NAV 1_000_000 tUSDC, executable YES quote on a sample ETH series (fair tick 84, best ask 85).

Feeds (verified onchain): ETH/USD `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`,
BTC/USD `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298`,
LINK/USD `0xb113F5A928BCfF189C998ab20d753a47F9dE5A61`.

Keeper (not started):

```sh
(
  export KEYSTORE="${KEYSTORE:-$PWD/../montions/.dev/keystore/montions-testnet}"
  export PASSFILE="${PASSFILE:-$PWD/../montions/.dev/testnet.pass}"
  export DEPLOYMENT="$PWD/deployments/84532.json"
  export CHAIN_ID=84532
  export BOT_PRIVATE_KEY="$(cast wallet private-key --keystore "$KEYSTORE" --password-file "$PASSFILE")"
  pnpm --dir bots evm-keeper -- --once    # one pass
  # pnpm --dir bots evm-keeper            # 15s loop
)
```

### Arbitrum Sepolia (421614) — archived v1

Explorer: https://sepolia.arbiscan.io  
Manifest: `deployments/421614.json`  
Start block: `318126996` (first live CREATE; forge `block.number` on this RPC recorded 11892827, which is not the L2 height).  
Deployer `0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39`.  
ETH spent (deploy + 63-market seed + vault refresh): **0.012318435558 ETH** (configured budget 0.03; job cap 0.04).

| Contract | Address |
|---|---|
| `MontionsBook` | [`0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e`](https://sepolia.arbiscan.io/address/0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e) |
| `MontionsBookEngine` | [`0x635c6981Ec028Bbde45603B52d50B0f9f89e070d`](https://sepolia.arbiscan.io/address/0x635c6981Ec028Bbde45603B52d50B0f9f89e070d) |
| `Quoter` | [`0x4094e4CC956d989580233034b6B898db4aE6b78e`](https://sepolia.arbiscan.io/address/0x4094e4CC956d989580233034b6B898db4aE6b78e) |
| `MakerVault` | [`0x6EBFA2426f1ae0Bfd87fDFAFde093C1E583f457A`](https://sepolia.arbiscan.io/address/0x6EBFA2426f1ae0Bfd87fDFAFde093C1E583f457A) |
| tUSDC | [`0x844EAC441D9c70Dc6745Ca1a41643995B7B04612`](https://sepolia.arbiscan.io/address/0x844EAC441D9c70Dc6745Ca1a41643995B7B04612) |
| `ChainlinkOracle` | [`0xAE3Bc21Cf5A4bF961DbBeC69066A937b88e2704B`](https://sepolia.arbiscan.io/address/0xAE3Bc21Cf5A4bF961DbBeC69066A937b88e2704B) |
| `ChainlinkSettlementResolver` | [`0xc907f4FEF8782d87f17D4CC181A3f0AE267735A3`](https://sepolia.arbiscan.io/address/0xc907f4FEF8782d87f17D4CC181A3f0AE267735A3) |

Sample txs:

- [TestUSDC create](https://sepolia.arbiscan.io/tx/0x0c683a22d27194740029abe4814395e0b1a8ba54f10c81214ce72869f1347f24)
- [ChainlinkOracle create](https://sepolia.arbiscan.io/tx/0xf4fac435d142fc587209195214eacb795bf7157b684dfb4ae4087a66eabbd6fc)
- [MontionsBook create](https://sepolia.arbiscan.io/tx/0x44dc8a3998a6da05e10ca134d99fb440847039bfa78878ffe6840b4a6ae27172)

Readback: 63 series, 3 registered feeds, vault NAV 1_000_000 tUSDC, executable YES quote on a sample ETH series (fair tick 85, best ask 87).

Feeds (verified onchain): ETH/USD `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165`,
BTC/USD `0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69`,
LINK/USD `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298`.

Fork rehearsal **passed** (`deployments/logs/421614/fork-rehearsal.json`):

```sh
scripts/evm-fork-rehearse.sh 421614
```

Keeper (not started):

```sh
(
  export KEYSTORE="${KEYSTORE:-$PWD/../montions/.dev/keystore/montions-testnet}"
  export PASSFILE="${PASSFILE:-$PWD/../montions/.dev/testnet.pass}"
  export DEPLOYMENT="$PWD/deployments/421614.json"
  export CHAIN_ID=421614
  export BOT_PRIVATE_KEY="$(cast wallet private-key --keystore "$KEYSTORE" --password-file "$PASSFILE")"
  pnpm --dir bots evm-keeper -- --once    # one pass
  # pnpm --dir bots evm-keeper            # 15s loop
)
```
