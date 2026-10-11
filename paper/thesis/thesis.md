# Options are the right product, sold through the wrong interface, on the wrong venue

Kairo (formerly Montions).

Kairo thesis · 11 October 2026 · v0.1

This document extends the original Kairo thesis (`montions/docs/THESIS.md`). The six claims there still hold. What has changed is the *venue*: users and USDC now live on several chains at once, so a single onchain book is not enough. We do not silently drop the Monad-era argument that matching belongs onchain; we say why cheap L2s and Solana now clear the same bar, and what new failure mode (bridging while a ticket is open) that creates. Claims below are sourced, derived from the specs, or labelled as our belief.

Companion technical paper: [Canonical Events](../cross-chain-options.md). Product docs: [overview](../docs/overview.md), [how it works](../docs/how-it-works.md), [chains](../docs/chains.md), [settlement](../docs/settlement.md).

---

## Executive summary

Retail already trades two things at scale: perpetual futures (asymmetric upside, unbounded loss) and prediction markets (yes/no, price = probability). An option is the product in between — bounded loss, asymmetric payoff — but it is sold through an interface built for market makers (strike chains, implied vol, greeks) and on venues that do not compose (CEX books, RFQ desks, Telegram, isolated per-chain protocols).

The **binary** is the atom of that product. “SOL ≥ $120 at Friday 16:00 UTC?” is a yes/no question. YES pays $1 if true, NO pays $1 if false. The price of YES is an implied probability. Maximum loss on a long is the premium you see before you click. Every contract is **100% collateralised**, so there is no margin engine, no liquidation, no insurance fund, and no socialised loss.

The **interface** that replaces the chain is a ticket: *I think SOL will be above $120 by Friday with $100.* The app compiles the sentence to a buy of YES or NO against a real onchain central limit order book.

The **venue** that replaces the desk is not “one chain to rule them.” USDC already sits in size on Ethereum, Hyperliquid, Solana, Base and Arbitrum (DefiLlama stablecoins, 11 Oct 2026 — figures in Market). Users will not bridge mid-hunch. Each Kairo venue is fully funded in *local* USDC-style collateral. The same economic event is identified once, as a **canonical key** `(asset, strike, expiry)`. The UI quotes every live book and routes the ticket to the best one. Nothing cross-chain is under-collateralised. A later primitive, **contingent-surplus netting**, moves a dollar only after a venue is already over-collateralised; it is specified in the paper and **not built**.

As of **2026-10-11 18:36 UTC**: Base v2 and Arbitrum v1 Books have bytecode and **150 / 81 registered series** respectively. Solana devnet is reported deployed with **28 seeded markets**; fresh RPC reads failed, so current count and keeper uptime are unverified. Stocks: **29 keeper-reported demo-oracle tickers on Base**, API-key-gated Pyth path built. Events: **deploying**, no live resolver in manifests. Hyperliquid: **PAUSED**. Website: [Kairo](https://kairo-nu-red.vercel.app). Testnet, unaudited, mainnet not live. [Evidence](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md).

We are not claiming options volume has flipped perps, or that a sentence alone creates a market. We are claiming the interface can finally match how people bet, the matcher can live onchain, and the event can be the same event on every chain that already holds the user’s dollars.

---

## The product: why binary options (the atom)

### What people already buy

A perpetual future is a leveraged bet on direction. It is easy to type and hard to survive. Funding, liquidation price, and unbounded loss are the cost of that ease. Derive’s own research line in August 2026 is that desks moving *from* perps *toward* options want defined risk and precise hedges, not more leverage.[^derive-perps]

A prediction-market share is the opposite shape: yes or no, price between 0 and 1, max loss = what you paid. Polymarket and Kalshi have already taught a large retail audience to read a price as a probability. Combined, they transact on the order of **hundreds of millions of dollars a day** (DefiLlama DEX volumes, 11 Oct 2026 — Market). That is not a niche UX experiment. It is a working retail interface for bounded bets.

An option is what you get if you keep the bounded loss and aim it at a *price path* rather than an election. The industry then buried that fact under a surface built for professionals.

### The binary is the atom

A **cash-or-nothing digital** (binary) pays a fixed $1 or $0. In Kairo:

- A market is the question **is SYMBOL ≥ STRIKE at EXPIRY?**
- One **YES** contract pays $1 of 6-decimal collateral if the first valid oracle print at or after expiry is ≥ strike, else $0.
- **NO** pays the complement.
- While the market is open, every YES is paired with a NO against $1 in the pool: `pool = yes_supply × $1 = no_supply × $1`.
- Prices are integer **ticks 1–99¢**. YES at 41¢ is a 41% implied probability. NO at that book costs 59¢.
- Maximum loss on a long is the premium. A writer locks the complement. There is no maintenance margin.

A vanilla call is a stack of binaries across strikes. Spreads and vanillas can be composed later from the same books; they do not have to be the first thing a user sees. This is the original thesis, unchanged.

**Worked ticket.** “I think SOL will be above $120 by Friday with $100.” Best ask 41¢, 400 contracts resting:

| | |
|---|---|
| Contracts bought | `floor(100 / 0.41) = 243` YES (if the level is deep; otherwise the book is walked) |
| Cost (max loss) | \(243 \times \$0.41 = \$99.63\) |
| Payout if right | $243 |
| Profit if right | $143.37 |
| If wrong | the premium is gone; nothing more is owed |

A writer who sold those 243 YES locked \(243 \times \$0.59 = \$143.37\) and received 243 NO. The pool increased by $243. YES supply and NO supply each increased by 243. Matching is atomic: escrow, fill, and mint happen in one instruction/transaction. See [how it works](../docs/how-it-works.md).

### Why 100% collateral is a product decision

Onchain options protocols have spent years reconstructing a margin engine: portfolio margin, partial collateral, liquidations, insurance funds. That is how Deribit and Derive get capital efficiency. It is also how you inherit liquidation cascades, socialised loss, and a clearing-house-shaped trust surface.

A binary that is fully funded does not need any of that. The Book (EVM) or Market account (Solana) either holds $1 per pair or it does not. Invariants are checkable: open-market `pool == yes_total == no_total` (in $1 units); cash conservation; escrow equals open orders. The original EVM suite tests seven such properties under fuzzing; the Solana engine tests the same accounting against a reference model (`montions/docs/THREAT_MODEL.md`, `montions-sol/docs/SPEC.md`).

The cost is capital inefficiency versus a margined vanilla book. We take that cost on purpose. It is the reason matching and settlement can be one contract, the reason a void is 50/50 instead of a hole, and the reason a cross-chain dollar does not have to exist until after settlement.

### Outcome-first, not greeks-first

The user does not pick a series id. They state a payoff and a budget. Direction *below* is a buy of NO on the same market, not a second event. The UI may show a model “chance” \(N(d_2)\); that is a quoting aid, not a promise. The book’s bid/ask is the price.

This is the original product. The ticket is how it is sold.

---

## Why the interface failed — and what replaces it

### Strike chains were built for the desk

A professional options screen exists so a market maker can see a surface: every strike, every expiry, bid/ask in implied vol, delta, vega, the skew. That screen is correct for the person who *quotes*. It is the wrong first sentence for the person who *has a view*.

The view is almost always a sentence. “SOL holds $120 into Friday.” “ETH is not going to $4,000 this month.” “I’ll risk a hundred dollars that I’m right.” Translating that into a 27 Oct 1200-delta call, a 0DTE fly, or a Deribit ticker is homework. Most people skip the homework and open a perp.

Hunch’s October 2026 demo made this point by changing the sentence, not the machine: “I want to make $1,100 if HYPE hits $111 by Nov 27,” cost and implied chance, Buy. The original thesis recorded that clip circulating on X; **view counts and dates there were not independently verified for this document** and are not cited as facts. The product page [hunch.cool](https://hunch.cool/) exists and is sentence-shaped. Hunch sits on Derive listed options and Rysk “earn,” not on a native binary CLOB. Same sentence, different machine. That distinction is the gap we are actually building into.

Dream ([dreamos.app](https://dreamos.app)) is in the same UX race: a faster way to trade listed options. Clutch’s founder, in the same week’s discourse, argued that liquidity, not UX, is the bottleneck. We agree with *both* complaints. The interface is wrong **and** empty books kill the product. Fixing the sentence without a solvent book is a skin. Filling a greeks book without a sentence is Deribit.

### What replaces it: the ticket

Kairo compiles a five-field ticket:

1. **Asset** — SOL, BTC, ETH, … (registered feeds only).
2. **Direction** — above or below.
3. **Strike** — on a shared grid (intended: BTC $500, ETH $25, SOL $1).
4. **Expiry** — on a shared schedule (Solana snaps to a 5-minute unix grid; EVM venues are required to use the same instants so keys coincide; weeklies target Friday 16:00 UTC).
5. **Budget** — dollars to risk. This is max loss on a long.

The app prints a ticket: the sentence, contracts, average price, payout if right, model chance, venue, oracle. Confirming it is `place_order` / `placeOrder` against the selected book, with a limit price. If the book moves, the transaction reverts rather than filling worse.

On Solana, a missing market on the grid can be created and quoted in the same transaction as the first buy. On EVM, deposit (EIP-2612 permit) and place can be multicall’d. The user never sees a tick bitmap.

Two visual modes sit on the same ticket (Users). The machinery does not change.

### What we will not put on the ticket

Greeks, IV, “delta-neutral,” portfolio margin, funding. Those are maker-facing and can live in a later desk mode. Putting them on the first screen recreates the failure.

We also will not pretend a thin book is a good price. If the ask is 41¢ for 10 contracts and the next level is 70¢, a $100 budget does not get 243 contracts. The quote must walk the book and show the average. Illiquid strikes are skipped by the router, not silently bridged.

---

## Why the venue failed — and why multi-chain now

### Where options liquidity actually lives

Crypto options flow still concentrates off a public onchain book:

- **Deribit** remains the reference listed-options venue (custody, margin, RFQ via Paradigm, Telegram for the rest). A public API snapshot on 11 Oct 2026 UTC showed ~1,924 BTC and ~16,760 ETH of options *volume that day*, and open interest of ~373,591 BTC and ~1,400,464 ETH (Deribit `get_book_summary_by_currency`; notional and caveats in Market).
- **Onchain listed options**, as DefiLlama measures premium volume, did about **$90.0 million over 30 days**, of which Derive was **$82.0 million** (DefiLlama options overview, 11 Oct 2026). Everyone else is small. Aevo, once the “CEX-on-L2” story, did **$1.84 million** 30-day premium.
- **Vaults and RFQ sellers** (Rysk, Thetanuts, SOFA) supply structured yield. They are not a public binary book.

The original thesis’s explanation still holds: an order book was too expensive onchain, and AMMs price convexity badly, so DeFi options became vaults selling to a few desks. Matching belongs onchain; 100% collateral is how you avoid rebuilding a clearing house to do it.

### What changed: cheap execution is no longer a single-chain story

The Monad-era claim was “only now can an onchain CLOB be practical.” We keep the *matching* claim and update the *where*. A bounded matching loop (`maxFills` ≤ 256 on EVM; a 64-order arena on Solana), 1–99 ticks, and no liquidation engine is a small enough program to run on Base, Arbitrum, and Solana at retail size. We do not need Monad’s throughput to prove the product. We do need *some* cheap, public, verifiable matcher. That is now a property of several venues at once.

### The new failure: liquidity silos, oracle mismatch, users on many chains

If the book can live on several chains, copying it naively creates three new problems.

**1. Liquidity silos.** A SOL-above-$120 book on Solana does not fill an order on Base. Makers duplicate inventory or do not quote the second venue. N thin books is worse than one.

**2. Oracle mismatch.** “Was SOL ≥ $120 at Friday 16:00 UTC?” is not a well-defined onchain question until you name the feed and the timestamp rule. Chainlink’s first *round* after \(T\), Pyth’s first *signed print* after \(T\), and HyperCore’s *current* `oraclePx` sampled in a window are different random variables. Near the strike they can disagree. Pretending they are the same print is how you get a basis you did not disclose.

**3. Users (and USDC) already live on many chains.** Native USDC circulating, DefiLlama stablecoins, snapshot date 11 Oct 2026 00:00 UTC:

| Chain | USDC (USD) |
|---|---|
| Ethereum | $45.16 billion |
| Hyperliquid L1 | $7.15 billion |
| Solana | $6.81 billion |
| Base | $4.42 billion |
| Arbitrum | $2.34 billion |
| **All chains** | **$73.15 billion** |

A trader with USDC on Base will not bridge to Solana to express “ETH above $2,500 this week.” Asking them to is the same mistake as asking them to open Deribit.

Bridging *while the ticket is open* is worse. Locking USDC, waiting on an attestation, minting a synthetic on the destination means the ticket is open against a messenger. A reorg, attestation stall, or issuer freeze in that window is not an options risk.

### Collateral-local, liquidity-global

The design that follows is in the paper; the product claim is short.

- **Collateral-local.** Each venue is 100% funded in local USDC-style collateral. A fill on Base is a Base liability. There is no lockbox and no in-flight CCTP on the matching path.
- **Canonical events.** The market is \(\kappa = (A, K, T, \ge)\). UI string `SYMBOL:strike:expiry`. Same strike grid and expiry schedule on every chain, or routing compares different events.
- **Liquidity-global (routing and quoting, not a shared pool).** The UI asks every live adapter for a quote on \(\kappa\) and prefers the tradable book with the most contracts per dollar inside the user’s limit. A model-priced maker can quote the same \(N(d_2)\) centre on every venue; inventory stays local until netting exists.
- **Hyperliquid is paused.** The UI shows it as a disabled “Soon” chip, not a routable venue. HyperEVM plus the HyperCore oracle are planned, not live. Ship order is Base Sepolia and Arbitrum Sepolia, with the Solana deployment reported as a side line.

![One event, local books](../figures/canonical-events.svg)

![Route the ticket, do not bridge the premium](../figures/routing.svg)

This is the extension of the original venue argument. The desk is still the wrong venue. *A single chain* is also the wrong venue, once the users are not on it.

---

## The cross-chain primitive, in one page

Full definitions, proofs, and numeric examples: [Canonical Events](../cross-chain-options.md) §6. This section is a product summary. **Contingent-surplus netting is proposed, not built.**

On one venue, YES+NO pairs are backed by $1. If you burn a YES on venue A *without* its NO, venue A is over-collateralised by exactly $1 **if YES wins** (and by $0 if NO wins). If you burn a NO on venue B without its YES, B is over-collateralised by $1 **if NO wins**. Write \(S_Y^A\) and \(S_N^B\) for those leftovers.

**Proposition (agreeing states).** The pair “unpaired YES on A + unpaired NO on B” pays exactly $1 whenever A and B report the same outcome: $1 from A if both YES, $1 from B if both NO, $0.50+$0.50 if both void.

That pair is a **complete set across venues**, without a bridge while the market is open. After settlement, whichever venue holds the surplus pays, via a message proof plus a CCTP-style USDC transfer — or the holder simply redeems on the venue that has the leftover.

Three uses of the same receipt:

1. **Cross-chain merge.** Hold YES on Solana and NO on Base, same \(\kappa\); burn both; receive $1 after settlement from whoever was right.
2. **Teleport.** Want YES on Base, hold YES on Solana. Post-expiry this is a payout location. Pre-expiry a solver posts $1 on Base, splits into YES+NO, gives you YES, keeps NO plus your Solana surplus receipt. The solver is flat when oracles agree and short the “A loses, B wins” cell.
3. **Maker netting.** A maker long YES on A and long NO on B has $2 locked for a $1 claim. Burning the offsetting legs into surplus receipts frees the economic complete set; a cash buyer can purchase the pair before expiry without minting unbacked tokens.

**When oracles disagree.** Each venue pays its own surplus per its own oracle. Near the strike that can be a $0 cell or a $2 cell for the receipt holder. Single-venue users are unaffected. A **disagreement reserve** can haircut the $2 cell to fund the $0 cell so CSN always pays $1; that reserve is a risk limit, not a Book invariant, and it is also not built.

**What must never happen.** Minting YES on B without $1 on B. Treating a general messenger (LayerZero, Hyperlane, CCIP) as if it were USDC. Bridging the user’s premium so they can take a quote on another chain.

Circle CCTP is the intended USDC path. Circle’s “Supported blockchains and domains” page (dateModified 2026-10-05, retrieved 2026-10-11) lists, among others, Ethereum, Avalanche, OP Mainnet, Arbitrum, Base, Polygon PoS, Solana, Noble, Sei, Sui, Aptos, Unichain, World Chain, HyperEVM, Ink, Monad, Codex and Linea.[^cctp] The paper records domain ids Arbitrum 3, Solana 5, Base 6, HyperEVM 19. HyperEVM support on CCTP does not make Hyperliquid a live Kairo venue; that work is paused.

![Contingent-surplus netting](../figures/contingent-surplus.svg)

Until CSN ships, Kairo is honest multi-venue, not unified liquidity: one ticket, several solvent books, best-venue routing, local claim.

---

## Market: sizing, who trades, why now

Every figure below was retrieved on **11 October 2026**. Snapshot days are not years. Where a number could not be sourced, we say so.

### Perps dwarf options; that is the gap, not the TAM

Hyperliquid’s public info API (`metaAndAssetCtxs`) on 11 Oct 2026 showed **$2.96 billion** of perp notional volume that day and **$12.11 billion** of open interest across 234 perps. DefiLlama lists Hyperliquid TVL at **$7.11 billion** and Hyperliquid spot order-book volume at **$72.7 million** (24h) / **$4.45 billion** (30d). DefiLlama fees for Hyperliquid: **$1.60 million** (24h), **$88.0 million** (30d).

That is one venue. Crypto perps as a class are larger still (we did not pull a reliable all-venue 2026 aggregate from DefiLlama’s derivatives overview on this pass — the endpoint returned 402 — so we do not invent one).

The point is directional: people already express views on SOL, BTC, and ETH in size, with unbounded loss. Defined-risk demand is not a fantasy; it is the conversion of a fraction of that flow.

### Listed crypto options: Deribit is the market; onchain is a rounding error

**Deribit**, public API, 11 Oct 2026, index BTC **$83,069.28**, ETH **$2,506.53**:

| | Volume (coin) | Volume USD field (premium) | Open interest (coin) | Approx. notional (coin × index) |
|---|---:|---:|---:|---:|
| BTC options | 1,924 | $1.25 million | 373,591 | $159.8 million volume / $31.0 billion OI |
| ETH options | 16,760 | $0.29 million | 1,400,464 | $42.0 million volume / $3.51 billion OI |

The `volume_usd` field on Deribit summaries is much smaller than coin × index; we treat it as premium-like and coin × index as notional-like. This is a **Sunday snapshot**, not a monthly run-rate. We did not source Deribit’s official 30-day totals on this pass.

**Onchain options premium volume**, DefiLlama overview, 11 Oct 2026:

| | 24h | 7d | 30d |
|---|---:|---:|---:|
| All listed protocols | $0.30 million | $15.3 million | **$90.0 million** |
| Derive (parent) | $0.26 million | $14.1 million | **$82.0 million** |
| Paradex Options | $18k | $0.33 million | $3.86 million |
| Aevo Options | $1.9k | $0.42 million | $1.84 million |
| Rysk V12 | $25k | $0.25 million | $1.67 million |
| SOFA.org | $7.6k | $50k | $0.23 million |
| Panoptic V2 | ~$3 | $2.6k | $25k |

DefiLlama’s 24h print was **−91% vs the prior day**; do not annualise $299k. The 30-day column is the useful one: onchain listed options are a Derive story plus noise. The original thesis’s “~$81 million 30d premium, ~$4.4 billion notional” for Derive (compiled 10 Oct 2026) is consistent in premium with today’s $82.0 million; we did not re-source the notional figure today and do not repeat it as current.

### Prediction markets: the interface that already works

DefiLlama DEX-volume adapters, 11 Oct 2026 (these adapters classify event-contract notional as volume):

| Venue | 24h | 7d | 30d |
|---|---:|---:|---:|
| **Kalshi** | $459 million | $2.25 billion | **$13.05 billion** |
| **Polymarket US** | $106 million | $717 million | **$2.90 billion** |
| **Polymarket International** | $82 million | $514 million | **$2.19 billion** |
| Polymarket US+Intl (sum) | $188 million | $1.23 billion | **$5.09 billion** |
| Predict Fun | $12.5 million | $76.9 million | $310 million |
| OPINION | $3.8 million | $63.4 million | $275 million |

Polymarket `data-api` global open interest: **$358.8 million**. DefiLlama TVL for Polymarket International: **$357.5 million**. Gamma API, top 100 *open* markets only: **$28.0 million** combined 24h volume — a lower bound, sports-heavy on a Sunday.

Kalshi **fees** (DefiLlama, methodology: trading fees collected): $5.77 million (24h), $152.9 million (30d). Polymarket **fees**: $4.24 million (24h), $107.9 million (30d). Fee ÷ volume is about 1.3% (Kalshi) and ~2.3% (Polymarket) on this snapshot; those are platform takes on event contracts, not a Kairo fee proposal.

**Hyperliquid Outcomes** is listed on DefiLlama as a prediction-market protocol with no volume print in this pull. HIP-4 outcome markets are the closest *payoff* cousin (fully collateralised binaries on HyperCore). They are not cross-chain and they settle to HyperCore marks.[^hip4]

### Traditional listed options and retail participation

We attempted to pull OCC and CBOE volume tables on 11 Oct 2026. OCC pages returned Cloudflare 403; a CBOE CDN object returned 403. **We do not have a sourced 2026 OCC contract-volume or retail-share figure, and we will not guess one.**

What we can say without that number: US listed options are a large, mature retail-plus-professional market; 0DTE index options have been a major share of SPX volume in recent years in industry commentary we did not re-verify today. For *this* product, the cleaner demand evidence is Kalshi + Polymarket: hundreds of millions of dollars a day of yes/no contracts bought by people who are not sitting on a Deribit screen.

### USDC coverage, which is why Base and Arbitrum are first

Native USDC is already where we want to list (table above). Circle CCTP supported-chain documentation (retrieved 11 Oct 2026) includes Base, Arbitrum and Solana — the three venues in current scope — plus HyperEVM among many others.[^cctp] We do not need CCTP to trade. We need it later, for surplus. Collateral on testnets is protocol **tUSDC**, not Circle USDC.

### Who trades

Four overlapping groups, as hypotheses, not as counted users:

1. **Perps tourists** who want the directional hit without liquidation. They already type the view. They currently pay unbounded loss for UX.
2. **Prediction-market natives** who are fluent in price-as-probability and want *price-threshold* questions (“SOL ≥ $120 Friday”) that Polymarket only sometimes lists, and not as a portable onchain CLOB with a first-print rule.
3. **Desks and vault LPs** who will quote a binary book if exposure is capped and settlement is deterministic. They are not acquired by kawaii copy.
4. **Culture users** who will share a ticket the way they share a parlay slip. See Users.

### Why now

- Event-contract UX is trained (Polymarket, Kalshi).
- Cheap public matching is available on Base, Arbitrum, Solana.
- USDC is native on those chains in the billions.
- Onchain vanilla options did not absorb retail; they stayed a Derive-shaped professional product.
- HIP-4 shows even Hyperliquid agrees the payoff belongs onchain — on *one* core. Canonical Events is the multi-venue version of that idea, with a portable timestamp rule.
- The original thesis’s settlement rule (first print, void if missing) is implementable on Chainlink (exact adjacency) and Pyth (exact when posted). That is new relative to “the AMM’s TWAP” and relative to “the CEX’s mark.”

---

## Users and personas

The product is one ticket. The people who want it are not one person. We split **Serious** and **UwU** as visual modes on the same machinery, not as different risk.

### Persona 1 — Maya, defined-risk perp trader

Maya trades SOL and ETH perps on a CEX or on Hyperliquid. She has been liquidated. She can state “SOL holds 120 into Friday” and she cannot currently buy that as a $100 defined-risk ticket without opening Deribit or picking a Polymarket market that may not exist. **Serious mode** is for her: night palette, short copy, no mascot in the way of the quote, chain picker, best-venue line, explorer link after fill. She should be able to explain the ticket to herself in one breath: amount in, amount out if right, void = 50/50.

### Persona 2 — Jules, prediction-market native

Jules lives on Polymarket. Price is probability. Jules wants crypto-price questions with a named oracle, not a resolution thread. Jules does not want to learn “call vs put.” Above/below is enough. Jules will compare our 41¢ to a Polymarket 41¢ and will notice if we cannot exit. Honest depth and a claim flow matter more than onboarding copy.

### Persona 3 — Rin, vault LP / amateur MM

Rin understands \(N(d_2)\) and adverse selection. Rin will not deposit if the vault is sold as yield. The UI must say: capped exposure, no quotes near expiry, you can lose money to informed flow. Rin is how books have two-sided quotes at 1–99¢ on day one. Rin is also how we die if we lie about expected return.

### Persona 4 — Dex, culture user (UwU as a distribution wedge)

Crypto-native culture already speaks in kawaii, copypasta, and shareable screenshots. That is not a strategy consultant’s “gen z play.” It is the language a large onchain audience already uses when they are not performing professionalism.

**UwU mode** is a second skin: pastel/sakura, softer copy, original anime-girl mascots. Rules we will keep:

- **Original art only.** Never copy existing characters, trademarks, or someone else’s stills. If we cannot ship original mascots, we ship without them.
- **Same ticket, same numbers, same risk.** Kawaii does not hide max loss, void, or oracle name. If the Serious ticket shows “you can never lose more than you put in,” UwU shows it too.
- **A ticket is a social object.** The print step (sentence, QR, payout) is designed to be screenshotted and posted. That is the wedge: the parlay slip, not a referral code.
- **Serious remains default for anyone who wants it.** A trader who bounces at pastel is not “converted”; they are given the other mode. Mode is a toggle, not a funnel trick.
- **No baby-talk about money.** Cute copy is flavour. It does not say “to the moon,” does not call losses “oopsies,” does not sexualise the mascot, does not imply the product is a toy.

We believe (not proven) that a shareable ticket in the culture’s own register will outperform another dark-mode Deribit clone at acquiring the first ten thousand *non-desk* users. We also believe that if UwU is cringe, it will net-negative. The kill criterion is qualitative but real: if the screenshots are ironic mockery rather than use, turn the mode off.

### What both modes share

Testnet labelling. Faucet. Chain picker with Hyperliquid **Soon**. Oracle name on the ticket. Claim after expiry. No greeks.

---

## Competitive landscape

Honesty over positioning. X commentary in the original thesis appendix remains unverified and is not used here.

| Venue | What it is | Matching | Collateral | Settlement | Interface | Strength | Weakness vs Kairo |
|---|---|---|---|---|---|---|---|
| **Deribit** | Dominant crypto options CEX | Offchain CLOB + RFQ | Portfolio margin | Venue index / listed expiry | Strike chain, greeks | Depth, professionals, OI in the tens of billions of USD notional (snapshot above) | Custody; US-party issues after the 2025 acquisition (Derive’s claim, Aug 2026); not a sentence; not onchain |
| **OKX / Bybit / similar CEX options** | Exchange-listed vanillas | Offchain | Margin | Exchange | Strike chain | Distribution, fiat ramps | Same custody and interface problems; not portable |
| **Derive** (ex-Lyra) | Onchain vanillas | CLOB + RFQ | Portfolio margin | Listed expiries, venue settlement | Greeks book; Hunch as a skin | Real onchain premium volume (~$82m / 30d) | Not 100% collat binaries; not multi-venue canonical events; sentence is optional UX, not the product |
| **Aevo** | Options + perps on a custom L2 | Offchain match, onchain settle | Margin | Venue | CEX-like | Once had mindshare | 30d premium $1.8m; faded vs Derive |
| **Paradex Options** | ZK perps + options | Offchain speed | Unified margin | Venue | CEX-like, privacy | 30d premium $3.9m, second among onchain | Not a public fully-collateralised binary CLOB |
| **Panoptic** | Perpetual options on Uniswap LP | No book | LP inventory | No dated expiry, internal obs. | LP / streamia | No oracle, no expiry — different animal | Opposite of first-print dated binaries |
| **Rysk / Thetanuts / SOFA** | Vault / RFQ structured | RFQ or vault | Seller-side | Various | “Earn” | Supply of premium | Not a public two-sided binary book |
| **Opyn** | oTokens, cash-settled | AMM / OTC historically | Per series | Oracle per series | Power-user | Prior art for onchain options | Not outcome-first; not a multi-chain CLOB |
| **Premia** | Options AMM | AMM | LP | Oracle | Pool | Early DeFi options | AMMs price convexity badly (original thesis) |
| **Polymarket** | Event YES/NO | Offchain CLOB, onchain positions (CTF / V2) | Fully funded shares | UMA / adapters, one domain | Probability, events | Retail-scale volume (~$5.1b / 30d US+Intl); trained the interface | Not a token-threshold CLOB with a portable first-print rule; geoblocking; one settlement domain |
| **Kalshi** | CFTC-regulated DCM | Centralised | Fully funded event contracts | Exchange rulebook | Event contracts | Legal path in the US; ~$13.0b / 30d volume | Not onchain; not crypto-price-first; not multi-chain |
| **Hyperliquid perps** | Onchain-core perps | HyperCore CLOB | Margin | Mark / oracle | Ticker | $3.0b / day notional snapshot; distribution | Unbounded loss; not an option |
| **Hyperliquid HIP-4 Outcomes** | Fully collat. binaries on HyperCore | Merged YES/NO books | 100% | HyperCore mark | Outcome markets | Closest payoff cousin; native to where a lot of USDC already sits | Not cross-chain; not first-print portable; Hyperliquid integration is **paused** on our side |
| **Hunch** | Sentence UX | Derive + Rysk | As Derive | As Derive | Sentence | Proved the sentence independently of us | Different machine: listed vanillas, not our book |
| **Dream** | Mobile options UX | Listed options | As underlying venue | As venue | Fast trade | UX race | Not an onchain binary CLOB |
| **Nadex / offshore binary brokers** | Traditional binaries | Centralised | Various | Centralised | Yes/no | Nadex is a regulated US binary/event path | Offshore binaries are the reputational tar pit; we are not a bucket shop |
| **Kairo** | Outcome-first binary CLOB | **Onchain** CLOB | **100%** | First print per oracle class; void 50/50 | Ticket | Canonical events; local solvency; sentence = product | Liquidity unproven; unaudited; CSN not built; thin vs Deribit/Polymarket; regulatory overlay |

Kairo’ actual gap, restated: **onchain matching + 100% collateral + first-print settlement + the same event on every chain the user already sits on**, sold as a ticket. Not another skin on Derive. Not a Polymarket clone for elections. Not HIP-4 on one core.

---

## Why we win — and when we don’t

### Why we might

1. **The sentence is the product, and the book is real.** Hunch showed the sentence; Polymarket showed the payoff language; neither is a fully onchain, 100% collateral, first-print, multi-venue CLOB for price thresholds.
2. **Defined risk is what perps users say they want after they blow up.** Convert a thin slice of Hyperliquid-scale flow and the market is large relative to Derive’s $82 million/month premium. That is a belief about conversion, not a forecast.
3. **Users will not bridge mid-hunch.** Listing where USDC already is (Base, Arbitrum, Solana) is a distribution decision, not a slogan. Canonical keys make “best venue” a quote, not a new product.
4. **100% collateral is simpler to trust and to prove.** No liquidation engine to get wrong. Invariants fit in a table.
5. **Culture can carry the ticket** if we stay original and do not talk down. Shareable slips are how prediction markets spread. We believe (not proven) UwU is a wedge, Serious is the retain.

### Conditions under which we don’t

1. **Liquidity never shows up.** The Clutch objection is right until it isn’t. A model maker with caps is a cold start, not a market. If informed flow picks the vault off and LPs leave, the ticket prints into a void.
2. **A regulated or incumbent event venue lists crypto thresholds well enough.** If Polymarket, Kalshi, or HIP-4 offer “SOL ≥ $120 Friday” with deeper books and a brand people already trust, our sentence is not enough.
3. **Hunch + Derive (or Dream) eat the UX win** while we are still on testnet. Then we are a protocol without a front door.
4. **Regulation treats us as banned retail binaries**, not as a cousin of event contracts. EU/UK/AU retail binary bans are real (Risks). A mainnet without geoblocking and legal review is how the project ends.
5. **Oracle disagreement near the strike** becomes a story: two venues, two outcomes, Twitter. Without CSN we can say “each chain pays its own print.” With CSN, if we ship it carelessly, we socialise basis into the reserve and then the reserve is empty.
6. **Multi-chain without depth is N empty books.** Shipping Arbitrum because the deploy script exists, before Base has flow, splits the maker. Cold start is *per chain*.
7. **UwU is cringe.** If the culture mode reads as a fund disguising a binary options shop, Serious users leave and culture users never come.
8. **We stay unaudited.** Caps help; they do not create a mainnet.

We do not win by announcing a category. We win if a ticket fills, settles, and gets posted, on a book that is still two-sided the next morning.

---

## Business model and unit economics

Nothing below is a forecast. Fees on testnet default to **0**. The Book/program cap is **100 bps** of premium, taker only; makers pay 0 (`montions/docs/SPEC.md`).

### Three lines of revenue (intended, mainnet)

1. **Taker fee on premium.** Charged on filled notional premium (`qty × tick` in $). Working range we would actually try: **10–30 bps**, not 100. Event venues in the market table take more like 1–2% of volume; we are a trading venue, not Kalshi, and a 100 bps take on a 41¢ contract is a large tax on a short-dated binary. Belief: stay closer to a CEX taker fee than to a prediction-market vig, and compete on the book.
2. **Maker vault / LP.** Spread is the LP’s revenue. A later **performance fee** on vault profits (illustration: 10% of realised gains, not of deposits) is a hypothesis. Deposits are not a savings product. The vault can lose money (`THREAT_MODEL.md`).
3. **Venue / API licensing.** A chain, wallet, or front-end that wants a binary ticket printer against a canonical book. Fee: integration plus a share of taker fees on that flow. No named licensee. Hypothesis only.

### Worked example A — one ticket

Budget $100, fill 243 YES at 41¢, premium $99.63.

| Taker fee | Fee on this ticket | User’s max loss incl. fee |
|---|---:|---:|
| 0 bps (testnet default) | $0.00 | $99.63 |
| 10 bps | $0.10 | $99.73 |
| 20 bps | $0.20 | $99.83 |
| 30 bps | $0.30 | $99.93 |
| 100 bps (cap, not the plan) | $1.00 | $100.63 |

If the user is right, payout is still $243; the fee was paid up front from cash.

### Worked example B — a day of flow (illustration, not a run-rate)

Suppose — *suppose* — 2,000 tickets, average premium $80, taker 20 bps, maker spread earned 1.5¢ per contract on 50% of filled contracts, average 200 contracts per ticket.

- Premium volume: \(2000 \times 80 = \$160{,}000\).
- Taker fees: \(160{,}000 \times 0.002 = \$320\).
- Contracts: \(2000 \times 200 = 400{,}000\). Spread on half: \(200{,}000 \times \$0.015 = \$3{,}000\) to makers, of which a 10% performance fee is $300 if and only if that spread is actually profit after adverse selection.

A day that looks like “the product works” can still be a few hundred dollars of protocol take. That is the honest unit. Protocol take becomes interesting only at prediction-market-like notional, which we have not earned.

Kalshi’s $152.9 million of *fees* in 30 days is what a regulated event venue looks like at $13 billion notional. That is the ceiling of the *category*, not our pipeline. Protocol take at CEX-like bps is a small number until flow is not; we do not claim a percent of Polymarket.

### Costs the model must cover

Keepers (gas + ops), oracle (Chainlink feeds on mainnet are not free at scale; Pyth pull currently wants a Hermes key), audit, legal, maker inventory (opportunity cost and adverse selection), support, geoblocking. Caps exist so that the first bug is not the last dollar (`collateralCap`, `seriesPoolCap`, vault `maxTotalAssets`).

---

## Liquidity strategy

Liquidity, not UX, is the honest bottleneck. The original thesis said so; Clutch’s founder said so; we are not reversing it.

### Model-priced maker first

Fair value is a digital \(N(d_2)\) (zero rate, configured or realised vol) computed onchain. The maker rests a ladder around `prob_to_tick(fair)`: half-spread at least `min_half_spread`, widening as time-to-expiry shrinks, `levels` each side, inventory first (`fromHeld` when the seat holds YES or NO). Quotes are POST_ONLY so the maker does not take. Refresh is permissionless; Pyth (Solana) cannot be moved by the caller. Near `min_tte` the maker **cancels and stops**. That is how we avoid the last-second pickoff.

### Caps

From the threat model, as design, not as a promise of profit:

- Per-series exposure on the order of **0.8–1% of vault NAV**.
- Global exposure **≤ ~30% of NAV**, **≥ ~20% free cash**.
- Quantity caps, bounded matching, allowlisted resolvers.
- Launch **collateral / series / vault caps**, raised in stages.
- Pause **new risk only**; cancel, withdraw, merge, resolve, redeem always work.

The vault can still lose money. Informed flow that knows the print will hit the resting bid. Caps bound the hole; they do not close it.

### Cold start per chain

Do not split one maker’s inventory across Base, Arbitrum, and Solana on day one. Pick a chain where we can see fills (Solana devnet is already seeded; Base Sepolia v2 is already deployed). Quote a **short ladder** of strikes around spot, **few expiries** (tomorrow, Friday, next month), and only then list the long tail. Permissionless `create_market` / `createSeries` is on a grid so the UI can open a strike without a governance ticket, but the *maker* does not have to quote every grid point.

### Long-dated ladders

Markets that expire in an hour are a slot machine plus an oracle fight. Weekly, monthly, quarterly listings stay open long enough for two-sided flow. Short-dated markets can exist; they are not the book we ask LPs to underwrite first.

### Cross-chain netting later

CSN is how a maker who *eventually* quotes two venues collapses YES_A + NO_B. It is not a cold-start tool. Using it before there is flow is theatre. Using it before a disagreement policy exists is how we donate to whichever oracle is slower.

### What we will not do

Incentive points as fake volume. Paying takers to fill themselves. Calling empty 1¢–99¢ levels “deep.” Bridging maker inventory so a second chain looks alive.

---

## Risks and counter-arguments

### Regulatory / binary-options legality

**The objection.** Regulators file binaries next to prediction markets, and sometimes next to gambling. Retail binary options are **banned** in several large markets: ESMA’s product intervention on binary options for retail (2018, EU); the FCA’s permanent ban on sale of binary options to retail consumers (effective 2 April 2019, UK); ASIC’s product-intervention order on binary options (Australia, 2021).[^esma][^fca][^asic] In the US, event contracts trade on CFTC-regulated DCMs (Kalshi); off-exchange binary options have a long enforcement history. Derive’s 25 Aug 2026 note: US retail is still largely blocked from their options; venue and product type matter.[^derive-legal]

**Rebuttal, not a cure.** Venue and product type matter; the original thesis said that and we do not walk it back. We are not an offshore bucket shop, we are not margined, and we can geoblock. That does not make a mainnet legal in New York. **Mainnet requires legal review.** Testnet play money is not a loophole for real USDC. If the product is illegal where you are, do not use it. Launch is capped and paused-by-default for this reason as well as for bugs.

We will not claim “we’re just like Kalshi” without being a DCM, or “we’re just like Polymarket” without their geoblocking and counsel.

### Oracle risk per chain

**The objection.** Binaries are most manipulable at the strike at expiry. Each chain’s oracle is a different attack surface.

**What we actually do.** Shared semantic: **first print at or after expiry**; else void 50/50 after grace (24 h Solana, 2 days EVM). Proofs differ ([settlement](../docs/settlement.md); paper §4):

| Oracle | Venue | What is proven | Residual |
|---|---|---|---|
| Chainlink | Base, Arbitrum | First round with predecessor `updatedAt` — exact inside a phase | DON report; proxy owner; phase boundary → void |
| Pyth | Solana (EVM pull path exists) | `prev_publish_time < T ≤ publish_time` — exact when posted | Publishers; 2% confidence cap; **sponsored-window fallback (60 s) lets the resolver pick a print inside the window** |
| HyperCore `oraclePx` | HyperEVM (planned, paused) | First `record()` in `[T, T+W]` | Recorder chooses the second; weaker; documented as such |

First-print plus void is mitigation, not a cure. ATM markets on a slow heartbeat (Base Sepolia Chainlink often 10–20 min) are a wide equivalence band. We will publish empirical print-vs-print tables before claiming venues agree.

![Settlement proofs](../figures/settlement-proofs.svg)

### Adverse selection against the maker

**The objection.** Binary books at 1–99¢ are a snack for anyone who knows more than \(N(d_2)\).

**Rebuttal.** Caps, `min_tte` cancel, inventory-first quotes, POST_ONLY, permissionless refresh so a lagging keeper is not a monopoly. Residual: the vault **can lose money**. We will not advertise APY. If LPs need a story that looks like T-bills, they should not be in this vault.

### Basis risk between venues

**The objection.** Two “same” markets, two prints, two outcomes.

**Rebuttal.** That is a disclosed property of oracle-equivalent settlement, not a bug. Single-venue users get their local print. CSN holders (when that exists) eat the off-diagonal unless a reserve is funded. Routing will show the oracle name. We will not net maker inventory across venues on ATM events until we have a measured band.

### Liquidity fragmentation

**The objection.** Multi-chain is how you take one thin book and make three.

**Rebuttal.** Cold start per chain; same grids so books *can* be compared; CSN later; do not route to empty venues; Hyperliquid paused so we do not pretend a fourth book exists. Residual: until CSN, a maker who insists on quoting two chains holds twice the capital.

### UX novelty

**The objection.** People who want options already have Deribit. People who want yes/no already have Polymarket. A “ticket” is a gimmick.

**Rebuttal.** The ticket is a compiler, not a gimmick: it is the only way to hit a CLOB without teaching ticks. If nobody prints one, the objection wins. If they print and cannot exit, the objection also wins. Novelty is a risk we take on the first screen, not on settlement.

### Other unmitigated risks (from the threat model)

USDC issuer freeze (Circle can blacklist the Book). Chain halt / reorg. Pyth or Chainlink outage beyond the void path. Frontend RPC lying (mitigated by reading the explorer; not eliminated). Wallet compromise. Unaffected: owner cannot move user funds or change an outcome.

---

## Go-to-market

### Sequence

1. **Hackathon.** Prove the ticket, the onchain book, and the multi-chain claim with *honest* status. Tracks we actually fit: Base, Arbitrum, Solana / Colosseum, cross-chain infra, consumer. Submission copy: [submission.md](./submission.md).
2. **Testnets, Base Sepolia + Arbitrum Sepolia first.** Solana devnet deployment is reported as a side line (28 seeded markets historically; current count unverified). Do not wait on Hyperliquid. Keepers record, resolve, refresh. Soak settlement across Chainlink and Pyth on the same \(\kappa\).
3. **Public testnet app.** Serious default, UwU if original mascots are ready; otherwise Serious only. Shareable tickets. Faucet. “Soon” on Hyperliquid.
4. **Partners, in the order we actually use them.** Chainlink (Base/Arb settlement). Pyth (Solana settlement). Circle (USDC + CCTP, *after* we are ready to talk about surplus, not as a sticker). Wallet standards we already speak: Wallet Standard on Solana, injected EVM.
5. **Audit, legal, Safe, caps.** Then mainnet on **Base and Arbitrum first** — that is where we can list into native USDC without asking the user to learn a new chain for the product. Solana mainnet is a subsequent listing of the same \(\kappa\), not a rewrite. HyperEVM is a subsequent listing if and when unpaused.

### Acquisition, stated as experiments

- Ticket screenshots in crypto-native channels (UwU *and* Serious; different channels).
- One well-known market per week (“Friday SOL”) rather than 200 empty strikes.
- LP conversations with people who already MM binaries or prediction books, with the threat model in the first email.
- If three independent LPs will not rest quotes without token emissions, the liquidity thesis is failing.

---

## Roadmap

Dates are order, not promises. Metrics are what we would actually look at.

| Stage | Milestones | Metrics |
|---|---|---|
| **H0 — now** | Base v2 and Arbitrum v1 deployed (150 / 81 total series at the snapshot). Solana deployment reported (28 seeded; fresh reads unavailable). App ticket flow. Paper + this thesis. Hyperliquid paused. | Public bytecode on Base/Arb Sepolia; #devnet tickets; void rate; keeper liveness |
| **H1 — testnet soak** | Live Base Sepolia + Arbitrum Sepolia Books; adapters in the app; shared grids; settlement comparison table (Pyth vs Chainlink on the same \((A,T)\)) | Fill rate; time-to-resolve; print \(\lvert P_A-P_B\rvert\) near ATM; maker PnL (can be negative) |
| **H2 — product complete on testnet** | Serious + UwU both shippable; shareable ticket; faucet UX; positions/claim; vault deposit UI that states loss | Returning wallets; tickets posted; mode split; support load |
| **H3 — CSN spec freeze** | Receipts as tokens; burn preserves local solvency; fuzz vs existing invariants; disagreement policy on paper | Invariant suite green; no unbacked mint in tests |
| **H4 — CSN / teleport testnet** | Solver path: destination $1 first; CCTP after surplus | Surplus redeem success; basis events vs reserve |
| **H5 — mainnet gate** | Audit, legal, Safe, Circle USDC, geoblock, caps on, pause-new-risk understood | External audit report; counsel memo; cap utilisation |
| **H6 — mainnet Base + Arbitrum** | Same \(\kappa\), native USDC, production feeds | Premium volume; LP NAV; void rate; incident count |
| **H7 — Solana mainnet listing** | Same keys | Cross-venue quote share; not depth-for-its-own-sake |
| **H8 — HyperEVM if unpaused** | Windowed oracle documented in-product as weaker | ATM volume *not* concentrated on HyperEVM until the window is reviewed |

Kill criteria: no fills after a public testnet; vault NAV monotonically down with no flow; legal “do not list”; oracle disagreement that we cannot explain in one sentence.

---

## What we built

As of **2026-10-11 18:36 UTC**. Testnet tUSDC only; unaudited; mainnet is not live. Website: [Kairo](https://kairo-nu-red.vercel.app); [GitHub](https://github.com/argenestel/kairo). Counts include registered series, not necessarily open or liquid books. Bytecode confirms deployment, not successful trading or settlement.

| Component | Verified status | Address / evidence |
|---|---|---|
| Base Sepolia (84532) | **LIVE**, current v2 manifest; **150 registered series** from Book | [Book `0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659`](https://sepolia.basescan.org/address/0xb4D664BCfAE26E9C6F40C880b2A1ebA1FF09C659) |
| Arbitrum Sepolia (421614) | **LIVE**, existing v1 manifest; **81 registered series** from Book; v2 fixes not assumed deployed | [Book `0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e`](https://sepolia.arbiscan.io/address/0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e) |
| Solana devnet | **Reported live on devnet** — 28 seeded markets and keeper running per manager; fresh program/market reads failed (public RPC 429 / CLI transport error). Current market count and keeper liveness are not independently confirmed. | [Program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`](https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet) |
| Stocks / ETFs | **29 tickers** in Base v2 manifests; **keeper-reported demo oracle**; hub bytecode present. Fresh equity price/settlement liveness not measured | Pyth path built; API key absent; signed equity updates still need acceptance/entitlement verification |
| Event markets | **DEPLOYING** — optimistic resolver built and fork-rehearsed; no live event resolver in either current manifest | Bonded assertion → challenge window → owner-EOA arbitration on testnet; no live event trading claimed |
| Hyperliquid / HyperEVM | **PAUSED** — planned/in-progress; not live or routable | Disabled “Soon”; HyperCore windowed record is a proposed weaker settlement path |
| UI / canonical keys / routing | Implemented in source, website responds HTTP 200; Serious and UwU copy exist; browser trading E2E unverified | UI modes report empty; app-e2e report missing at this snapshot |
| Model maker | Deployed components; active quotes and continuous keeper operation not verified by this refresh | Solana `refresh_quotes`, EVM MakerVault; inventory remains local |
| CSN / teleport / cross-venue maker netting / disagreement reserve | **PROPOSED, not built** | Paper §6 |
| Mainnet | **NOT LIVE** | Audit, operational hardening and production collateral/oracles required |

Ground truth and reproducible commands: [verification record](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md). Historical reports and `montions-base/docs/EVM.md` contain v1 Base addresses and 63-series snapshots; current manifests and fresh RPC reads supersede them.

### Known limitations

- **Solana H1:** the per-market maker cap ignores inventory; fills plus repeated refresh can exceed intended treasury exposure. Planned fix: inventory-aware exposure accounting.
- **Solana H2:** no global maker cap; permissionless market creation and refresh can lock treasury across many markets. Planned fix: global and per-asset budgets and restricted/rate-limited refresh.
- **Solana M3:** the sponsored Pyth settle-window fallback permits choosing among prints on opposite sides of a strike. Planned fix: strict first-print settlement and snapshot oracle rails at market creation.
- **Solana M4:** cheap orders can fill the 64-order / 24-seat tables and deny liquidity. Planned fix: larger/paged books, minimum notional and a reserved maker seat.
- **Solana M5:** permissionless refresh plus POST_ONLY skips can leave the maker one-sided. Planned fix: keeper-only or rate-limited refresh and an all-or-nothing quote ladder.
- **Other Solana findings:** non-positive prints can force void; admin changes to live confidence/window parameters can affect settlement; self-trade refunds remain in seats until withdrawn. Planned fixes include immutable market rails and clearer withdrawal handling. These are unresolved review findings, not a mainnet-safe implementation.
- **EVM review #1/#2/#6:** heartbeat-aware quoting, asset/strike restrictions and phase-upgrade protection are reported fixed in source. Base has a new v2 manifest, but this refresh does not attest deployed runtime equivalence or policy settings. Arbitrum retains its earlier v1 addresses: stale-price pickoff and phase-history risks remain until an onchain upgrade/redeploy is verified. Chainlink proxy phase changes may cause a fail-closed 50/50 void.
- **EVM review #3:** shared-grid seeding is reported fixed offchain, but equal keys on every venue are not guaranteed by deployment or total counts. Crypto asset coverage differs (SOL on Solana, LINK on EVM), and spot-centred windows can still differ; route only identical keys.
- **EVM review #8:** an unhealthy feed can still abort the ladder-rolling path (`readAssets` throws); per-asset continuation remains a planned fix. Keeper uptime, backlog catch-up and quote coverage were not verified.
- **EVM review #9:** inherited shell xtrace can expose operator secrets during extraction; disable tracing before secret handling. No secret material belongs in documentation.
- **EVM review #10:** tUSDC owner mint and deployer-EOA administration are testnet trust assumptions. Proxy compatibility, residual config consistency and Book bytecode size need release checks. Plan multisig ownership and production collateral before mainnet.
- **EVM review #4/#5:** rehearsal manifest isolation and longer round-search continuation are reported fixed in source; that does not establish continuous keeper operation. **#7:** HyperCore first-recorder timing/staleness risk remains a design limitation; Hyperliquid is paused.
- **Stocks/events:** equities use a keeper-reported demo oracle, not verified Pyth equity settlement; the API-key-gated Pyth path is not live. Events are deploying; the planned testnet arbitrator can choose an outcome and seize dispute bonds. Do not extend price-market owner guarantees to event arbitration.

Sources: [Solana review](https://github.com/argenestel/kairo/blob/main/.orchestra/out/sol-review-grok.md), [EVM review](https://github.com/argenestel/kairo/blob/main/.orchestra/out/evm-review-grok.md), [source-fix report](https://github.com/argenestel/kairo/blob/main/.orchestra/out/evm-fix-grok.md), and [verification record](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md). Review/source fixes are not a professional audit.

---

## Appendix A — Glossary

Short form; full: [docs/glossary](../docs/glossary.md).

**Binary / digital.** Pays $1 or $0, not a vanilla call’s linear payoff.

**Canonical event / key.** `(asset, strike, expiry[, comparator])`; UI `SYMBOL:strike:expiry`.

**Collateral-local.** Each venue holds 100% of its own USDC-style collateral.

**Contingent-surplus netting (CSN).** Proposed: unpaired YES on A + unpaired NO on B worth $1 in agreeing states, paid after settlement.

**First print.** First oracle observation with timestamp ≥ expiry.

**MakerVault / protocol maker.** Model-priced ladder around \(N(d_2)\), capped.

**Ticket.** Sentence + budget, compiled to a CLOB order.

**Void.** 50/50 redemption when no valid print arrives by `VOID_GRACE`.

**YES / NO.** Token that pays $1 if the event is true / false.

---

## Appendix B — Sources

Retrieved 11 October 2026 unless noted.

1. Original thesis: `montions/docs/THESIS.md` (incl. 10 Oct 2026 research notes; X quotes there unverified).
2. Specs: `montions/docs/SPEC.md`, `montions/docs/THREAT_MODEL.md`, `montions-sol/docs/SPEC.md`, `montions-base/docs/ONCHAIN.md`, `montions-base/docs/BASE.md`.
3. Technical paper: [Canonical Events](../cross-chain-options.md).
4. DefiLlama options overview and protocol summaries, `https://api.llama.fi/overview/options`, `https://api.llama.fi/summary/options/derive` (premium volumes).
5. DefiLlama DEX volumes (Kalshi, Polymarket US, Polymarket International, etc.), `https://api.llama.fi/overview/dexs`.
6. DefiLlama fees: Kalshi, Polymarket, Hyperliquid, Derive, `https://api.llama.fi/summary/fees/{slug}`.
7. DefiLlama stablecoins, USDC (`stablecoin/2`) chain balances, date 11 Oct 2026 00:00 UTC, `https://stablecoins.llama.fi/stablecoin/2`.
8. DefiLlama protocol TVL: Polymarket, Hyperliquid, `https://api.llama.fi/protocol/{slug}`.
9. Deribit public API: `get_book_summary_by_currency` (BTC, ETH options), `get_index_price`, `https://www.deribit.com/api/v2/public/…`.
10. Hyperliquid info API `POST https://api.hyperliquid.xyz/info` `{"type":"metaAndAssetCtxs"}` (day notional, OI).
11. Polymarket `https://data-api.polymarket.com/oi`; Gamma `https://gamma-api.polymarket.com/markets`.
12. Circle CCTP supported chains: `https://developers.circle.com/cctp/cctp-supported-blockchains` (page dateModified 2026-10-05).
13. Derive, “What is an onchain crypto options protocol?”, 29 Aug 2026; “Are crypto options legal in 2026?”, 25 Aug 2026; “How do decentralized crypto options work?” — `https://www.derive.xyz/blog/…`.
14. Hyperliquid HIP-4 outcome markets, HIP-3 builder-deployed perps — Hyperliquid docs.
15. ESMA binary-options product intervention (2018): `https://www.esma.europa.eu/` (ESMA agrees to prohibit binary options).
16. FCA, permanent ban on sale of binary options to retail consumers, 2 Apr 2019: `https://www.fca.org.uk/news/press-releases/fca-confirms-permanent-ban-sale-binary-options-retail-consumers`.
17. ASIC product intervention on binary options (2021): `https://asic.gov.au/`.
18. Kalshi: CFTC-regulated DCM, `https://kalshi.com/`.
19. Hunch product: `https://hunch.cool/`. Dream: `https://dreamos.app/`.
20. OCC / CBOE volume tables: **not retrieved** (HTTP 403 on 11 Oct 2026). No 2026 OCC figure is used.

[^derive-perps]: Derive, “What is an onchain crypto options protocol?”, 29 Aug 2026, <https://www.derive.xyz/blog/what-is-an-onchain-crypto-options-protocol/>.

[^derive-legal]: Derive, “Are crypto options legal in 2026?”, 25 Aug 2026, <https://www.derive.xyz/blog/are-crypto-options-legal-in-2026/>.

[^cctp]: Circle, “Supported blockchains and domains”, <https://developers.circle.com/cctp/cctp-supported-blockchains> (retrieved 11 Oct 2026; dateModified 2026-10-05).

[^hip4]: Hyperliquid HIP-4, “Outcome markets”, <https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets>.

[^esma]: ESMA, product intervention measures on binary options for retail clients, 2018, <https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options>.

[^fca]: FCA, “FCA confirms permanent ban on sale of binary options to retail consumers”, 2019, <https://www.fca.org.uk/news/press-releases/fca-confirms-permanent-ban-sale-binary-options-retail-consumers>.

[^asic]: ASIC, product intervention order — binary options, 2021, <https://asic.gov.au/>.
