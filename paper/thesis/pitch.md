# Montions pitch

11 October 2026 · 12 slides · 60-second close at the end  
Long form: [thesis](./thesis.md) · mechanism: [Canonical Events](../cross-chain-options.md)

Style: one headline, three bullets, speaker notes. No “revolutionary.” Numbers retrieved 11 Oct 2026.

---

## Slide 1 — Title

**Headline:** Options are the right product, sold through the wrong interface, on the wrong venue.

- A ticket, not a strike chain: “I think SOL will be above $120 by Friday with $100.”
- Fully onchain CLOB. 100% collateral. First-print settlement.
- Testnet. Unaudited. Hyperliquid paused. Mainnet not live.

**Notes:** Open on the original thesis line and stay there. Do not warm up with a market-size hockey stick. If they only remember one sentence, this is it. Mention testnet immediately so the rest is not heard as a mainnet claim.

---

## Slide 2 — The job to be done

**Headline:** People already type the view. They buy the wrong instrument.

- Perps: easy direction, unbounded loss. Hyperliquid did **$2.96b** notional *today* (info API).
- Prediction markets: yes/no, price = probability. Kalshi **$13.0b** / 30d; Polymarket US+Intl **$5.1b** / 30d (DefiLlama).
- An option is bounded loss aimed at a price. The screen for it was built for market makers.

**Notes:** Derive (29 Aug 2026) says desks leaving perps want defined risk — cite as their blog, not as our survey. Do not say “we will take 1% of Hyperliquid.” The slide is *demand is mispackaged*, not TAM.

---

## Slide 3 — The atom

**Headline:** The binary is the whole product.

- YES pays $1 if SYMBOL ≥ STRIKE at EXPIRY; NO pays $1 otherwise. Price = implied probability.
- Max loss on a long = the premium. Writer locks the complement. No margin engine.
- A vanilla call is a stack of binaries. We can compose later. We don’t lead with that.

**Notes:** Work the $100 / 41¢ / 243 YES / $243 payout example on a whiteboard if the room is technical. Emphasise 100% collateral as a *product* choice (no liquidations), not ideology.

---

## Slide 4 — The interface that failed

**Headline:** Strike chains and greeks are a dealer screen.

- The user’s sentence is “SOL holds 120 into Friday,” not “27 Oct 1200-delta call.”
- Hunch independently shipped a sentence on top of Derive/Rysk — same sentence, different machine.
- We compile the sentence to a real onchain book. If the book is empty, we show empty, we don’t bridge.

**Notes:** Do not cite tweet view counts (unverified). hunch.cool exists; credit them. Our gap is the machine: onchain matcher, 100% collat, first print, canonical event — not a prettier Derive.

---

## Slide 5 — The venue that failed

**Headline:** The desk is the wrong venue. So is a single chain.

- Listed crypto options still live on Deribit / RFQ / Telegram. Onchain premium is **$90m / 30d**, almost all Derive (DefiLlama).
- USDC is already on Ethereum $45b, Hyperliquid $7.1b, Solana $6.8b, Base $4.4b, Arbitrum $2.3b (DefiLlama, 11 Oct).
- Bridging collateral *while the ticket is open* is credit risk, not options risk.

**Notes:** Original thesis said matching belongs onchain because gas finally allows a CLOB. Keep that; add: users will not bridge mid-hunch. Base and Arbitrum are first because that is where we can list into native USDC without a new-chain sermon.

---

## Slide 6 — Canonical events

**Headline:** One event. Local dollars. Global quote.

- Canonical key: `SOL:120:expiry` on every chain. Same grids, same Friday 16:00 UTC.
- Each venue is fully funded locally. The UI routes the ticket to the best *tradable* book.
- Hyperliquid is a **Soon** chip, not a venue. We ship Base + Arbitrum; Solana devnet is already up.

**Notes:** Show [canonical-events](../figures/canonical-events.svg) and [routing](../figures/routing.svg). “Best venue” is most contracts per dollar inside the limit, not a bridge. If Solana is 41¢ deep and Base is 44¢ thin, the ticket goes to Solana and the user must have gas *there*.

---

## Slide 7 — Settlement

**Headline:** First print at or after expiry. Else 50/50.

- Chainlink: first round with a predecessor proof (exact). Pyth: `prev_publish_time` (exact when posted).
- HyperCore windowed `record()` is weaker — planned, paused, will be labelled if it ever ships.
- Near-strike disagreement across oracles is basis, disclosed. Void beats stuck funds.

**Notes:** Settlement is “the whole game” in the original thesis. Don’t skip. ATM + slow heartbeat (Base Sepolia 10–20 min) is a wide band; we will measure prints before claiming venues agree. Owner cannot change an outcome.

---

## Slide 8 — The primitive we have not built

**Headline:** Contingent-surplus netting: move a dollar only once a venue is over-collateralised.

- Burn unpaired YES on A, unpaired NO on B → $1 whenever the oracles agree, paid after settlement.
- Same receipt: cross-chain merge, teleport (solver posts $1 on destination first), maker netting.
- **Not built.** Until then we are multi-venue, not unified liquidity. That line is the product.

**Notes:** Show [contingent-surplus](../figures/contingent-surplus.svg). If they ask “so you unified the books?” say no. If they ask “why not CCTP the premium?” say because the ticket would be open on Circle’s attestation. Paper §6 is the homework.

---

## Slide 9 — Competition, without the cartoon

**Headline:** We are not a Derive skin, not an election market, not HIP-4.

- Derive: real onchain vanillas, greeks, margin, ~$82m / 30d premium. Different product.
- Polymarket / Kalshi: the interface that works, at billions / 30d. Not a portable first-print price CLOB.
- HIP-4: closest payoff cousin, one core, HyperCore marks. Our Hyperliquid work is paused.

**Notes:** Respect Deribit depth. Respect Kalshi’s legal path. Weakness table is in the thesis; don’t pretend we have their liquidity. Win condition: sentence + solvent onchain book + same event where the user’s USDC already is.

---

## Slide 10 — How it earns (and how it dies)

**Headline:** Taker bps on premium. Caps on the maker. No APY story.

- Testnet fee **0**. Cap 100 bps; we would try **10–30 bps** taker, makers 0. A $100 / 41¢ ticket at 20 bps is ~**$0.20**.
- Model maker quotes \(N(d_2)\), stops near expiry, per-series and global caps. LPs can lose money.
- We die if the vault is picked off, if incumbents list the same questions deeper, or if we launch into a binary-options ban without geoblock and counsel.

**Notes:** Walk example B only if asked (2,000 tickets × $80 × 20 bps = $320 protocol — small on purpose). EU/UK/AU retail binary bans are real; US event contracts are DCM-shaped. Do not say “we’re like Kalshi.”

---

## Slide 11 — What’s live

**Headline:** Solana devnet is live. Base and Arbitrum are the EVM targets. Mainnet is not.

- Program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh` — **28 markets**, keeper running.
- EVM stack complete (`montions-base/`, 295 Foundry tests). Public Sepolia deploy: **deploying** (no public bytecode as of 11 Oct 15:25 UTC).
- App: ticket printer, canonical keys, Serious mode; UwU original-mascot mode in progress. CSN: paper only.

**Notes:** Scrupulous. If a live Base address exists by demo day, use it; otherwise placeholders and the Solana faucet path. Never say Hyperliquid is live.

---

## Slide 12 — Ask / next

**Headline:** Print a ticket. Then soak settlement. Then audit.

- Now: hackathon demo, Base+Arb testnets, measure prints across Pyth and Chainlink.
- Next: LP conversations without emissions; legal review before any real USDC.
- Mainnet, if at all: Base and Arbitrum first, caps on, pause-new-risk, Safe.

**Notes:** Close on the ticket, not on a raise. If there is an ask (partners, Chainlink/Pyth, LP intros), make it one line. Kill criteria: no fills; vault-only losses; counsel “do not list.”

---

## 60-second spoken version

Options are the right product, sold through the wrong interface, on the wrong venue. People already trade unbounded direction on perps — Hyperliquid did three billion notional today — and bounded yes/no on Polymarket and Kalshi, at billions a month. What they actually want is defined risk on a price: I think SOL is above one-twenty by Friday, I’ll risk a hundred. That’s a binary. Price is the probability, max loss is the premium, and if you fully collateralise it you don’t need a margin engine.

We put that on an onchain order book and we sell it as a ticket, not a greek. Users and USDC already live on Base, Arbitrum, and Solana, so we list the *same* event on each chain, keep the dollars local, and route the ticket to the best book. We do not bridge while the ticket is open. A later primitive nets leftover collateral after settlement; we have not built it yet.

Solana devnet is live, twenty-eight markets. Base and Arbitrum are what we’re shipping next. Hyperliquid is paused. Mainnet is not up. Liquidity is the real risk, not the sentence. If you remember one thing: say it, print it, settle the first print — or void fifty-fifty.
