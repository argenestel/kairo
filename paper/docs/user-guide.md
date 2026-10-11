# User guide

Kairo (formerly Montions).

Testnet only. Tokens here are play money. Nothing is audited for mainnet. Binary options may be restricted where you live.

## 0. What you need

- [The Kairo app](https://kairo-nu-red.vercel.app).
- A wallet on the chain you want to trade.
- A little **gas** plus **tUSDC** from the in-protocol faucet.

Pick Base Sepolia, Arbitrum Sepolia or Solana devnet, or use **best venue** for identical event keys. Base and Arbitrum Books are deployed; Solana deployment is reported but fresh RPC reads failed. Hyperliquid is **PAUSED / Soon**, disabled and not routable. [Current addresses](./chains.md).

## 1. Get testnet gas

**Solana devnet**

1. Use Phantom/Solflare or choose the built-in **Devnet burner** (testnet only).
2. Switch the wallet to **Devnet**.
3. Request SOL: [faucet.solana.com](https://faucet.solana.com) (or the CLI `solana airdrop 1` against `https://api.devnet.solana.com`).
4. You need a fraction of a SOL for fees and ATAs.

**Base Sepolia (84532)**

1. MetaMask / Rabby / Coinbase Wallet. Add Base Sepolia if needed (RPC `https://sepolia.base.org`).
2. Test ETH: [Base testnet funding guide](https://docs.base.org/get-started/get-funds) (Alchemy, Coinbase, …).
3. Circle’s faucet can mint test USDC; Kairo still uses **protocol tUSDC**, not Circle’s USDC, on testnet.

**Arbitrum Sepolia (421614)**

1. Add Arbitrum Sepolia (RPC `https://sepolia-rollup.arbitrum.io/rpc`).
2. Test ETH: follow the [Arbitrum testnet faucet guide](https://docs.arbitrum.io/chain-info#testnet-faucets).
3. The Book is deployed. You still need ETH on Arbitrum Sepolia in your own wallet; [current addresses](./chains.md).

**Hyperliquid / HyperEVM:** PAUSED; disabled “Soon”. No funding or trading while paused.

## 2. Faucet tUSDC

In the app, connect the wallet and hit **Faucet**. That calls the onchain faucet (rate-limited).

- Solana: `faucet` on program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh` mints tUSDC to your ATA.
- EVM: `TestUSDC.faucet()` — 10,000 tUSDC per address per hour.

If the faucet fails, check network and address, cooldown and gas; public RPC limits may require waiting before retrying.

## 3. Place a ticket

1. Pick an **asset** (SOL, BTC, ETH, …).
2. Pick **above** or **below**.
3. Pick a **strike** on the grid and an **expiry**.
4. Enter a **budget** in dollars (this is your max loss).
5. Read the quote: contracts, average price, payout if right, model “chance”.
6. Confirm in the wallet. On Solana, a missing market may be created in the same transaction as your first buy.

Example: SOL above $120, Friday, $100. If the ask is 41¢ and the book is deep, you buy 243 YES, pay ≈ $100, receive $243 if SOL prints ≥ $120 at expiry.

Slippage: the ticket has a max price. If the book moves, the transaction reverts rather than filling worse.

## 4. After expiry — claim

Wait until expiry. Resolution depends on a valid oracle observation and recording. Solana sponsored feeds can update quickly; Base Chainlink can lag 10–20 minutes, Arbitrum crypto feeds roughly 30–60 seconds historically. Keeper uptime was not verified. These are not guaranteed settlement times.

- **Resolved, you won:** Claim. Each winning contract pays $1 tUSDC.
- **Resolved, you lost:** Claim burns the tokens for $0 (or just leave them).
- **Void:** Claim pays 50¢ per token (YES and NO).

On Solana, `redeem` burns SPL YES/NO and pays the vault. On EVM, `redeem` credits Book cash; then `withdraw` if you want tokens in the wallet.

If the market is still Open after `VOID_GRACE` (24 h Solana, 2 days EVM), anyone can void it.

## 5. Selling before expiry

Use **sell** in the UI to hit bids on the same book. You need a bid. Illiquid strikes may have no bid; then you wait or hold to settlement. There is no cross-chain exit yet.

## Status and limitations

As of **2026-10-11 18:36 UTC**, [Base v2 / Arbitrum v1 addresses](./chains.md) are verified with **150 / 81 total registered series**. Solana’s last manager report says **28 seeded markets**; current count and keeper are unverified because fresh RPC reads failed. [Evidence](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md). Stocks: **29 keeper-reported demo-oracle tickers on Base**, not verified Pyth equity data. Events: **deploying**, optimistic dispute resolution planned with a testnet owner arbitrator.

Known Solana maker cap gaps can overexpose treasury; sponsored-window settlement permits print selection; small books can be filled cheaply, and maker quotes can become one-sided. EVM source fixes are not verified on both live runtimes. Read [known limitations](../cross-chain-options.md#known-limitations). The two-minute flow is a target; faucet limits, missing liquidity and market-creation rent can take longer.
