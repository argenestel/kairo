Run from `montions-sol` after installing the existing SDK dependencies (`pnpm -C sdk install --frozen-lockfile`). The keeper wallet needs SOL for fees/rent; actions are permissionless. The config admin wallet is only needed for initialization.

```sh
# Inspect without submitting transactions.
pnpm -C sdk keeper --cluster devnet --dry-run --once
# Resolve, sweep, refresh, and roll continuously on the public devnet RPC.
pnpm -C sdk keeper --cluster devnet --rpc https://api.devnet.solana.com \
  --keypair ~/.config/solana/id.json --max-new-markets-per-hour 12 \
  --max-sol-per-day 0.5 --min-sol 0.5
# Settlement/quotes only, no creation.
pnpm -C sdk keeper --cluster devnet --no-create
# Local validator.
pnpm -C sdk keeper --cluster localnet --rpc http://127.0.0.1:8899 --once --no-create
# Operator launch; spends devnet SOL. Deploys only when bytes differ.
bash scripts/devnet-launch.sh --rpc https://api.devnet.solana.com
# Local proof; reads devnet oracles but submits only locally.
anchor build
pnpm -C sdk local-e2e
# Tests and typecheck cover SDK, scripts, keeper.
pnpm -C sdk test
pnpm -C sdk typecheck
```

Logs are newline-delimited JSON. SIGINT/SIGTERM stop scheduling work and wait for in-flight confirmation; a second SIGINT exits immediately. Run one instance per payer/budget file under a supervisor. `--once` exits nonzero on attempted-operation failures. `--dry-run` reads/plans but never signs, sends, or writes budget state.

Settlement polls every `--settle-poll 1000` milliseconds during the 60-second settlement window independently of ladder work. Verified first prints or frozen prints inside the window remain resolvable later. Unresolved markets void after the 24-hour grace. Reads batch up to 100 accounts. RPC and send retries use exponential backoff with jitter; sends reuse the same transaction/blockhash to avoid applying an operation twice. Expired/ambiguous submissions surface as failures for the next idempotent keeper pass. An RPC outage longer than the window can prevent settlement; void is the fallback.

Quotes refresh on ≥1-tick fair moves, fills, or `--refresh-max-age 120` seconds, with `--refresh-min-gap 15` seconds between submissions. The program cancels quotes during its final 600 seconds. The main interval is 5 seconds; discovery is every `--scan-every 60` seconds. A new user market can take that long to discover: reduce the scan interval if the RPC budget permits.

Default ladder: 1 hourly + 3 daily + 3 weekly strikes per asset = 42 markets. Hourly expiries are one hour ahead on the 5-minute grid, daily is tomorrow 16:00 UTC, weekly is next Friday 16:00 UTC. `--hourly`, `--daily`, `--weekly`, `--assets SOL,BTC`, and `--hourly-assets SOL` control coverage. Seed `--strikes 7` gives 126 markets (7 × 3 × 6). Creation is limited by both `--max-new-markets-per-hour` and `--max-sol-per-day`; the default 0.5 SOL/day cannot maintain every hourly market indefinitely. Review `ladder_budget` and seed cost projections before increasing it. Coverage is best effort when caps bind; weekly/daily/hourly is the priority order.

Creation reservations survive restarts in `keeper/.state/budget-<rpc-and-payer-hash>.json`, or `--budget-file PATH`. Failed/ambiguous submissions conservatively consume reservations for 24 hours. Do not delete this file to bypass caps. Persist it in deployments. Rent is currently unreclaimable.

The local proof uses fresh temporary wallets, faucet SOL, six cloned Pyth accounts with publish timestamps patched for quoting and settlement, and a validator snapshot/reset between phases. It temporarily lowers `min_tte` only for a short test market, restores production params, waits for actual expiry, and verifies redeemed collateral and swept maker balances. Temporary private key files are mode 0600; the proof prints public addresses only. The validator is stopped on completion. No program or root test sources are modified.
