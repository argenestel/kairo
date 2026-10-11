# Canonical Events

**Fully collateralised binary options with oracle-equivalent settlement and contingent-surplus netting**

Montions · 11 October 2026 · v0.1.0

---

## Abstract

Options and prediction-market liquidity are siloed per chain. Each venue has its own oracle and its own notion of “the price at expiry.” Bridging collateral to unify books adds credit and attestation risk while a ticket is still open.

This paper specifies **Canonical Events**: a chain-agnostic market identity, a shared **first-print** settlement rule that each oracle class proves or approximates onchain, and fully collateralised local books so that nothing cross-chain is ever under-collateralised. A market is the tuple `(asset, strike, expiry, comparator)`. The same key is listed on every venue. Users type a sentence (“SOL above $120 by Friday, $100”); the UI routes the ticket to the best live book.

The new primitive is **contingent-surplus netting (CSN)**. On a venue, YES+NO pairs are backed by $1. Burning a YES on venue A without its NO leaves A over-collateralised by $1 *if YES wins*. Burning a NO on venue B leaves B over-collateralised by $1 *if NO wins*. The two receipts together are worth exactly $1 in every *agreeing* state, paid after settlement from whichever venue holds the surplus (message proof + USDC transfer). Position teleport and cross-venue maker netting are the same receipt with different counterparties.

We state the accounting invariants, work numeric examples, quantify near-strike basis risk when oracles disagree, and define a disagreement reserve. Implementation status is separated on purpose: per-venue CLOBs, collateral, settlement, canonical keys and a routing UI are live or shipping on testnets; CSN, teleport and cross-venue maker netting are proposed and not built.

---

## 1. The problem

Retail already trades two things at scale: perpetual futures (asymmetric upside, unbounded loss) and prediction markets (yes/no, price = probability). An option is the product in between — bounded loss, asymmetric payoff — sold through an interface built for market makers (strike chains, implied vol, greeks) on venues that do not compose.

Onchain, the same gap appears as **silos**:

1. **Liquidity is per chain.** A SOL-above-$120 book on Solana does not fill an order on Base. Makers duplicate inventory or simply do not quote the second venue.
2. **Settlement is per oracle.** “Was SOL ≥ $120 at Friday 16:00 UTC?” is not a well-defined onchain question until you name the feed and the timestamp rule. Chainlink’s first *round* after `T`, Pyth’s first *signed print* after `T`, and HyperCore’s *current* `oraclePx` sampled in a window are different random variables. Near the strike they can disagree.
3. **Bridging collateral is the wrong time to take credit risk.** Locking USDC in a lockbox, waiting on an attestation, and minting a synthetic on the destination means the ticket is open against a messenger, not against a fully funded book. A reorg, attestation stall, or issuer freeze during that window is not an options risk; it is a bridge risk.

Existing options protocols do not solve this combination. Derive (formerly Lyra) runs a vanilla CLOB with portfolio margin on its own stack.[^derive] Aevo matches offchain and settles on a custom OP-Stack L2.[^aevo] Opyn’s oTokens are cash-settled per deployment.[^opyn] Premia is an AMM. Panoptic is a perpetual option on Uniswap LP with no expiry and no external settlement oracle.[^panoptic] Polymarket’s Conditional Token Framework positions are ERC-1155 on a single settlement domain (Polygon / V2 ledgers), resolved by an oracle adapter (historically UMA).[^polymarket] Kalshi is a CFTC-regulated DCM: one venue, one rulebook.[^kalshi] Hyperliquid HIP-4 outcome markets are fully collateralised binaries on HyperCore, with merged YES/NO books, settling to HyperCore mark prices — a sibling product, not a cross-chain one.[^hip4]

Montions’ claim is narrower. Keep every book **100% collateralised in local USDC**. Identify the *event* once. Implement the same *timestamp rule* on each oracle class, honestly, including the cases where the oracle cannot prove it. Only after settlement, if at all, move a dollar that is already a leftover.

---

## 2. The binary atom

A **contract** is a claim on $1 of 6-decimal collateral (`UNIT = 1_000_000`).

- **YES** pays $1 if the event is true at settlement, else $0.
- **NO** pays $1 if the event is false, else $0.
- While a market is open, every YES is paired with a NO against $1 in the pool:

\[
\texttt{pool} = (\texttt{yes\_supply}) \cdot \$1 = (\texttt{no\_supply}) \cdot \$1.
\]

The **price** of YES is an implied probability \(p \in \{0.01,\ldots,0.99\}\) (ticks 1–99¢). NO costs \(1-p\). Maximum loss on a long is the premium. There is no margin engine, no liquidation, no insurance fund, no socialised loss. Matching and settlement are atomic in one program/contract.

This is a cash-or-nothing digital, not a vanilla call. A vanilla call is a stack of binaries across strikes; those can be composed later from the same books. The interface never mentions delta.

**Outcome-first UX.** The user does not pick a series id. They state a payoff:

> “I think SOL will be above $120 by Friday. I’ll risk $100.”

The app compiles that to `(SOL, 120, T, above, budget=100)`, quotes every venue that lists the canonical key, and submits a buy of YES (or NO, if *below*) against the selected book.

**Worked ticket.** Strike $120, Friday 16:00 UTC, budget $100, best ask 41¢, 400 contracts on the ask.

- Fill 243 YES at 41¢ (if the level is deep enough; otherwise walk the book).
- Cost \(243 \times \$0.41 = \$99.63\). Max loss = $99.63.
- Payout if right: $243. Profit if right: $143.37.
- A writer who sold those 243 YES locked \(243 \times \$0.59 = \$143.37\) and received 243 NO.
- Pool increase: $243. YES supply +243, NO supply +243.

Prices are maker ticks. Taker fee is zero by default (hard cap 100 bps). Self-trade prevention cancels the taker’s own resting order rather than filling it.

---

## 3. Canonical events

A **canonical event** is identified chain-agnostically.

**Definition 1 (event).** Let \(A\) be an asset symbol (e.g. `SOL`), \(K \in \mathbb{Q}^+\) a strike in USD, \(T \in \mathbb{N}\) a unix timestamp (UTC seconds), and \(\bowtie \in \{\ge, >\}\) a comparator. The event is

\[
\kappa = (A,\, K,\, T,\, \bowtie).
\]

Montions production markets use \(\bowtie = \ge\). The complementary bet “below \(K\)” is a buy of NO on the same \(\kappa\), not a second event. The UI key omits the comparator:

```
canonicalMarketKey(A, K, T) = `${A}:${K}:${T}`   // e.g. SOL:120:1760000000
```

**Definition 2 (venue listing).** A venue \(v\) *lists* \(\kappa\) if it exposes a book whose settlement predicate is “YES iff \(P_v(\kappa) \bowtie K\)”, where \(P_v(\kappa)\) is venue \(v\)’s settlement print for \((A,T)\) under §4. Collateral, matching, and outcome tokens are local to \(v\).

**Definition 3 (alignment).** Two listings are *aligned* if they share \((A, K, T, \bowtie)\), the same strike grid, and the same expiry schedule. Routing that compared `SOL:120:T` on Solana with `SOL:119:T` on Base would be a bug, not a basis.

Intended grids (every chain): BTC $500, ETH $25, SOL $1. Expiries snap to a 5-minute unix grid on Solana (`EXPIRY_GRID = 300`); EVM venues are required to use the same schedule so keys coincide. Weekly listings target Friday 16:00 UTC.

On Solana the market PDA is `["market", asset, strike_le, expiry_le]` — the chain-local id is a function of \(\kappa\). On EVM, `seriesId = keccak256(abi.encode(resolver, data, expiry))` with `data` binding `(oracle, assetId, strikeWad, above, maxDelay)`. The *canonical* key is still \(\kappa\); the series id is a venue handle. `maxDelay` is forced equal to the oracle’s registered settle delay so that `(asset, expiry)` has one canonical series per resolver.

![One event, four local books](figures/canonical-events.svg)

**Worked keys.** `SOL ≥ 120` at `T = 1760001600` (a Friday 16:00 UTC):

| Venue | Handle | Collateral | Oracle class |
|---|---|---|---|
| Solana devnet | PDA of `(SOL, 120e8, T)` | tUSDC | Pyth |
| Base Sepolia | `seriesId` of Chainlink resolver data | tUSDC | Chainlink |
| Arbitrum Sepolia | same layout, different feed | tUSDC | Chainlink |
| HyperEVM 998 | same Book, HyperCore resolver data | tUSDC | HyperCore |

All four are \(\kappa = (\texttt{SOL}, 120, T, \ge)\). A quote of “best venue” compares books of this \(\kappa\) only.

---

## 4. Oracle-equivalent settlement

**Definition 4 (first print).** Let \(F\) be an oracle feed for \(A\) that emits observations \((t_i, p_i)\) with non-decreasing timestamps. The **first print at or after \(T\)** is \(P = p_{i^*}\) where \(i^* = \min\{i : t_i \ge T\}\), or \(\bot\) if no such observation arrives in the allowed window.

YES iff \(P \ge K\) (when \(P \ne \bot\)). If \(P = \bot\) after `VOID_GRACE`, the market **voids**: each outstanding token redeems for $0.50.

This is the shared *semantic*. Each oracle class **proves or approximates** it with the primitives the chain actually has. The approximation is part of the spec, not a footnote.

![First-print proofs](figures/settlement-proofs.svg)

### 4.1 Chainlink — round adjacency (exact)

Chainlink Data Feeds update in **rounds**. A proxy round id is `(phaseId << 64) | aggregatorRoundId`. Inside a phase, aggregator round ids are contiguous and `updatedAt` (transmission time) does not decrease.[^cl-hist] Therefore, in the current phase, there is at most one round \(R\) such that

\[
\texttt{updatedAt}(R) \ge T \quad\text{and}\quad \texttt{updatedAt}(R-1) < T.
\]

`ChainlinkSettlementResolver.record(feed, expiry, roundIdHint)` checks, onchain:

1. `block.timestamp > expiry`; feed is registered; not already recorded.
2. Hint is in the proxy’s **current** phase; aggregator round \(\ne 0\).
3. `getRoundData(R)` is complete, `answeredInRound ≥ R`, `updatedAt ∈ [expiry, now]`.
4. If aggregator round \(> 1\): predecessor `R-1` is complete and `updatedAt(R-1) < expiry`.
5. If aggregator round \(= 1\) and `phase > 1`: **reject** — no predecessor through the proxy (phase change). The series is never recorded and voids after grace.

Anyone may record; a wrong hint reverts; the first valid record is final. `findRound` / `recordFirstRound` compute \(R\) onchain (galloping search, then binary search). `maxDelay` (the asset’s one-time `settleDelay`) rejects a first round that lands later than `expiry + maxDelay` (stalled feed). Non-positive answers and `decimals > 18` are invalid.

Residual trust: Chainlink’s oracle network and the proxy owner (who can point the proxy at a new aggregator). Feed registration in `ChainlinkOracle` is one-time; the owner cannot retarget an existing asset.

**Worked record.** ETH/USD, `T = 16:00:00`, rounds:

| Round | `updatedAt` | Answer (8 dec) |
|---|---|---|
| \(R-1\) | 15:59:41 | 2_506_88000000 |
| \(R\) | 16:00:08 | 2_507_12000000 |

Hint \(R\) succeeds. \(P = \$2507.12\). For strike $2500, YES. For strike $2510, NO. Hint \(R-1\) reverts `RoundBeforeExpiry`. Hint \(R+1\) (if `updatedAt(R) ≥ T`) reverts `NotFirstRound`.

On Base Sepolia, listed feeds often update every 10–20 minutes; Arbitrum Sepolia ETH/USD is ~60 s, BTC/USD ~30 s. That heartbeat *is* the first-print lag on those testnets.

### 4.2 Pyth — `prev_publish_time` (exact when posted)

A Pyth `PriceUpdateV2` (Solana receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`) carries `price`, `conf`, `exponent`, `publish_time`, `prev_publish_time`. Full verification only.

**Exact first print**, accepted even outside the short window:

\[
\texttt{publish\_time} \ge T \quad\text{and}\quad \texttt{prev\_publish\_time} < T.
\]

That is the onchain statement “this is the first Pythnet/Pro print at or after \(T\).” Confidence must satisfy `conf * 10_000 ≤ max_conf_bps * |price|` (devnet 200 bps = 2%). Price is scaled to 1e8; YES iff `price_e8 ≥ strike`.

**Sponsored-feed window.** Devnet push accounts update every ~1–5 s and do not always present a unique posted first print. If the first-print predicate fails, the update is accepted only when `publish_time ∈ [T, T + settle_window]` with `settle_window = 60` s. A keeper typically resolves within seconds; anyone may resolve earlier. **This path lets the resolver pick a print inside the window.** It is documented in the Solana spec and in the UI settlement note. It is not the same object as `prev_publish_time < T ≤ publish_time`.

EVM `PythSettlementResolver` calls `parsePriceFeedUpdatesUnique` and stores the first update in `[T, T+300]`. Invalid or over-confident prices are stored as invalid; the Book then voids after grace rather than settling on garbage.

Residual trust: Pyth publishers, aggregation, and the receiver upgrade key. Hermes currently requires an API key for pull; Solana **devnet sponsored accounts do not**. Pyth is not deployed on Solana testnet — Montions uses **devnet**.

**Worked print.** SOL, `T = 16:00:00`, `settle_window = 60`.

- Update with `prev_publish_time = 15:59:59.4`, `publish_time = 16:00:00.2`, price $121.40, conf 0.3% → accepted as first print, YES vs $120.
- Sponsored account at 16:00:04 showing $119.80, not proven first-print, inside the 60 s window → accepted on the window path, NO vs $120. A later first-print proof would have been preferred; the first successful `resolve` wins.

### 4.3 HyperCore precompile — windowed record (approximate)

HyperEVM exposes HyperCore state through read precompiles starting at `0x…0800`. Oracle prices are `oraclePx(uint32 perpIndex)` at `0x0000000000000000000000000000000000000807`, returning `uint64`. Conversion: \(\texttt{price} = \texttt{raw} / 10^{6 - \texttt{szDecimals}}\) for perps.[^hl-precompile] Values match HyperCore at the time the EVM block is constructed. There is **no timestamp and no history**.

Verified on HyperEVM testnet (chain 998) at the time of writing: index 0 ≈ SOL 109.70 (`szDecimals` 2), index 3 ≈ BTC 83155 (`szDecimals` 5), index 4 ≈ ETH 2506.88 (`szDecimals` 4). Universe + `szDecimals` from `POST https://api.hyperliquid-testnet.xyz/info` `{"type":"meta"}`.

**Settlement.** Permissionless `record(assetId, expiry)` succeeds only if

\[
T \le \texttt{block.timestamp} \le T + W
\]

and nothing is stored yet for `(assetId, expiry)`. It stores `oraclePx` at that block. First recorder wins. \(W\) default 60 s, hard cap 300 s. `resolve` reads the store; otherwise not-ready → void after `VOID_GRACE` (2 days on the EVM Book).

This is **not** a first-print proof. It is “the price HyperCore showed when someone first called `record` inside the window.” Mitigation: short \(W\), keeper in seconds, anyone can record (so a stalled keeper is not a monopoly — but the *first* caller still chooses the moment). Residual trust: HyperCore’s oracle, HyperBFT, and recorder latency.

**Worked record.** \(T = 16:00:00\), \(W = 60\), strike $120. Keeper records at 16:00:02, raw SOL `1214000`, `szDecimals = 2` → \(P = 1214000 / 10^{4} = 121.40\) → YES. A searcher who recorded at 16:00:00.3 with \(P = 119.9\) would have won the race and settled NO. That race is the honest attack surface.

### 4.4 Equivalence band

Let \(P_A, P_B\) be settlement prints for the same \((A,T)\) on venues \(A,B\).

**Construction.** Different publisher sets and aggregators (Chainlink DON vs Pyth vs HyperCore mark/oracle). Even at identical timestamps, \(P_A \ne P_B\) in general. For liquid majors the typical discrepancy is small relative to dollar strikes (dollars on BTC, dollars on ETH, cents on SOL), but binaries care only about the side of \(K\).

**Timing.** First-print lag is bounded by the feed’s heartbeat / publish interval, not by Montions:

| Venue (testnet) | Typical freshness | First-print lag bound |
|---|---|---|
| Solana Pyth sponsored | 1–5 s | 60 s window fallback |
| Arbitrum Sepolia Chainlink ETH | ~60 s | one heartbeat after \(T\) |
| Arbitrum Sepolia Chainlink BTC | ~30 s | one heartbeat |
| Base Sepolia Chainlink | ~10–20 min | `settleDelay` (rehearsal: 3600 s) |
| HyperEVM HyperCore | L1 block | recorder time \(\le W\) (60 s) |

**Near-strike disagreement.** Suppose \(S_T \approx K\) and venue B’s print is \(\Delta t\) later. Under a rough GBM with annualised vol \(\sigma\), a 1σ move is \(K \sigma \sqrt{\Delta t / 31536000}\).

**Worked band.** SOL = $120, \(\sigma = 80\%\).

| \(\Delta t\) | 1σ move | If \(\|S_T - K\| = \$0\) | If \(\|S_T - K\| = \$1\) |
|---|---|---|---|
| 1 s | ≈ $0.017 | coin-flip if the second sample is used | disagreement ≈ 0 |
| 60 s | ≈ $0.13 | high | \(z \approx 7.7\), negligible |
| 10 min | ≈ $0.41 | high | \(z \approx 2.4\), ~1% |

So **basis risk is concentrated in a few ticks around the strike**, and it is much worse on a 10–20 minute Chainlink heartbeat than on Pyth. That is a property of the testnet feeds, not of the Book. Mainnet heartbeats are a different table; the *rule* (first round / first print) does not change.

When venues disagree, each market still pays 1:1 against its own pool. Holders of a single venue’s YES/NO are not cheated. Cross-venue structures (CSN, teleport) are the objects that see the basis — §6.6.

**Voids.** \(P = \bot\) is also a disagreement. Chainlink phase boundaries, Pyth confidence failures, HyperCore missed windows, and stalled keepers all collapse to 50/50 after grace (24 h Solana, 2 days EVM). Funds are not stuck.

---

## 5. Collateral-local, liquidity-global

**Invariant (local solvency).** For every open market on every venue,

\[
\texttt{USDC.balance(venue)} \ge \sum \texttt{cash} + \sum \texttt{locked} + \sum \texttt{pool} + \texttt{fees}.
\]

On Solana the analogous statement is `vault.amount == Σ seat.cash + Σ seat.locked + pool + fees`. There is no lockbox, no minted-unbacked synthetic, no in-flight CCTP in the matching path. A ticket that fills on Base is a Base liability, paid from Base tUSDC.

**Liquidity-global** is then a *routing and quoting* property, not a shared pool:

1. **Best-venue routing.** The UI asks every adapter for `quote(κ, direction, budget)` and prefers the tradable quote with the most contracts per dollar (subject to slippage). See Figure 4.
2. **One model, many books.** Fair value is the same digital \(N(d_2)\) on every venue (zero rate, configured or realised vol). A maker who believes the model can quote the same centre on Solana, Base, Arbitrum and HyperEVM. Inventory is still local until §6.
3. **Cross-venue inventory netting (proposed).** A maker long YES on A and long NO on B is economically flat on \(\kappa\) up to oracle basis. CSN is how they collapse that inventory without bridging while the ticket is open.

![Routing a ticket to a local book](figures/routing.svg)

**Worked routing.** Same \(\kappa\), budget $100, buy YES:

| Venue | Best ask | Depth | Contracts for $100 | Tradable |
|---|---|---|---|---|
| Solana | 41¢ | 400 | 243 | yes |
| Base | 44¢ | 90 | 204 at 44¢, then worse | yes, worse |
| HyperEVM | — | 0 | 0 | no |

Router selects Solana. The user must have SOL gas and tUSDC **on Solana**. The app does not bridge the $100.

---

## 6. Contingent-surplus netting

This section is **proposed**. The live Book/program only `split`/`merge` complete pairs. Unpaired burns, surplus receipts, and cross-chain messages are not implemented. The accounting is written so it can be added without relaxing local solvency.

### 6.1 Surplus

Start from the open-market invariant \(\texttt{pool}/\$1 = y = n\) (yes supply, no supply). Introduce **surplus counters**:

\[
S_Y = \frac{\texttt{pool}}{\$1} - y, \qquad S_N = \frac{\texttt{pool}}{\$1} - n.
\]

Initially \(S_Y = S_N = 0\).

**Definition 5 (unpaired burn).** `burn_yes(q)` sets \(y \leftarrow y - q\), \(S_Y \leftarrow S_Y + q\), and mints \(q\) **YES-receipts** (CSR-Y). `burn_no(q)` is symmetric. Pool USDC does not move.

**Invariant 1 (open, after unpaired burns).**

\[
\frac{\texttt{pool}}{\$1} = y + S_Y = n + S_N.
\]

*Proof.* Split/merge change \(y,n,\texttt{pool}\) together. A YES burn decreases \(y\) by \(q\) and increases \(S_Y\) by \(q\). A NO burn decreases \(n\) and increases \(S_N\). Matching that mints a pair increases \(y,n,\texttt{pool}/\$1\) by the same \(q\). Matching that burns a pair (held-YES vs held-NO) decreases all three. □

**Proposition 1 (settlement of surplus).**

- If the venue resolves **YES**: remaining YES redeem \(y\) dollars; leftover \(\texttt{pool}/\$1 - y = S_Y\). Pay $1 per CSR-Y. CSR-N pays 0.
- If **NO**: leftover \(S_N\); pay $1 per CSR-N. CSR-Y pays 0.
- If **void**: remaining tokens redeem at $0.50. Leftover is \(\texttt{pool} - 0.5(y+n)\$1 = 0.5(S_Y+S_N)\$1\). Pay $0.50 per CSR-Y and $0.50 per CSR-N.

*Proof.* From Invariant 1, \(\texttt{pool}/\$1 = y + S_Y\) and \(= n + S_N\). Resolved YES: pay \(y\), leftover \(S_Y\). Void: \(2\cdot\texttt{pool}/\$1 = y+n+S_Y+S_N\), so leftover after 50/50 on \(y+n\) is \(0.5(S_Y+S_N)\). □

Burning a YES without its NO therefore leaves the venue over-collateralised by exactly $1 *if YES wins* (and by $0.50 if void, $0 if NO). That leftover is the **contingent surplus**.

### 6.2 The pair that is always $1 (when oracles agree)

Hold one CSR-Y on venue A and one CSR-N on venue B, both on the same \(\kappa\).

| A \ B | YES | NO | VOID |
|---|---|---|---|
| **YES** | $1 + $0 = **$1** | $1 + $1 = **$2** | $1 + $0.50 = **$1.50** |
| **NO** | $0 + $0 = **$0** | $0 + $1 = **$1** | $0 + $0.50 = **$0.50** |
| **VOID** | $0.50 + $0 = **$0.50** | $0.50 + $1 = **$1.50** | $0.50 + $0.50 = **$1** |

**Proposition 2 (agreeing states).** If A and B report the same outcome (both YES, both NO, or both VOID), CSR-Y_A + CSR-N_B pays exactly $1, from A, from B, or half from each.

*Proof.* Read the diagonal of the table; each cell is Proposition 1 applied independently. □

The off-diagonal is **oracle basis**. Venues remain solvent: each leftover is funded by that venue’s pool (Proposition 1). Nobody’s local YES/NO is shortchanged. The CSN holder eats the $0 cell and enjoys the $2 cell unless a reserve is applied (§6.6).

![Contingent-surplus netting](figures/contingent-surplus.svg)

**Worked merge.** Alice holds 100 YES on Solana (A) and 100 NO on Base (B), same \(\kappa\). She burns both.

- Pool A: was $5000 against 5000 pairs; now \(y=4900\), \(S_Y=100\), \(n=5000\).
- Pool B: \(n=4900\), \(S_N=100\), \(y=5000\).

If both resolve YES: Solana pays Alice $100 (surplus); Base pays $0; her Base NO would have been $0 anyway. If both resolve NO: Base pays $100. If both void: $50 + $50. She has reconstructed a complete set **across venues** without ever bridging USDC while the market was open.

### 6.3 (a) Cross-chain merge

**Mechanism.** A **merge intent** specifies \(\kappa\), quantity \(q\), venue A (YES), venue B (NO). Execution:

1. User burns \(q\) YES on A → \(q\) CSR-Y_A (or a messenger records the burn).
2. User burns \(q\) NO on B → \(q\) CSR-N_B.
3. After both venues settle, a relayer posts the two settlement attestations. Whichever venue has surplus pays, via **CCTP** (USDC burn/mint) or a local credit if the user redeems on that chain.

**Before expiry.** Steps 1–2 only. No USDC moves. Each venue stays solvent by Invariant 1. The user holds two receipts, not $1 cash. A solver may bid for the pair at \(< \$1\) (funding, not under-collateralisation).

**After expiry.** Surplus is deterministic per venue. CCTP moves at most $1 per pair in agreeing states ($2 / $0 if they disagree, before reserve).

Circle CCTP (v2) lists **Arbitrum, Base, HyperEVM, and Solana** as domains (Arbitrum 3, Solana 5, Base 6, HyperEVM 19). Standard Transfer is supported on all four; Fast Transfer on Arbitrum, Base, and Solana; HyperEVM Fast Transfer is N/A.[^cctp] Testnets of listed mainnets are supported. That is the USDC path CSN would use. Message *proofs* of burns can ride CCTP hooks or a general messenger (LayerZero, Hyperlane, CCIP); those layers are not interchangeable with CCTP and are not assumed live on every venue today.

### 6.4 (b) Teleport

Goal: hold YES on B instead of YES on A, same \(\kappa\).

**Post-expiry teleport (settle-anywhere).** After A resolves YES, surplus $1 per burned YES is CCTP’d to B (or to the user’s B wallet). If A resolves NO, the receipt is $0 and nothing is minted. This never mints an unbacked token. It is a **payout location**, not a live position on B’s book.

**Pre-expiry teleport (solver-fronted).** Local solvency forbids minting YES_B without $1 on B.

1. User burns YES_A → CSR-Y_A.
2. Solver splits $1 on B into YES_B + NO_B, sends YES_B to the user, keeps NO_B, and takes CSR-Y_A (or a claim on it).

Payoff for the solver:

| A \ B | Solver PnL vs $1 posted |
|---|---|
| both YES | CSR-Y_A = $1, NO_B = $0 → flat |
| both NO | CSR-Y_A = $0, NO_B = $1 → flat |
| A YES, B NO | CSR = $1, NO_B = $1 → **+$1** |
| A NO, B YES | CSR = $0, NO_B = $0 → **−$1** |

The solver is flat when oracles agree and short the “A loses, B wins” basis. They will quote a spread or demand the disagreement reserve. The user has YES on B from step 2; B’s pool is fully funded by the solver’s $1.

**Worked teleport.** User wants 50 YES on Base, holds 50 YES on Solana, \(T\) in six hours. Solver posts $50 on Base, user receives 50 YES_B, solver holds 50 NO_B + CSR-Y_Solana. If both YES, solver redeems $50 on Solana after CCTP and is whole; user claims $50 on Base. If Solana NO and Base YES, solver is out $50 — that is the premium they charged (e.g. 50¢/contract) or the reserve’s job.

### 6.5 (c) Maker netting

A maker quoting both venues on \(\kappa\) often accumulates YES_A and NO_B (or the opposite) as flow hits different sides. Economically that is a complete set plus basis. Capital: $1 locked on A and $1 on B = $2 for a $1 claim.

**Netting.** Burn the offsetting legs into CSR-Y_A + CSR-N_B. Invariant 1 holds on both venues. Working capital is still locked until settlement *unless* a cash buyer (solver, reserve, other user wanting a $1 bond) purchases the CSN pair for ~$1 now. That sale is an ordinary transfer of receipts; it does not mint unbacked tokens.

**Worked maker.** Vault quoted 41¢ / 45¢ on Solana and Base. After a day: +800 YES Solana, +800 NO Base. Burn 800+800. Pool leftovers: \(S_Y^{\text{SOL}}=800\), \(S_N^{\text{BASE}}=800\). A solver buys the 800 CSN pairs for $792 (1% discount). Maker has $792 cash to requote; solver is long the $1-at-settlement (plus basis). Maker residual: oracle basis and the $8 discount.

### 6.6 Disagreement, who bears it, the reserve

**Rule (venue-local surplus).** Each venue pays its own surplus per its own oracle. This rule does not require a cross-chain outcome vote and cannot brick a solvent venue because the other feed disagreed.

**Who bears basis.**

- Single-venue users: nobody. Their payout is the local print.
- CSN holders of YES_A + NO_B: the $0 cell (A NO, B YES) and the $2 cell (A YES, B NO).
- Teleport solvers: the A-loses-B-wins cell.
- Makers who netted: same as CSN holders.

Near-strike, §4.4 says this is not rare on slow testnet heartbeats. On a 1–5 s Pyth vs 60 s HyperCore window, ATM disagreement over 60 s is the coin-flip row of the table.

**Disagreement reserve.** A pool \(R\) (protocol, bonded makers, or a fee slice) that **makes CSN pay $1 always**:

- If the pair would pay $2: pay $1 to the holder, \(+\$1\) to \(R\).
- If $1: pass through.
- If $0: \(R\) pays $1.
- If $0.50 / $1.50 (one void): pay $1, \(R\) absorbs ±$0.50.

In agreeing states \(R\) does not move. In disagreement, \(R\) is a swap between the $2 and $0 cells. Solvency of \(R\) is a **risk limit**, not a Book invariant: size \(R\) to cover a cap on outstanding CSN notional times a haircut for ATM events (e.g. only underwrite CSN when \(\|S-K\| / (K\sigma\sqrt{\Delta t}) > 3\), else charge the full ATM premium). If \(R\) is empty, fall back to the raw table: holders see $0 or $2.

**Failure modes.**

- **Messaging compromise.** A forged “YES burned on A” must not mint unbacked YES on B. Pre-expiry mint on B always requires $1 on B (solver or user). Post-expiry CCTP relies on Circle’s attestation; a forged *message* without a USDC mint cannot pay. Do not treat LZ/Hyperlane/CCIP as USDC.
- **Replay / double redeem.** CSR is burned on payout; settlement records are unique per `(venue, κ)`.
- **Liveness.** If CCTP or the messenger stalls, surplus remains on the source venue; the holder redeems *there*. Timeout ≠ insolvency.
- **Issuer risk.** Mainnet USDC can be frozen, including a Book.[^usdc] CSN does not remove Circle.

### 6.7 Latency and before vs after expiry

| Action | Before \(T\) | After \(T\), before both settle | After both settle |
|---|---|---|---|
| Trade on one venue | yes | no (`now < T` required) | no |
| Unpaired burn → CSR | yes | yes, until resolve | no (redeem instead) |
| Cross-chain merge (burns) | yes | yes | n/a |
| Solver-fronted teleport | yes | possible until B stops trading | no |
| Settle-anywhere payout | no surplus yet | as each venue resolves | yes, CCTP |
| CSN cash ($1) | only if a solver buys the pair | same | native |

Nothing in the left column moves USDC across chains.

---

## 7. UX

One ticket, four wallets, settle where you traded (settle-anywhere is proposed).

1. **Sentence.** Asset, above/below, strike, expiry, budget. The UI never asks for a series id or a greek.
2. **Route.** Quote \(\kappa\) on every live adapter. Show contracts, avg price, payout, model chance, and the venue’s oracle in one line. “Best venue” is the tradable quote with the highest payout per dollar inside the user’s slippage cap. Illiquid venues are skipped, not silently bridged.
3. **Wallet.** Solana: Wallet Standard. EVM: injected wallet on 84532 / 421614 / 998. Gas and tUSDC must already be on the destination. The faucet is per chain.
4. **Ticket.** Confirm. On Solana, `create_market` + `refresh_quotes` may prepend the first buy so a new strike is not a dead end.
5. **Claim.** After resolve or void, redeem on that chain. Proposed CSN/teleport would add a second screen: “pay me on Base” after Solana YES, against a surplus receipt — not built.

The product remains a sentence. Cross-chain is a routing and capital detail, not a new vocabulary.

---

## 8. Security and threat model

Assets: user collateral, outcome tokens, vault/maker inventory, protocol fees, and (proposed) surplus receipts plus the disagreement reserve.

**Oracle manipulation, per class.**

- *Chainlink.* First-round proof removes timestamp shopping inside a phase. Remaining: a bad DON report at \(R\), proxy upgrade / phase change (void, not attacker-chosen price), and L2 sequencer stalls that push `updatedAt` past `maxDelay` (void).
- *Pyth.* Unique first print removes timestamp shopping when posted. Remaining: publisher set, confidence attacks around 2%, and the **sponsored-window path** (print shopping inside 60 s). Mitigation: keeper in seconds, anyone can resolve earlier, void if over-confident.
- *HyperCore.* Recorder chooses the second inside \(W\). A searcher who can land the first `record` in the window sets \(P\). Mitigation: \(W \le 60\) s, keeper, competition to record — competition does **not** restore first-print uniqueness; it restores liveness. Treat ATM binaries on HyperEVM as recorder-sensitive.

**Settlement-window games.** Binary payoff is discontinuous at \(K\). Spot manipulation at expiry is the classical attack. First-print + void is mitigation, not a cure (same thesis as the original Montions paper). HyperCore’s window is the widest choice set; Chainlink adjacency is the narrowest.

**Messaging-layer compromise.** CSN must not mint unbacked tokens. USDC movement is CCTP (Circle attestation). Burn proofs, if not coupled to a CCTP mint, cannot pay. A compromised LZ DVN / Hyperlane ISM / CCIP DON can lie about a burn; the destination still must not credit USDC on that lie. Griefing: spam unpaired burns to bloat surplus accounting — bound `q`, charge a fee, or require receipts to be claimed.

**MEV on routing.** The UI’s “best venue” is offchain information. A searcher can take the quoted size on that book before the user’s tx (Solana especially). Mitigation: the onchain limit price; not a cross-chain atomic router. Do not promise atomic best-execution across four chains without a solver who posts on the destination first.

**Griefing the Book.** Bounded matching (`maxFills`), quantity caps, allowlisted resolvers, pause-new-risk only (exits always work). Owner cannot move user funds or change an outcome.

**Economics, briefly.** Taker fee 0–100 bps, default 0. Makers earn spread, lose to informed flow. MakerVault / protocol maker: per-market and global exposure caps, no quotes near expiry (`min_tte`), inventory first. Vault depositors can lose money. CSN solvers charge basis premium. Disagreement reserve is a risk book, not yield.

---

## 9. Implementation status

Scrupulously: **testnets**, play-money tUSDC, no professional audit, no mainnet. The original Monad deployment is a separate demo (pool TWAP, labelled MOCK).

| Component | Status | Where |
|---|---|---|
| Solana CLOB + collateral + Pyth settlement | **Live on devnet** | Program `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh`. Seeded markets, keeper running. Spec: `montions-sol/docs/SPEC.md`. |
| EVM Book + Chainlink first-round settlement | **Code complete**; live Sepolia deploy **not assumed** | `montions-base/` (`ChainlinkOracle`, `ChainlinkSettlementResolver`). `forge test` green. `DeployBase.s.sol` for 84532. Fork rehearsal against an Anvil fork of Base Sepolia. Check `deployments/` before claiming an address. |
| Arbitrum Sepolia (Chainlink) | **In progress** | Same EVM repo, feeds in CONTEXT. Deployer may be unfunded. |
| HyperEVM testnet (HyperCore `0x…0807`) | **In progress** | Windowed `record()`. Precompile verified live (SOL/BTC/ETH indices). Big blocks required for large deploys. Deployer must exist on HyperCore. |
| Canonical keys | **In the UI** | `canonicalMarketKey` in frozen `montions-app/src/chains/types.ts`. Same grids intended on every chain. |
| Multi-chain UI + routing | **Shipping** | React 19 app, Solana adapter live, Base adapter present, Arbitrum/HyperEVM adapters to follow the same `ChainAdapter`. Mock fallback if an adapter is down. |
| Model-priced maker | **Live per venue** | Solana `refresh_quotes`; EVM `MakerVault`. Not yet one operator netting across venues. |
| Contingent-surplus netting | **Proposed** | This paper, §6. Not in the Book/program. |
| Teleport | **Proposed** | §6.4. Not built. |
| Cross-venue maker netting | **Proposed** | §6.5. Not built. |
| Disagreement reserve | **Proposed** | §6.6. Not built. |
| Mainnet | **Not live** | Needs audit, legal review, Safe ownership, soak, real USDC. |

---

## 10. Roadmap

1. Finish EVM testnet deploys (Base, Arbitrum, HyperEVM) on the shared Book; keepers recording Chainlink rounds and HyperCore windows; UI adapters for 421614 and 998.
2. Align strike grids and expiry schedules so every live \(\kappa\) actually exists on every venue that claims it.
3. Soak settlement: compare prints across Pyth / Chainlink / HyperCore on the same \((A,T)\) and publish an empirical equivalence-band table (this paper’s §4.4 is a back-of-envelope).
4. Specify CSN receipts as explicit tokens (ERC-1155 / SPL) and a minimal burn instruction that preserves Invariant 1. Fuzz it against the existing 7 Book invariants plus \(S_Y, S_N\).
5. Solver path: intent “YES_A → YES_B” with destination collateral posted first; CCTP only after surplus exists.
6. Disagreement reserve with a hard cap and ATM exclusion.
7. Mainnet gates: audit, legal (binaries / event contracts), Circle USDC, Pyth/Chainlink production feeds, HyperCore window reviewed as a product risk.

---

## 11. Related work

**Onchain options.** Opyn oTokens (cash-settled, oracle per series). Lyra / **Derive**: listed vanillas, CLOB + RFQ, portfolio margin — greeks books, not 100% collateral binaries.[^derive] **Aevo**: offchain matching, onchain settlement, options+perps on a custom L2.[^aevo] **Premia**: AMM / concentrated liquidity for options. **Panoptic**: perpetual options from Uniswap LP, streaming premium, no dated expiry, internal TWAP-like observations rather than a first-print event.[^panoptic] Vault/RFQ sellers (Rysk, Thetanuts, SOFA) supply structured yield; they are not a public binary book.

**Prediction and outcome markets.** **Polymarket** (Gnosis CTF and V2 PositionManager): split/merge/redeem of YES/NO, UMA (and successors) for resolution, one settlement domain.[^polymarket] **Kalshi**: CFTC-regulated event contracts, centralised matching.[^kalshi] **Hyperliquid HIP-4**: fully collateralised outcome tokens on HyperCore, merged YES/NO books, first markets daily BTC binaries vs HyperCore mark; multi-outcome later. HIP-4 is the closest *payoff* cousin; it is not cross-chain and it settles to HyperCore, not to a portable first-print rule.[^hip4] **HIP-3** is builder-deployed perps (oracle chosen by the deployer), a different instrument.[^hip3]

**Conditional tokens.** Gnosis CTF’s split/merge of a complete set is the local ancestor of §6. CSN is that identity **across two oracles**: the complete set is YES on A and NO on B, and it is only complete when the oracles agree.

**Oracles.** Chainlink round model and proxy phases.[^cl-hist] Pyth pull updates and `prev_publish_time` / `parsePriceFeedUpdatesUnique`. HyperCore read precompiles, current price only.[^hl-precompile]

**Cross-chain USDC and messages.** Circle **CCTP** burn-and-mint, domains including Base, Arbitrum, HyperEVM, Solana.[^cctp] **LayerZero** v2, **Hyperlane**, **Chainlink CCIP** as general message layers — use for proofs, not as a substitute for fully funded local books. Intent/solver routing (UniswapX, Across, CowSwap, 1inch Fusion) is the pattern for §6.4: destination capital first, origin surplus later.

Montions’ gap relative to all of the above: **onchain matching, 100% collateral, portable event keys, first-print semantics per oracle class, and (proposed) surplus receipts instead of bridged inventory.**

---

## 12. Conclusion

A binary is the right atom: price is a probability, max loss is the premium, the pool is $1 per pair. The obstacle to putting that atom on several chains at once is not UX. It is three precise mistakes — treating different oracles as the same random variable, bridging collateral while a ticket is open, and pretending two books are one pool.

Canonical Events names the market once. Oracle-equivalent settlement names the timestamp rule once and then proves it as far as each feed allows (and stops, with a void, when it cannot). Contingent-surplus netting is the only cross-chain dollar that does not need to exist until a venue is already over-collateralised.

The testnet books are real. The surplus receipts are not. That line is the product.

---

## References

[^derive]: Derive, “What is an onchain crypto options protocol?”, 29 Aug 2026, <https://www.derive.xyz/blog/what-is-an-onchain-crypto-options-protocol/>; “How do decentralized crypto options work?”, <https://www.derive.xyz/blog/how-do-decentralized-crypto-options-work/>.

[^aevo]: Aevo documentation, “Welcome to Aevo”: options and perps, off-chain matching, on-chain settlement on a custom OP Stack L2, <https://docs.aevo.xyz/>.

[^opyn]: Opyn V2 / Convexity docs, <https://opyn.gitbook.io/opyn-docs>.

[^panoptic]: Panoptic, “What is Panoptic?”: perpetual options on Uniswap v3/v4 LP, streamia, no scheduled expiry, <https://panoptic.xyz/docs/intro>.

[^polymarket]: Polymarket, “How Positions Work”: ERC-1155 YES/NO, CTF condition/collection/position ids, split/merge/redeem, <https://docs.polymarket.com/>.

[^kalshi]: Kalshi, CFTC-regulated designated contract market for event contracts, <https://kalshi.com/>.

[^hip3]: Hyperliquid HIP-3, “Builder-deployed perpetuals”, <https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals>.

[^hip4]: Hyperliquid HIP-4, “Outcome markets”: fully collateralised, dated, no leverage; merged YES/NO books; first market daily BTC vs HyperCore mark, <https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets>.

[^cl-hist]: Chainlink, “Getting Historical Data”: rounds, proxy `roundId = phase << 64 | aggregatorRoundId`, `getRoundData`, <https://docs.chain.link/data-feeds/historical-data>.

[^hl-precompile]: Hyperliquid, “Interacting with HyperCore”: read precompiles from `0x…0800`, `oraclePx` at `0x…0807`, `price / 10^(6 − szDecimals)` for perps, <https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore>.

[^cctp]: Circle, “CCTP supported blockchains and domains” (Standard/Fast Transfer; domain ids: Arbitrum 3, Solana 5, Base 6, HyperEVM 19), <https://developers.circle.com/cctp/cctp-supported-blockchains>.

[^usdc]: Circle USDC is issuer-controlled; addresses, including a Book, can be frozen. See Montions `docs/THREAT_MODEL.md`.

Additional sources consulted: Pyth Developer Hub, “How Pyth Works” / Core sunset notes, <https://docs.pyth.network/price-feeds/core/how-pyth-works>; Montions specs `montions/docs/SPEC.md` §4 and §14, `montions/docs/THESIS.md`, `montions/docs/THREAT_MODEL.md`, `montions-sol/docs/SPEC.md` §7, `montions-base` `ChainlinkSettlementResolver.sol` and `ChainlinkOracle.sol`; Hyperliquid HyperEVM JSON-RPC, <https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm>.
