# Kairo stocks & ETFs (keeper-reported demo oracle)

There is **no free on-chain equity feed** on Base Sepolia or Arbitrum Sepolia
(Chainlink equities are Data Streams and need an API key; Pyth equity accounts
are stale; Hermes returns 401 without a key). Kairo therefore ships a
**keeper-reported demo oracle**: one `KeeperFeed` per ticker that implements
Chainlink’s `AggregatorV3Interface` (plus the EACAggregatorProxy extras the
settlement resolver reads) so the existing `ChainlinkOracle` +
`ChainlinkSettlementResolver` work unchanged.

Label everywhere: **keeper-reported demo oracle**. This is not a Chainlink
Data Feed and not Pyth.

## Trust model

1. A **trusted keeper** fetches public market data (Yahoo Finance chart API,
   Nasdaq quote API; Stooq is attempted but currently bot-challenged from this
   host) and calls `KeeperFeedHub.push`.
2. Each push writes a new AggregatorV3 round whose `startedAt == updatedAt ==
   block.timestamp` (the on-chain report time). The Wall-Street print time is
   stored as `observedAt` and is **not** what settlement uses.
3. Settlement is the **first round with `updatedAt >= expiry`**, proven by
   `ChainlinkSettlementResolver.record` the same way as ETH/BTC/LINK. Nobody
   picks the round; a wrong hint reverts. If the keeper is silent through
   `settleDelay` (1 h) the series never becomes ready and the Book voids
   50/50 after `VOID_GRACE` (2 days).
4. Sanity rails, not roots of trust: `|Δ| ≤ 25%` per push (owner `forcePush`
   bypasses), `observedAt` not in the future and not older than the last
   observation, unchanged prices skipped unless a 5-minute heartbeat elapsed.
5. Residual trust is the keeper key + the `ChainlinkOracle` owner’s one-time
   `setFeed`. Compromise of the reporter can print any price within 25% of
   the last round (or any price via `forcePush`).

## Round-id encoding

Single phase forever:

```
roundId = (uint80(1) << 64) | aggregatorRoundId     // 1, 2, 3, …
phaseId() == 1
answeredInRound == roundId
getRoundData(unknown) → zeros   // OCR2 empty-round behaviour
```

That is exactly what `ChainlinkSettlementResolver` and the EVM keeper prove
(`getRoundData(R)` and `getRoundData(R - 1)` in the current phase). Genesis
round `(1 << 64) | 1` is recordable (phase 1).

## Catalog

`config/stocks.json` — 29 names from the original demo list:

TSLA AMD MSFT SPY NVDA QQQ MSTR AAPL AMZN META NFLX GOOGL AVGO COIN PLTR
JPM V WMT XOM LLY ORCL BA DIS HOOD UBER IWM GLD TLT IBIT

| Field | Meaning |
|---|---|
| `category` | `stock` / `etf` / `commodity` (GLD) |
| `vol` / `volWad` | 30-trading-day realised vol (Yahoo daily log-returns × √252), as of 2026-10-09 |
| `price` / `priceE8` | last NYSE close Friday 2026-10-09 20:00 UTC (Yahoo, cross-checked Nasdaq) |
| `strikeStep` | ≈ 1–2.5% of spot, round numbers |
| `strikes` | seven strikes centred on ATM |
| `stooq` / `yahoo` / `nasdaqAssetClass` | price-source mapping |

Expiry schedule (equities): **weekdays only, 20:00 UTC** (US close, EDT-aligned).
Horizons: **next Friday close** and **the Friday after**. No weekend expiries.
If that Friday is an NYSE holiday, the previous NYSE session at 20:00 UTC is
used. 20:00 UTC is 16:00 ET under EDT and 15:00 ET under EST — documented
honestly; the catalog follows the job’s 20:00 UTC close, not a DST table.

`ChainlinkOracle` registration uses `settleDelay = 3600`, `maxStaleness = 2
days` (weekend heartbeat keeps last close quotable).

## Commands

Secrets stay in env / keystore. Never print `BOT_PRIVATE_KEY`.

```sh
# unit tests (this job)
forge test --match-path 'test/keeperfeed/*' -vv

# feeder: fetch + print, no chain (safe on a weekend — shows last close)
cd bots && pnpm exec tsx src/stock-feeder.ts --once --dry-run

# feeder tests
cd bots && pnpm exec vitest run test/stock-feeder.test.ts
```

### Rehearsal deploy (anvil fork of Base Sepolia — do NOT broadcast live)

```sh
anvil --fork-url https://sepolia.base.org --port 8551
# another shell:
OWNER=0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39
cast rpc --rpc-url http://127.0.0.1:8551 anvil_impersonateAccount $OWNER
cast rpc --rpc-url http://127.0.0.1:8551 anvil_setBalance $OWNER 0x8AC7230489E80000
mkdir -p deployments/rehearsal
FORK_REHEARSAL=1 CREATE_SERIES=1 \
  forge script script/DeployStocks.s.sol:DeployStocks \
    --rpc-url http://127.0.0.1:8551 --broadcast --unlocked --sender $OWNER --slow
```

Writes `deployments/rehearsal/stocks-<chainId>.json` (never a live manifest).
The script refuses chain 84532 / 421614 unless `FORK_REHEARSAL=1`.

Live push (out of scope for this job — no on-chain spend):

```sh
export KEEPER_FEED_HUB=0x...          # from the rehearsal / a real deploy
export BOT_PRIVATE_KEY=0x...         # reporter
export EVM_MAX_ETH_PER_DAY=0.01
export DEPLOYMENT=deployments/84532.json
pnpm exec tsx src/stock-feeder.ts --once          # from bots/
```

Feeder cadence: every 5 minutes in the NYSE session (09:30–16:00 ET, early
closes at 13:00 ET), a final close print at/after 16:00 ET, nothing on
weekends/holidays except a **daily heartbeat** of the last close. One hub
`push` per tick. Skips a symbol when Yahoo and Nasdaq disagree by more than
1%. `EVM_MAX_ETH_PER_DAY` (default 0.01 ETH) skips the tick once the day’s
spent gas would exceed the cap.

## Gas per push (local forge, Cancun, optimizer 200)

Measured by `testBatchPushGas30`:

| Path | 30 symbols | ≈ per symbol |
|---|---|---|
| First push (cold rounds) | **2,323,050** | ~77k |
| Unchanged, inside heartbeat (skip) | **181,108** | ~6k |
| Heartbeat rewrite (warm + new round slots) | **1,701,220** | ~57k |

On Base Sepolia the L1 data fee dominates (a `MakerVault.refresh` is ~0.00007
ETH). Budget **~0.0002 ETH** per 29-symbol batch as a conservative guard;
the feeder’s default `DEFAULT_PUSH_WEI` is that figure. A full session
(6.5 h × 12 ticks) is on the order of 0.002 ETH/day of L1 fees if every
tick writes — the unchanged-skip and the 0.01 ETH daily cap keep it inside
the deployer budget.

## What changes with a Pyth key

With a Hermes / Pyth API key (or Chainlink Data Streams credentials):

1. Stop the stock feeder. Do not push keeper rounds after cutover.
2. Point quoting/settlement at **Pyth equity price-feed accounts** (or
   Data Streams reports) instead of `KeeperFeed`. `ChainlinkOracle.setFeed`
   is **one-time per asset id**, so the cutover is either new asset ids
   (`keccak256("TSLA-PYTH")` or similar) + new series, or a new oracle
   deployed and allowed on the Book.
3. Settlement becomes Pyth’s first price update at/after expiry (already
   implemented as `PythSettlementResolver` on the Monad path) **or**
   Chainlink Streams’ first verified report. The keeper-reported trust
   assumption goes away; the remaining trust is Pyth/Chainlink.
4. `config/stocks.json` already carries `yahoo` / `stooq` / Pyth `feedId`s
   in the historical `config/stocks-demo.json` for that mapping.
5. User-facing copy drops “keeper-reported demo oracle”.

Until then, every stock series description from
`ChainlinkSettlementResolver.describe` still says *“first Chainlink round
at/after expiry”* because that resolver is frozen by other jobs. The feed’s
own `description()` is `"TSLA / USD (keeper-reported)"`. UI copy should
prefer the feed description.

## Integration needs (files this job does not own)

- `config/chains.json` / seed+keeper ladders: add the 29 tickers with
  `oracle: "keeper"`, `ladder: true`, the strike steps and the Friday
  20:00 UTC expiry rule so Base and Arbitrum list the same
  `SYMBOL:strike:expiry` keys.
- `MakerVault` trusted-asset allowlist: if `trustedAssetCount > 0` on a
  live vault, stock asset ids must be added or the vault will not quote.
- SDK ABIs: generate `keeperFeedHubAbi` (bots currently inline it).
- `ChainlinkSettlementResolver.describe`: optional suffix
  “(keeper-reported demo oracle)” when `feed.description` contains that
  string — currently still says “Chainlink round”.
