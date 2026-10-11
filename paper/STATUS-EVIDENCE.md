# Kairo status verification record

Snapshot as of **2026-10-11 18:36 UTC**. Read-only checks; no transactions, funding, deployments or git commands were performed. This timestamp comes from the execution host’s UTC clock and RPC/HTTP observations, rather than the supplied local calendar date.

## Fresh EVM checks

| Chain | RPC | Current Book | `cast code` result | `seriesCount()` |
|---|---|---|---|---|
| Base Sepolia, 84532 | `https://sepolia.base.org` | `0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659` | Nonempty: 20,525 bytes | **150** |
| Arbitrum Sepolia, 421614 | `https://arbitrum-sepolia-rpc.publicnode.com` | `0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e` | Nonempty: 20,525 bytes | **81** |

Commands run for each address/RPC above:

```sh
cast code <book> --rpc-url <rpc>
cast call <book> 'seriesCount()(uint256)' --rpc-url <rpc>
```

The captured code output length was 41,053 characters including `0x` and newline, corresponding to 20,525 bytes. These checks establish deployed bytecode and total series only; they do not attest runtime/source equivalence, open-market counts, liquidity, keeper uptime, wallet trading or settlement success.

Base KeeperFeedHub `0xF4fDe98f037d8889c8e1a6C1C66f558a9091F6fC`: `cast code` via Base RPC returned nonempty code (19,427 output characters including prefix/newline, 9,712 bytes). Base manifest has three crypto assets plus **29 stock/ETF tickers**; `84532.stocks.json` contains 29 feed addresses. These are **keeper-reported demo oracle** feeds. The generic manifest `oracle: chainlink` field means interface compatibility for equities, not authenticated Chainlink equity data. Fresh individual stock prices and equity settlements were not measured.

Neither current manifest includes `eventResolver`; the only event deployment manifest found is under `deployments/rehearsal/`. Accordingly, public event markets are **deploying**, not verified live.

## Solana attempts and verification gap

Required commands were run twice against the public devnet RPC, using the status script’s built-in exponential backoff (0.5, 1, 2, 4, 8 seconds):

```sh
solana program show MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh --url devnet
cd montions-sol
sdk/node_modules/.bin/tsx scripts/status.ts --cluster devnet --rpc https://api.devnet.solana.com
```

- `solana program show`: exit 1, `AccountNotFound` wrapper with **error sending request**. This transport error does not prove the program account is absent.
- `status.ts`: exit 1 after repeated **429 Too Many Requests**, before fetching Config or markets.
- Alternative read-only RPC attempts: PublicNode endpoint returned HTTP 404; dRPC endpoint returned HTTP 400. They did not establish program absence or state.

[Manager context](https://github.com/argenestel/kairo/blob/main/.orchestra/CONTEXT.md), items 1/9/11, and [manager status](https://github.com/argenestel/kairo/blob/main/.orchestra/STATUS.md) report program deployment, **28 seeded markets** and a running keeper on 11 October. We retain these as **reported historical facts**, not fresh confirmation. Current total/open markets, keeper liveness and Pyth settlement transactions remain unverified. [Program explorer](https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet).

## Reports reconciled

- [Current Base manifest](https://github.com/argenestel/kairo/blob/main/montions-base/deployments/84532.json), [Base stocks](https://github.com/argenestel/kairo/blob/main/montions-base/deployments/84532.stocks.json), [current Arbitrum manifest](https://github.com/argenestel/kairo/blob/main/montions-base/deployments/421614.json): authoritative addresses at this snapshot. Base is v2 per the manager’s brief; Arbitrum addresses match the archived v1 deployment.
- [EVM base report](https://github.com/argenestel/kairo/blob/main/.orchestra/out/evm-base-grok.md) and [EVM docs](https://github.com/argenestel/kairo/blob/main/montions-base/docs/EVM.md): historical Base v1 addresses and 63-series deployment snapshots are superseded. The later Arbitrum report confirms its historical deployment, but not current keeper operation.
- [EVM review](https://github.com/argenestel/kairo/blob/main/.orchestra/out/evm-review-grok.md), [source fix report](https://github.com/argenestel/kairo/blob/main/.orchestra/out/evm-fix-grok.md), [keeper gas report](https://github.com/argenestel/kairo/blob/main/.orchestra/out/keeper-gas-grok.md): source fixes are reported for findings 1–6; deployment of those fixes is not proven by bytecode presence. `bots/src/evm-keeper.ts` still throws on a bad spot in `readAssets`; `scripts/evm-deploy.sh` lacks an explicit xtrace-off guard. No claim of a clean security review.
- [Solana review](https://github.com/argenestel/kairo/blob/main/.orchestra/out/sol-review-grok.md): unresolved H1/H2/M3/M4/M5 and additional lower-severity findings. See [paper limitations](cross-chain-options.md#known-limitations).
- [Events report](https://github.com/argenestel/kairo/blob/main/.orchestra/out/events-grok.md): optimistic resolver, 27-question catalog and fork rehearsal; explicitly no live deployment.
- [Pyth stocks report](https://github.com/argenestel/kairo/blob/main/.orchestra/out/pyth-stocks-codex.md): 29 feed IDs and migration tooling built; API key absent, signed-payload acceptance and equity entitlement unverified; no live broadcast. Switching requires a key plus verification and deployment, not just a UI toggle.
- `.orchestra/out/ui-modes-grok.md` and `evm-ship2-grok.md` were **empty**, and `app-e2e-grok.md` was **absent**. No completion claim inferred from these reports. `montions-app/src/copy.ts` contains distinct Serious/UwU packs; the Solana adapter contains Wallet Standard and burner/faucet paths. Source presence is not browser validation.

`curl -I -L --max-time 20 https://kairo-nu-red.vercel.app` returned **HTTP 200** at 18:36 UTC. This proves website reachability only. Published content and wallet trading were not validated. Local paper updates still require the manager’s publish process.
