# Demo script — 2 minutes 30 seconds

Kairo (formerly Montions).

Kairo · testnet play money · 11 October 2026  
Both visual modes. If UwU art is not ready, run Serious for the trade and a 10-second UwU toggle at 2:05.

**On-screen always:** a `Testnet — play money` chip. Never say mainnet.

---

## Shot list

| t | Shot | Mode | On screen |
|---|---|---|---|
| 0:00–0:12 | Title card → app, phone-width | Serious | Tagline *say it, print it, place it* |
| 0:12–0:22 | Chain picker | Serious | Base · Arbitrum · **Hyperliquid Soon** (disabled) · Solana **reported deployed** |
| 0:22–0:48 | Ticket flow: asset → direction | Serious | SOL, spot, Above |
| 0:48–1:10 | Strike → expiry → amount | Serious | $120, Friday, $100. “You can never lose more than you put in.” |
| 1:10–1:32 | Printed ticket | Serious | Sentence, 41¢, contracts, payout, oracle name, Print |
| 1:32–1:52 | Wallet confirm → explorer | Serious | Tx on Solana devnet (or Base if that Book is public) |
| 1:52–2:05 | Positions / claim line | Serious | Max loss = premium; void = 50/50 |
| 2:05–2:22 | Toggle **UwU** | UwU | Same ticket, pastel/sakura, original mascot only |
| 2:22–2:30 | Close card | Serious | First print. Dollars local. CSN not built. |

If Solana faucet is slow, cut to a pre-recorded confirm at 1:32 and say so in one clause.

---

## Timed lines

**0:00–0:12 — cold open**  
Options are the right product, sold through the wrong interface, on the wrong venue. This is Kairo. Testnet. Play money.

**0:12–0:22 — where it lives**  
Users already sit on more than one chain. We list the *same* event everywhere and keep the dollars on that chain. Hyperliquid is Soon — not live. Solana devnet is reported deployed; fresh RPC verification was unavailable. This demo uses it only when a current quote is available.

**0:22–0:48 — the sentence**  
I think SOL will be above one-twenty by Friday. I’ll risk a hundred dollars. That’s the whole order. No strike chain. No greeks.

*[Click SOL → Above. Show the live price.]*

**0:48–1:10 — constraints**  
Strike on the grid. Friday expiry. A hundred dollars in. The screen says you cannot lose more than you put in. That’s because every contract is fully collateralised — there’s no liquidation engine.

**1:10–1:32 — the ticket**  
The app prints a ticket: two-hundred-and-forty-three YES at forty-one cents, pays two-forty-three if I’m right. Chance here is the model, not a promise. The price is the book.

*[If the live quote differs, read the numbers on screen. Never fake 41¢.]*

**1:32–1:52 — onchain**  
Confirm in the wallet. Matching is inside the program — no backend. *[Open explorer.]* That’s the fill.

**1:52–2:05 — settlement in one breath**  
Price settlement uses Pyth on Solana and Chainlink on Base and Arbitrum. Solana has a window fallback that allows print selection; strict first-print is a planned fix. Without a valid result, the void path pays fifty-fifty.

**2:05–2:22 — UwU**  
Same ticket, other skin. This is for people who will screenshot a slip, not a depth chart. Original mascots only. The numbers do not get cute.

*[Toggle UwU. If mascots missing: “Mode is a toggle; art is still landing. The book is the same.”]*

**2:22–2:30 — close**  
Say it, print it, settle the first print. Multi-chain without bridging the ticket. Surplus netting is in the paper — not in this demo. Thanks.

---

## B-roll / cutaways (optional, under the lines)

- 0:15: USDC-by-chain table from the thesis (Base, Arbitrum, Solana highlighted).
- 1:20: Close-up of the paper ticket (sentence + QR).
- 1:40: Explorer, program id `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`.
- 2:00: One line from the paper: “nothing cross-chain is ever under-collateralised.”

---

## Failover

| Problem | Do |
|---|---|
| No public EVM Book | Stay on Solana. Say “Base and Arbitrum Books are deployed; RPC/quotes are unavailable right now.” |
| Empty book | Show the quote as untradable. “We don’t bridge to fake depth.” Optionally create-market on Solana in the same tx. |
| Wallet reject | Keep the printed ticket; “the sentence compiled; the user declined.” |
| UwU not shipped | 2:05–2:15: show the mode only if it works; say browser verification is pending. Do not paste someone else’s anime. |

## What not to say

Mainnet. Audited. “Unified liquidity.” Hyperliquid is live. Tweet view counts. “Revolutionary.” APY on the vault. “We’re like Kalshi.”

Snapshot as of **2026-10-11 18:36 UTC**: Base v2 / Arbitrum v1 deployed, 150 / 81 registered series. Solana reported 28 seeded markets; current count/keeper unverified. Stocks: 29 Base demo-oracle tickers. Events deploying. [Website](https://kairo-nu-red.vercel.app) · [Evidence](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md) · [Limitations](../cross-chain-options.md#known-limitations). Read live screen values; do not narrate historical counts or imply a browser E2E pass.
