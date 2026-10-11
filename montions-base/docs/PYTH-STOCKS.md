# Kairo Pyth stock prices and settlement

This integration is built for Base Sepolia (84532) and Arbitrum Sepolia (421614). It has **not been deployed or broadcast**. The existing stock series remain keeper-reported demo oracle markets. The Hermes API key is absent as of this rehearsal, so authenticated signed-payload compatibility and equity entitlements remain release gates.

## Verified catalog and contracts (2026-10-11)

`config/pyth-stocks.json` records all 29 exact `Equity.US.<ticker>/USD` feeds from the [official Hermes metadata endpoint](https://hermes.pyth.network/v2/price_feeds?query=). This metadata request succeeded without a key; signed updates returned HTTP 401. The recorded metadata is in `bots/src/pyth-stocks/fixtures/metadata.json`. Feed IDs are never guessed, derived from ticker hashes, or replaced with tokenized-stock/index feeds. Asset IDs remain `keccak256(bytes(ticker))` for existing cross-chain economic keys.

The [official upgrade contract table](https://docs.pyth.network/price-feeds/core/upgrade/contracts) lists these **Core**, rather than Pro, addresses:

| Chain | Upgraded Pyth Core | Read-only verification |
| --- | --- | --- |
| Base Sepolia | `0x5f52e4DBEA21f5b23523B6e20d50c29ae0a4EB83` | `cast code`: 177 bytes; `getUpdateFee([])`: 0 |
| Arbitrum Sepolia | `0x0B73614636C855Bf23F342F307FB981A3e47f42B` | `cast code`: 177 bytes; `getUpdateFee([])`: 0 |

The supplied historical Base address `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` also has code (680 bytes). Code alone does not establish current Hermes payload compatibility. The config retains it as `legacyPyth`; the deployment and keepers use upgraded Core. Empty unique-parser calls on both upgraded contracts reverted with `0x45805f5d` (`PriceFeedNotFoundWithinRange()`), providing an interface smoke check, **not signature verification**. Recheck contract generations and feed entitlement with a real signed update before release.

## Price and settlement behavior

The updater fetches a single signed batch for all due feeds and posts `updatePriceFeeds` with exactly `getUpdateFee(updateData)` ([EVM pull integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/evm)). It polls the Book every 10 seconds, posts every 900 seconds during the feed's regular session, and also selects each asset when a series expiry is observed, even outside the session. Expiry detection can lag by one poll; the settlement job handles the historical print independently. Successful submission marks that expiry handled for the updater process. A restart can repeat an update, while settlement is idempotent onchain.

Schedules come from Hermes metadata, refreshed daily. The parser uses `America/New_York` rather than a fixed UTC hour, including supplied holiday and half-day exceptions. Normal trading is 09:30–16:00 ET: 13:30–20:00 UTC in daylight time and 14:30–21:00 UTC in winter. A 15-minute heartbeat with `maxAge=1800` leaves headroom during sessions; feeds become unhealthy after sessions instead of pretending a Friday close is a live weekend price. Static operator volatility is inherited from the stock catalog and floored at 20%, because `PythOracle.setFeed` rejects lower values. It is not Pyth-measured volatility.

For each expired open Pyth series, the settler groups by `(assetId, expiry)`. It requests `/v2/updates/price/{expiry}` with the **original expiry** on every attempt. [Hermes timestamp semantics](https://docs.pyth.network/api-reference/pyth-core/hermes/timestamp_price_updates) return the first update at or after that timestamp. The bot checks feed ID, positive price, exponent, confidence ≤2%, and publish time in inclusive `[expiry, expiry+300]`; these parsed fields are preflight hints. The authoritative signature and first-print checks happen in `PythSettlementResolver.settle` via `parsePriceFeedUpdatesUnique`. A later update, latest price, last pre-expiry close, or alternate oracle cannot replace that print.

One settlement serves every strike and direction for that stock/expiry. After its receipt succeeds, the bot checks the stored validity and calls `Book.resolve` for each series. Existing settlements skip Hermes and fee payment. HTTP 404 and 429 are deferred and retried by the next polling pass; authentication, malformed prices, simulation and other failures stop the process with a sanitized error. Run under a service supervisor to retry transport failures. Requests are serialized at ≥2.2 seconds apart per process, reserving half of the public 10 requests / 10 seconds / IP ceiling for its sibling. Two processes fit that ceiling; additional instances sharing the IP need a coordinated limiter.

If no qualifying print exists within 300 seconds, the series remains not ready. The Book's normal two-day `VOID_GRACE` applies; an operator or existing keeper can then call `Book.resolve` to void and redeem under the existing rules. This settler does not invent a replacement print or automatically void unavailable feeds. In particular, a market-close expiry can fall after the last equity print: validate historical closing behavior with an entitled key on both chains before retaining close-time expiries. Agree any changed expiry schedule across both chains; do not silently shift only one venue.

## Secrets and costs

Put `PYTH_HERMES_API_KEY` in `bots/.env` on the server, or inject it into the process environment. Node loads that file without printing it; the key is sent only as `Authorization: Bearer …` to the fixed HTTPS Hermes host, with redirects disabled. Never copy it into config, fixtures, browser code, commands, logs, or a deployment manifest. RPC and transport failures are not dumped with their request headers. No new dependency is required.

Pyth's fee is quoted for each payload. Total ETH cost is **Pyth fee + execution gas + rollup L1 data fee**; do not assume a fixed nominal fee. Base uses the gas oracle upper bound; Arbitrum's gas estimate includes its L1 component. The existing cumulative EVM guard is retained, plus a stock-specific check including payable Pyth fees. Defaults: maximum RPC gas price 1 gwei, stock keeper budget 0.001 ETH per process, and 0.005 ETH remaining reserve. Configure `PYTH_MAX_GAS_PRICE_WEI`, `PYTH_KEEPER_BUDGET_WEI`, `PYTH_MIN_RESERVE_WEI`, and the existing `EVM_BUDGET_WEI`/`EVM_START_BALANCE_WEI`. The existing EVM cap still applies. `SKIP_SPEND_GUARD` is rejected. Set a stable start balance across restarts if you need a campaign-wide cumulative cap; the default is not a durable daily budget. Concurrent signers/bot instances need an external shared budget and nonce coordinator.

Each live write prints its cost upper bound, checks balance/reserve, and requires `ALLOW_LIVE_PYTH_STOCKS=1`. `--dry-run` does not require a signer and prints intended transactions and Pyth fees without sending them; it is not a gas simulation of a nonexistent settlement. No live write was performed in this job. Measure authenticated batches in anvil before choosing operating budgets. At 26 regular 15-minute slots per trading session per chain, batching prevents 29 separate heartbeat transactions. Settlement still requires one transaction per stock/expiry plus Book resolution transactions per series.

## Commands

Run from the repo root unless a command uses `pnpm --dir bots`. The offline binary below is **synthetic**, deliberately not a valid signature. Only the metadata fixture was recorded from live Hermes. These commands work with no key, wallet or RPC:

```sh
pnpm --dir bots exec tsx src/pyth-stocks/updater.ts --once --dry-run --fixture src/pyth-stocks/fixtures/update.mock.json
pnpm --dir bots exec tsx src/pyth-stocks/settler.ts --once --dry-run --fixture src/pyth-stocks/fixtures/update.mock.json
pnpm --dir bots typecheck
pnpm --dir bots test
FOUNDRY_TEST=bots/src/pyth-stocks/solidity-tests forge test
forge test
```

`PYTH_FIXTURE_EXPIRY` optionally selects the timestamp window in offline mode; otherwise the fixture's first publish time is used. Offline output explicitly says `signatureVerified=false`.

Once the key exists, record the signed bootstrap file without putting the key on the command line. The command verifies all IDs against authenticated metadata, fetches all 29 feeds, and creates a file exclusively (it refuses overwrite):

```sh
pnpm --dir bots exec tsx src/pyth-stocks/bootstrap.ts --out ../config/pyth-stocks-bootstrap.json
```

PythOracle requires `priceFeedExists` before registration, so this signed bootstrap is needed for any missing feeds. Closed-session prices may initialize the catalog but are still subject to quoting freshness. Keep bootstrap files under `config/` for Foundry read permission. They contain public signed payloads, not the API key; create no fixture until you can honestly record a real response.

For a manager-owned post-evm-ship2 Book, set `PYTH_BOOK` and `PYTH_OWNER` in the environment. No default Book or live manifest fallback is used. The script rejects the older CONTEXT item 11 Books and checks actual Book code and owner. The default mode selects an isolated fork and uses a prank, without `startBroadcast` or manifest writes:

```sh
# Optional local anvil fork; deploy the new Book on that local fork first.
anvil --fork-url https://sepolia.base.org --chain-id 84532
# In another terminal, with PYTH_BOOK and PYTH_OWNER set:
PYTH_CHAIN_ID=84532 PYTH_RPC_URL=http://127.0.0.1:8545 PYTH_BOOTSTRAP_FILE=config/pyth-stocks-bootstrap.json \
  forge script script/DeployPythStocks.s.sol:DeployPythStocks --rpc-url http://127.0.0.1:8545
# Same default rehearsal against Arbitrum, with its new Book:
PYTH_CHAIN_ID=421614 PYTH_BOOTSTRAP_FILE=config/pyth-stocks-bootstrap.json \
  forge script script/DeployPythStocks.s.sol:DeployPythStocks
```

**Do not add `--broadcast` for this job.** Live preparation is for the manager only: `ALLOW_LIVE_PYTH_STOCKS=1`, the matching chain RPC and signer/owner, explicit positive `PYTH_DEPLOY_BUDGET_WEI` and `PYTH_MIN_RESERVE_WEI`, and sufficient balance for both. The balance check is a preparation gate, not an enforced transaction bundle spending cap: the manager must review Forge's complete gas/L1 estimates before choosing to broadcast. Deployment output gives the two adapter addresses and registers all 29 symbols. It does not create markets or move collateral.

Add `pythStocksOracle` and `pythStocksResolver` to the manager-controlled **new Book deployment manifest** for each chain, alongside its existing `book`. Keep rehearsal manifests under `deployments/rehearsal/`; this job's script writes none. Existing bot deployment parsing supports these additional addresses. Then:

```sh
DEPLOYMENT=deployments/rehearsal/84532.json RPC_URL=http://127.0.0.1:8545 \
  pnpm --dir bots exec tsx src/pyth-stocks/updater.ts --once --dry-run
DEPLOYMENT=deployments/rehearsal/84532.json RPC_URL=http://127.0.0.1:8545 \
  pnpm --dir bots exec tsx src/pyth-stocks/settler.ts --once --dry-run
```

Use the 421614 manifest/RPC for Arbitrum. Dry runs still read the Book and adapter bindings and need authenticated Hermes, except `--fixture`. Actual sending additionally needs an existing bot signer through the normal runtime and the live flag; do not run two processes concurrently using an unlocked signer without nonce coordination.

## Migration of live KeeperFeed series

1. Leave every existing series and its keeper-reported oracle active through settlement/redemption. The Book's resolver/data fields are fixed at creation; replacing an old feed after tickets trade changes the promised event and is not a safe migration.
2. Rehearse signed bootstrap, fresh quoting, first-print proofs and invalid/no-print behavior on both upgraded Core contracts. Check equity entitlement, historical retention, closing prints, confidence and session coverage before accepting tickets.
3. The manager deploys the adapter/resolver on the new Book, allows the resolver, and records addresses in the correct live manifests after reviewing gas costs. Keep crypto Chainlink and event resolver routes intact.
4. Seed **future** stock series with the new resolver and data `abi.encode(pythStocksOracle, keccak256(bytes(symbol)), strikeWad, above, uint32(300))`. Preserve identical symbols, strike grids and agreed expiries across both chains. Same ticker IDs are safe because the new series point to a distinct oracle/resolver. The economic key remains `SYMBOL:strike:expiry`.
5. Route quote reads to the PythOracle in each new series. Update manager-owned vault asset trust/quote routes and UI adapter metadata as needed; these files are outside this job. Label old series "keeper-reported demo oracle" and new series "Pyth-verified" only after their deployment and signed checks succeed.
6. Run the new updater/settler, keep the old stock feeder/keeper alive for old open series, and monitor freshness and missed windows. Retire KeeperFeed only when no dependent series remains. Do not globally swap its underlying feed or relabel historical tickets.

## Verification and remaining limits

The original full Forge baseline had 366 passing tests, zero failures and zero skips. New tests live under the owned `bots/src/pyth-stocks/solidity-tests/` path, so run their explicit `FOUNDRY_TEST` command as well as unfiltered `forge test`. They deploy the new adapter stack, register all 29 stocks using MockPyth, reject later-print selection and resolve both sides of a threshold on the real Book. Fork test commands exercise that same mock proof on each target domain; they do not authenticate Hermes signatures:

```sh
FOUNDRY_TEST=bots/src/pyth-stocks/solidity-tests forge test --fork-url https://sepolia.base.org
FOUNDRY_TEST=bots/src/pyth-stocks/solidity-tests forge test --fork-url https://arbitrum-sepolia-rpc.publicnode.com
forge fmt --check script/DeployPythStocks.s.sol bots/src/pyth-stocks/solidity-tests/PythStocks.t.sol
```

Remaining release risks: absent API key/entitlements, no real signed fixture, unverified signed-payload acceptance, market-close first-print availability, historical retention, manual new-Book manifest/series/UI/vault cutover, shared signer/budget coordination, and static rather than measured volatility. No core contract, existing bot, live manifest or original project was modified.

Verified results for this job: unfiltered Forge 366 passed / 0 failed / 0 skipped; new MockPyth Forge 2 passed / 0 failed / 0 skipped, also 2 passed on each chain fork; bot suite 94 passed across 10 files; TypeScript typecheck and scoped Forge formatting passed. Both offline CLI modes completed with `signatureVerified=false`. Forge build/static analysis retains the existing unreachable engine return warning and existing repository lint notices.
