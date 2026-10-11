# Developers

Kairo (formerly Montions).

Workspace root: `/home/arg/projects/hack/colessolana`. Original Monad Solidity app `montions/` is **read-only**. Do not edit frozen interfaces unless a job says so.

## Repos

| Path | What |
|---|---|
| `montions/` | Original EVM (Monad) Book, vault, Pyth/TWAP resolvers, SDK, bots. Reference only. |
| `montions-base/` | Multi-chain EVM repo (directory name kept). Book + Chainlink on Base/Arbitrum; keeper-reported stock feeds on Base; event resolver deploying; HyperEVM paused. Foundry, `sdk/`, `bots/`. |
| `montions-sol/` | Anchor 0.32.1 program on Solana **devnet**, id `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`. `sdk/`, `keeper/`, `scripts/`. |
| `montions-app/` | React 19 + Vite UI. Talks only to `ChainAdapter` in `src/chains/types.ts` (**frozen**). Adapters: `solana.ts`, `base.ts`, `mock.ts`. |
| `paper/` | This site: paper, docs, figures. |

Normative specs: `montions/docs/SPEC.md` (§4 matching, §14 amendments), `montions-sol/docs/SPEC.md`, `montions/docs/THREAT_MODEL.md`.

## Contracts / program

**EVM (`montions-base/src`)**

- `MontionsBook.sol` — series registry, CLOB, escrow, split/merge, ERC-1155 YES/NO, resolve/redeem. `VOID_GRACE = 2 days`.
- `ChainlinkOracle.sol` + `ChainlinkSettlementResolver.sol` — first-round record with round-id hint.
- `PythOracle.sol` + `PythSettlementResolver.sol` — pull-path first print (300 s window).
- HyperCore oracle/windowed settlement is planned/in-progress and **PAUSED**; no live deployment or complete stack is claimed.
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
- EVM: `montions-base/bots` (`evm-keeper.ts`; legacy aliases remain). Record Chainlink rounds, `Book.resolve`, vault `refresh`.

Price-market record/resolve/refresh instructions are permissionless, but keeper operations affect liveness. Stock prices trust a keeper-reported demo oracle; planned event disputes trust an owner EOA.

## Inspect current deployments

Base v2 and Arbitrum v1 are deployed; do not use stale v1 Base addresses from historical `docs/EVM.md`. [Current addresses and gas/faucets](./chains.md). Hyperliquid is paused. Read-only checks:

```sh
solana program show MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh --url devnet
cd montions-sol
sdk/node_modules/.bin/tsx scripts/status.ts --cluster devnet --rpc https://api.devnet.solana.com
# From workspace root:
cast call 0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659 "seriesCount()(uint256)" --rpc-url https://sepolia.base.org
cast call 0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e "seriesCount()(uint256)" --rpc-url https://arbitrum-sepolia-rpc.publicnode.com
```

Operator deployment tooling is `montions-base/scripts/evm-deploy.sh <chainId>` with a preceding fork rehearsal and gas estimate; this guide does not execute it. Stocks use KeeperFeedHub/AggregatorV3 demo prices (29 tickers on Base); Pyth migration needs an API key and signed-update checks. Event resolver is fork-rehearsed, **deploying** on public testnets.

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

## Release status

As of **2026-10-11 18:36 UTC**: [Kairo website](https://kairo-nu-red.vercel.app) · [GitHub](https://github.com/argenestel/kairo). [Verification](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md) records RPC results and failed Solana reads. [Known limitations](../cross-chain-options.md#known-limitations) must remain visible; source fixes do not prove deployed runtime equivalence.
