# Chains

Kairo (formerly Montions).

As of **2026-10-11 18:36 UTC**. [Website](https://kairo-nu-red.vercel.app) · [GitHub](https://github.com/argenestel/kairo) · [Verification record](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md).

All current venues use testnet tUSDC, not real USDC. Chainlink settles crypto price markets on EVM (2-day void grace); Solana uses Pyth (24-hour void grace). Oracle timing differs, and identical canonical keys are required for routing.

## Base Sepolia (84532), v2

**LIVE Book deployment**, 150 registered series as of 2026-10-11 18:36 UTC.

| Contract | Current address |
|---|---|
| book | [`0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659`](https://sepolia.basescan.org/address/0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659) |
| bookEngine | [`0xf9F2baf910f3F068143C3D5184dc335Bd4eb8A90`](https://sepolia.basescan.org/address/0xf9F2baf910f3F068143C3D5184dc335Bd4eb8A90) |
| chainlinkOracle | [`0x7176742E0b1E4A3A082D8CcfFC545A447e28C448`](https://sepolia.basescan.org/address/0x7176742E0b1E4A3A082D8CcfFC545A447e28C448) |
| chainlinkResolver | [`0x8A513FA3A89db98504D74078008d0937EA5F8A24`](https://sepolia.basescan.org/address/0x8A513FA3A89db98504D74078008d0937EA5F8A24) |
| collateral | [`0xE0604f8dBbd1ee282BFc1642A19eE2a83Cc4B941`](https://sepolia.basescan.org/address/0xE0604f8dBbd1ee282BFc1642A19eE2a83Cc4B941) |
| quoter | [`0xbA78198A6F1f0b2fbBA6fD0A7E48A0f318BD8709`](https://sepolia.basescan.org/address/0xbA78198A6F1f0b2fbBA6fD0A7E48A0f318BD8709) |
| vault | [`0xadd675E7Eb9bbC2E89dA795E2fe11F9cc9Ab7aFc`](https://sepolia.basescan.org/address/0xadd675E7Eb9bbC2E89dA795E2fe11F9cc9Ab7aFc) |
| keeperFeedHub | [`0xF4fDe98f037d8889c8e1a6C1C66f558a9091F6fC`](https://sepolia.basescan.org/address/0xF4fDe98f037d8889c8e1a6C1C66f558a9091F6fC) |

## Arbitrum Sepolia (421614), v1

**LIVE Book deployment**, 81 registered series as of 2026-10-11 18:36 UTC.

| Contract | Current address |
|---|---|
| book | [`0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e`](https://sepolia.arbiscan.io/address/0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e) |
| bookEngine | [`0x635c6981Ec028Bbde45603B52d50B0f9f89e070d`](https://sepolia.arbiscan.io/address/0x635c6981Ec028Bbde45603B52d50B0f9f89e070d) |
| chainlinkOracle | [`0xAE3Bc21Cf5A4bF961DbBeC69066A937b88e2704B`](https://sepolia.arbiscan.io/address/0xAE3Bc21Cf5A4bF961DbBeC69066A937b88e2704B) |
| chainlinkResolver | [`0xc907f4FEF8782d87f17D4CC181A3f0AE267735A3`](https://sepolia.arbiscan.io/address/0xc907f4FEF8782d87f17D4CC181A3f0AE267735A3) |
| collateral | [`0x844EAC441D9c70Dc6745Ca1a41643995B7B04612`](https://sepolia.arbiscan.io/address/0x844EAC441D9c70Dc6745Ca1a41643995B7B04612) |
| quoter | [`0x4094e4CC956d989580233034b6B898db4aE6b78e`](https://sepolia.arbiscan.io/address/0x4094e4CC956d989580233034b6B898db4aE6b78e) |
| vault | [`0x6EBFA2426f1ae0Bfd87fDFAFde093C1E583f457A`](https://sepolia.arbiscan.io/address/0x6EBFA2426f1ae0Bfd87fDFAFde093C1E583f457A) |

## Solana devnet

**Reported live on devnet** — 28 seeded markets and keeper running per manager; fresh program/market reads failed (public RPC 429 / CLI transport error). Current market count and keeper liveness are not independently confirmed.

[Program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`](https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet). Pyth PriceUpdateV2 settlement; SPL outcome tokens; 24h void grace. Pyth sponsored-window fallback permits print selection; see [limitations](../cross-chain-options.md#known-limitations).

## Stocks and events

Base v2 includes **29 stock/ETF tickers** backed by a **keeper-reported demo oracle**, with a deployed KeeperFeedHub. Manifest `oracle: chainlink` describes AggregatorV3 compatibility, not Chainlink equity data. The Pyth equity migration path is built but API-key gated and unverified with signed live updates. Arbitrum’s current manifest contains three crypto assets, not 29 stocks.

Event markets: **deploying**. Optimistic resolver built and fork-tested; neither current manifest has a live event resolver. Testnet disputes trust an owner EOA.

## Wallets, gas and faucets

- **Solana devnet:** Phantom/Solflare on Devnet or the app’s **Devnet burner**. [Solana faucet](https://faucet.solana.com/) supplies devnet SOL; the app Faucet attempts a 1 SOL airdrop when gas is low, then mints protocol tUSDC (cooldown read from Config). Rate limits may require waiting and retrying. Existing trades need fees/ATAs; the app budgets about 0.05 SOL for creating a missing market, or 0.007 SOL otherwise. These are UI estimates, not guaranteed costs.
- **Base Sepolia:** chain id **84532**, RPC `https://sepolia.base.org`, gas **ETH**. Use the [Base testnet funding guide](https://docs.base.org/get-started/get-funds), then the in-app protocol tUSDC Faucet.
- **Arbitrum Sepolia:** chain id **421614**, RPC `https://arbitrum-sepolia-rpc.publicnode.com` (fallback `https://sepolia-rollup.arbitrum.io/rpc`), gas **ETH**. Use the [Arbitrum testnet faucet guide](https://docs.arbitrum.io/chain-info#testnet-faucets), then the in-app protocol tUSDC Faucet.
- **EVM collateral:** each current deployment has its own 6-decimal TestUSDC address above. `faucet()` mints **10,000 tUSDC once per address per hour**. Circle faucet USDC is a different token and cannot fund these Books. Connect an injected EVM wallet (e.g. MetaMask/Rabby) on the selected chain.
- **Hyperliquid:** **PAUSED / Soon**; no trading or funding instructions while paused. HyperEVM/HyperCore are planned, not a deployed Kairo venue.

Funds stay on the selected chain; Kairo does not bridge gas or collateral. Quotes can be unavailable despite deployed bytecode.

## Known limitations

See [paper §9](../cross-chain-options.md#known-limitations) for unresolved Solana maker caps, print selection, capacity DoS and one-sided quoting, plus EVM runtime/source-fix differences and operational risks. Counts above are all registered series, not live liquidity. Keeper uptime was not measured.
