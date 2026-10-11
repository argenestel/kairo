# Developers

Workspace root: `/home/arg/projects/hack/colessolana`. Original Monad Solidity app `montions/` is **read-only**. Do not edit frozen interfaces unless a job says so.

## Repos

| Path | What |
|---|---|
| `montions/` | Original EVM (Monad) Book, vault, Pyth/TWAP resolvers, SDK, bots. Reference only. |
| `montions-base/` | Multi-chain EVM repo (directory name kept). Book + Chainlink on Base/Arbitrum; HyperCore oracle on HyperEVM. Foundry, `sdk/`, `bots/`. |
| `montions-sol/` | Anchor 0.32.1 program on Solana **devnet**, id `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`. `sdk/`, `keeper/`, `scripts/`. |
| `montions-app/` | React 19 + Vite UI. Talks only to `ChainAdapter` in `src/chains/types.ts` (**frozen**). Adapters: `solana.ts`, `base.ts`, `mock.ts`. |
| `paper/` | This site: paper, docs, figures. |

Normative specs: `montions/docs/SPEC.md` (§4 matching, §14 amendments), `montions-sol/docs/SPEC.md`, `montions/docs/THREAT_MODEL.md`.

## Contracts / program

**EVM (`montions-base/src`)**

- `MontionsBook.sol` — series registry, CLOB, escrow, split/merge, ERC-1155 YES/NO, resolve/redeem. `VOID_GRACE = 2 days`.
- `ChainlinkOracle.sol` + `ChainlinkSettlementResolver.sol` — first-round record with round-id hint.
- `PythOracle.sol` + `PythSettlementResolver.sol` — pull-path first print (300 s window).
- HyperCore oracle + windowed resolver live under `src/oracle/hypercore/` and `src/resolvers/HyperCoreSettlementResolver.sol` when that job lands.
- `Quoter.sol`, `MakerVault.sol`, `TestUSDC.sol` (faucet).

**Solana (`montions-sol/programs/montions`)**

- One `Market` account per `(asset, strike, expiry)` PDA.
- SPL YES/NO mints, vault, seats, 64-order arena.
- Built-in Pyth settlement on sponsored PriceUpdateV2 accounts.
- Protocol maker PDA + `refresh_quotes`.

## SDKs

- EVM: `montions-base/sdk` (viem). `pnpm install --frozen-lockfile && pnpm gen-abis && pnpm test`.
- Solana: `montions-sol/sdk` (`@coral-xyz/anchor` 0.32.1). PDA helpers, `decodeMarket`, `quoteBuy`, `MontionsClient`. `pnpm test` (vitest).

## Keepers

- Solana: `montions-sol/sdk` keeper (`pnpm -C sdk keeper --cluster devnet --dry-run --once`). Creates ladder markets, `refresh_quotes`, resolves in the 60 s window, `maker_sweep`. See `montions-sol/keeper/README.md`.
- EVM: `montions-base/bots` (`base-keeper.ts`, `keeper.ts`). Record Chainlink rounds, `Book.resolve`, vault `refresh`.

Keepers are untrusted. Anyone may record/resolve/refresh.

## How to deploy (do not send txs unless you mean to)

**Solana devnet** (already launched; re-run only if instructed):

```sh
cd montions-sol
# inspect
pnpm -C sdk keeper --cluster devnet --dry-run --once
# operator path (spends devnet SOL)
# bash scripts/devnet-launch.sh --rpc https://api.devnet.solana.com
```

**Base Sepolia**

```sh
cd montions-base
# dry run
forge script script/DeployBase.s.sol:DeployBase --rpc-url https://sepolia.base.org
# live (keystore, never echo the key): scripts/base-deploy.sh
# fork rehearsal: anvil --fork-url https://sepolia.base.org --port 8547
```

**Arbitrum Sepolia / HyperEVM:** same Solidity stack, different oracle constructor args and RPC. HyperEVM needs the deployer on HyperCore and `evmUserModify {usingBigBlocks:true}` before large deploys. Check balances before broadcasting; Arbitrum/HyperEVM deployer may be unfunded.

**UI**

```sh
cd montions-app
pnpm install
pnpm dev    # http://0.0.0.0:5180
pnpm typecheck
```

## Tests worth knowing

- Solana host: `cargo test -p montions`
- Solana LiteSVM: `npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'`
- Solana SDK: `cd montions-sol/sdk && npx vitest run`
- EVM: `cd montions-base && forge test`

## Canonical key (UI)

```ts
canonicalMarketKey(symbol, strike, expiry) // "SOL:120:1730000000"
```

Adapters must use the same strike grid and expiry schedule or routing compares different events.
