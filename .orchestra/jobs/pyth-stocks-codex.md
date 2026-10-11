Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (items 10–12).

# Job: Pyth-verified stock prices + settlement on Base Sepolia and Arbitrum Sepolia (Codex)

The user wants Pyth for stock prices. Facts (verified 2026-10-11): Hermes (https://hermes.pyth.network) requires an API key since the Pyth Core upgrade on 2026-08-26 (`Authorization: Bearer <key>`; public limit 10 req / 10 s / IP); Pyth's sponsored stock accounts on Solana mainnet are weeks stale; Pythnet RPC is 403. The key will be provided as `PYTH_HERMES_API_KEY` in /home/arg/projects/hack/colessolana/montions-base/bots/.env (NEVER print it, never commit it, never put it in logs or browser code). Until it exists, build and test everything against mocks / a recorded fixture.

You own ONLY NEW paths in montions-base: bots/src/pyth-stocks/** (+ tests), script/DeployPythStocks.s.sol, config/pyth-stocks.json, docs/PYTH-STOCKS.md. Read: src/resolvers/PythSettlementResolver.sol + src/oracle/pyth/PythOracle.sol (the original Montions mainnet path: exact first print at/after expiry via parsePriceFeedUpdatesUnique), config/stocks.json (the 29 tickers), the Pyth docs for EVM pull integration, and the Pyth contract addresses on Base Sepolia (0xA2aa501b19aff244D90cc15a4Cf739D2725B5729 — verify) and Arbitrum Sepolia (look up + verify with `cast code`).

Deliver:
1. config/pyth-stocks.json: Pyth feed ids for all 29 tickers (Equity.US.<T>/USD etc.; verify ids via Hermes `/v2/price_feeds?query=` once a key exists, or the Pyth docs/price-feed-ids list now), with session info.
2. bots/src/pyth-stocks/updater.ts: fetches signed updates from Hermes with the key, posts `updatePriceFeeds` to the chain's Pyth contract (pay `getUpdateFee`), during market hours every 15 min + at each stock expiry, batched; gas guard; `--once --dry-run`.
3. bots/src/pyth-stocks/settler.ts: after each stock series expiry, fetch the update for exactly the first print at/after expiry (Hermes `/v2/updates/price/{timestamp}`) and call the resolver path used by PythSettlementResolver so the Book resolves trustlessly.
4. script/DeployPythStocks.s.sol: deploy PythOracle + PythSettlementResolver against the chain's Pyth contract, allow the resolver on the (new, post-evm-ship2) Book, register the 29 stocks — rehearsal on anvil forks by default; live mode behind an explicit env flag + balance check (do NOT broadcast live; the manager/main decides).
5. Tests (forge with a MockPyth; bots unit tests with recorded Hermes fixtures) all green; full `forge test` green (skip nothing that was green before).
6. docs/PYTH-STOCKS.md: how the keeper-reported KeeperFeed path is replaced by Pyth (migration plan for live stock series), costs, commands.
