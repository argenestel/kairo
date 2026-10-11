# User guide

Testnet only. Tokens here are play money. Nothing is audited for mainnet. Binary options may be restricted where you live.

## 0. What you need

- The Montions app (`montions-app/`, Vite on port 5180 in dev).
- A wallet on the chain you want to trade.
- A little **gas** plus **tUSDC** from the in-protocol faucet.

Pick a chain in the UI (Base · Arbitrum · Hyperliquid · Solana) or use **best venue** once several books are live. Solana devnet is the venue that has been deployed and seeded; EVM venues depend on deploy status ([chains](./chains.md)).

## 1. Get testnet gas

**Solana devnet**

1. Install [Phantom](https://phantom.app/), Backpack, or Solflare.
2. Switch the wallet to **Devnet**.
3. Request SOL: [faucet.solana.com](https://faucet.solana.com) (or the CLI `solana airdrop 1` against `https://api.devnet.solana.com`).
4. You need a fraction of a SOL for fees and ATAs.

**Base Sepolia (84532)**

1. MetaMask / Rabby / Coinbase Wallet. Add Base Sepolia if needed (RPC `https://sepolia.base.org`).
2. Test ETH: [Base faucets](https://docs.base.org/chain/network-faucets) (Alchemy, Coinbase, …).
3. Circle’s faucet can mint test USDC; Montions still uses **protocol tUSDC**, not Circle’s USDC, on testnet.

**Arbitrum Sepolia (421614)**

1. Add Arbitrum Sepolia (RPC `https://sepolia-rollup.arbitrum.io/rpc`).
2. Test ETH: Alchemy / QuickNode Arbitrum Sepolia faucets.
3. The deployer wallet may be unfunded; if the Book is not deployed yet, the adapter will not be tradable.

**HyperEVM testnet (998)**

1. Add network: RPC `https://rpc.hyperliquid-testnet.xyz/evm`, chain id 998, symbol HYPE (18 decimals).
2. You need HYPE on **HyperCore** first, then send it to `0x2222222222222222222222222222222222` to move it to HyperEVM ([Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm)).
3. There is no official EVM UI; [purrsec.com](https://purrsec.com) is a community explorer.

## 2. Faucet tUSDC

In the app, connect the wallet and hit **Faucet**. That calls the onchain faucet (rate-limited).

- Solana: `faucet` on program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh` mints tUSDC to your ATA.
- EVM: `TestUSDC.faucet()` — 10,000 tUSDC per address per hour (once the contracts are deployed).

If the button fails, the chain adapter is not pointed at a live deployment.

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

Wait until expiry. A keeper should record the oracle and resolve within seconds to a minute. You can also wait.

- **Resolved, you won:** Claim. Each winning contract pays $1 tUSDC.
- **Resolved, you lost:** Claim burns the tokens for $0 (or just leave them).
- **Void:** Claim pays 50¢ per token (YES and NO).

On Solana, `redeem` burns SPL YES/NO and pays the vault. On EVM, `redeem` credits Book cash; then `withdraw` if you want tokens in the wallet.

If the market is still Open after `VOID_GRACE` (24 h Solana, 2 days EVM), anyone can void it.

## 5. Selling before expiry

Use **sell** in the UI to hit bids on the same book. You need a bid. Illiquid strikes may have no bid; then you wait or hold to settlement. There is no cross-chain exit yet.
