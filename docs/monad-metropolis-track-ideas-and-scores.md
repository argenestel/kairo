# Monad Metropolis Track Ideas and Scores

This document gathers the four track briefs, the three-model idea comparison, the weighted shortlist, and a build recommendation. **AgentCap** leads the combined scores, followed by **SliceFees**. Neither has validated customers or fee revenue.

## Event details

The event page lists a **$30,000 prize pool for each track**, split among three winners, with a deadline of **October 14, 2026, at 09:29 GMT+5:30**. Create a project before selecting a track. The listed deliverables are a public repository accessible to `metropolis@hackathon.monad.xyz`, project image (up to 3 MB), live product on Monad Mainnet or Testnet, technical demo (up to three minutes), and pitch video (up to two minutes). A 30-second product ad is optional.

The judging weights are technical execution 20%, design and craft 20%, originality 15%, founder and market readiness 25%, traction and path forward 20%.

## Track fit

| Track | Core product and user |
|---|---|
| **Onchain Finance & Trading** | Financial instruments, asset primitives, markets, or trading products for traders and protocols. Pricing and settlement must work, and risk must be clear. |
| **Social, Attention & Culture** | Social or cultural products where community participation creates explicit, verifiable economic stake. |
| **Consumer Products & Payments** | Consumer financial products where onchain payment or programmable money improves the actual experience. |
| **Trust, Identity & AI Infrastructure** | Reusable trust, authorization, identity, or data primitives with a named integrating developer or app. |

## How to read the scores

Three Pi model runs scored the same 23 ideas. Scores use six dimensions, each rated 0–10: pain and willingness to pay (20%); fee economics and repeatability (20%); differentiation (20%); Monad and track fit (15%); end-to-end execution, trust, and design (15%); first-100-user acquisition (10%). Total = `2P + 2R + 2D + 1.5M + 1.5X + A`, out of 100.

The scores are structured judgments, not probabilities. No customer interviews, paid transactions, retention, or acquisition data were provided. The highest combined idea scored 55.8/100; none is a 10/10 product. Fee rates below are testable hypotheses, and gross fees do not establish net margin.

**Models:** Pi Grok 4.6 (`xai`, xhigh); Pi GPT 6.1 Sol (`openai-codex`, high); Pi DeepSeek V4.1 Flash (`fireworks`, max). The GPT max-effort generation call did not finish; the same GPT 6.1 Sol model returned an answer at high effort. Full provenance and per-idea scores are linked below.

## Ranked ideas and fee hypotheses



## Complete score tables

The following tables rank every candidate within its track. Model totals are out of 100 in Grok/GPT/DeepSeek order. The final column is the across-model mean P/R/D/M/X/A vector.

### Onchain Finance & Trading

| Rank / idea / fee / main risk | Grok / GPT / DeepSeek | Mean total | Mean P/R/D/M/X/A |
|---|---:|---:|---:|
| 1. **F3 SliceFees** — Auction a claim on a pool’s next-block-window fees; 5–20bp of sale. Main risk: LP supply and bidders unproven; existing stream markets. | 56.5/55.0/51.5 | 54.3 | 4.7/5.0/5.0/7.3/6.7/4.0 |
| 2. **F4 LiqWindow** — Auction a brief exclusive liquidation right; liquidator pays bid. Main risk: Protocol integration and impact on borrowers. | 49.0/54.5/49.0 | 50.8 | 5.3/5.0/4.3/7.0/5.3/3.0 |
| 3. **F6 Execution Allowances** — Shared trade budget across adapters; 5bp per completed trade. Main risk: Adapters must honor reservations. | 40.0/55.0/45.5 | 46.8 | 4.7/4.7/3.7/6.0/5.7/3.3 |
| 4. **F1 FillGuard** — DEX swap-loss cover; routers buy a 2–5bp policy. Main risk: Premium underwriting; reference-price manipulation and adverse selection. | 40.0/44.5/46.0 | 43.5 | 5.0/4.0/4.0/6.0/3.7/3.0 |
| 5. **F5 LP Hedge Tickets** — Collateralized LP-exposure tickets; $1 per matched hedge. Main risk: Oracle, basis risk, and underwriter supply. | 37.0/44.0/46.0 | 42.3 | 5.0/3.7/4.0/5.7/3.7/3.0 |
| 6. **F2 RollRepo** — Short repo against tokenized T-bills; borrower pays interest plus rollover fee. Main risk: Collateral transfer/redemption constraints. | 32.0/42.0/47.5 | 40.5 | 4.7/4.7/3.0/5.3/3.7/2.3 |

### Social, Attention & Culture

| Rank / idea / fee / main risk | Grok / GPT / DeepSeek | Mean total | Mean P/R/D/M/X/A |
|---|---:|---:|---:|
| 1. **S4 DoorBond** — Refundable guest-list stake with transferable waitlist place; 5–10% stake. Main risk: Venue adoption; sign-in cannot prove attendance. | 45.5/53.0/42.0 | 46.8 | 5.3/4.3/4.0/5.3/5.0/4.0 |
| 2. **S3 ListenWindow** — Time-limited, transferable music-premiere passes; 8–15% ticket/resale. Main risk: Recording/leaks and artist acquisition. | 45.5/43.0/45.5 | 44.7 | 4.7/4.7/4.0/5.0/4.3/4.0 |
| 3. **S6 Collective Editions** — Threshold presale/refund and contributor payouts; 2% funded issue. Main risk: Offchain delivery and copyright. | 34.0/43.5/41.5 | 39.7 | 4.3/3.3/3.0/4.7/4.7/4.3 |
| 4. **S1 ViewSplit** — Attested clip views trigger editor payouts; brand pays about10% campaign. Main risk: View fraud/attestation truth. | 28.5/40.5/43.0 | 37.3 | 4.7/4.3/3.0/4.0/2.7/3.3 |
| 5. **S2 NightShare** — Sell rights to a venue-night revenue pool; 2% sale + 5% payout. Main risk: POS revenue truth and legal treatment. | 33.5/34.0/41.0 | 36.2 | 4.3/3.3/3.7/4.3/2.7/3.0 |
| 6. **S5 Curator Bonds** — Publisher-funded bonded submissions/challenges; $10 per round. Main risk: Subjective quality and sybil/collusion. | 33.5/33.5/39.0 | 35.3 | 3.7/3.3/3.7/4.3/3.0/3.0 |

### Consumer Products & Payments

| Rank / idea / fee / main risk | Grok / GPT / DeepSeek | Mean total | Mean P/R/D/M/X/A |
|---|---:|---:|---:|
| 1. **C3 TapTab** — Passkey USDC tab at event merchant; 1.5–2.9% close fee. Main risk: POS/card substitutes and retail adoption. | 43.5/51.5/41.0 | 45.3 | 4.3/4.3/3.0/5.7/5.7/5.0 |
| 2. **C5 ClassQuorum** — Refundable class bookings with enrollment threshold; $1 confirmed booking. Main risk: Instructor outcome and payment access. | 39.5/54.5/36.5 | 43.5 | 5.0/4.0/3.0/5.0/5.3/4.0 |
| 3. **C2 KinAllowance** — Rule-bound family remittance; $1–3/month + 0.5% transfer. Main risk: KYC, category attestations, offramp. | 41.0/41.0/46.0 | 42.7 | 5.3/4.7/3.3/5.0/3.7/3.0 |
| 4. **C6 TripBuffer** — Shared travel deposit and challenged reimbursement; $2 per claim. Main risk: Onchain contract cannot prove damage. | 36.5/37.5/35.0 | 36.3 | 4.3/3.0/3.0/4.7/3.3/3.7 |
| 5. **C1 MeterPay** — Meter scooter/charging sessions; operator pays 3–5%. Main risk: Hardware and payment integration. | 27.0/41.5/36.0 | 34.8 | 4.3/3.3/3.0/4.7/3.0/2.0 |
| 6. **C4 LineSplit** — Household itemized accept/decline bill; 50–150bp accepted items. Main risk: Receipt truth; Splitwise is a substitute. | 31.0/36.0/34.0 | 33.7 | 4.3/2.3/2.3/4.0/4.0/3.7 |

### Trust, Identity & AI Infrastructure

| Rank / idea / fee / main risk | Grok / GPT / DeepSeek | Mean total | Mean P/R/D/M/X/A |
|---|---:|---:|---:|
| 1. **T1 AgentCap / Mandate Registry** — Passkey-rooted agent scope/cap/expiry/revocation; $0.002–0.02/check or $20–100/app/mo. Main risk: Wallet delegation is direct competition. | 52.5/59.5/55.5 | 55.8 | 6.0/5.0/4.3/7.0/6.7/4.7 |
| 2. **T3 SupportSlot** — Short support key limited to refund-original address; $0.05–0.50/session. Main risk: Wallet-support integrations and refund disputes. | 51.5/49.5/45.5 | 48.8 | 5.0/4.0/4.3/6.0/6.3/3.7 |
| 3. **T5 RetryBudget** — Idempotent cross-provider agent-job accounting; $0.01/reconciled job. Main risk: Provider opt-in and semantic quality. | 41.0/48.5/43.0 | 44.2 | 5.3/3.3/3.7/5.7/4.7/4.0 |
| 4. **T2 Freshness Oracle** — Bonded signed device-heartbeat service; per write or $500–2,000/mo. Main risk: Signing key does not prove sensor truth. | 41.0/42.5/46.0 | 43.2 | 5.3/4.7/3.3/5.3/3.7/3.0 |
| 5. **T4 RecoveryDrills** — Safe-vault recovery rehearsal reports; $1 per drill. Main risk: Test does not guarantee production recovery. | 37.0/48.0/38.0 | 41.0 | 4.3/3.0/3.3/5.0/5.7/3.7 |

## Model idea submissions and evidence

All three models first proposed two ideas per track. Near-duplicate ideas were merged into T1 AgentCap/Mandate Registry, then every scorer evaluated the same 23-ID slate. See the original, unmerged proposals: [Grok](../research/all-track-scoring/grok-round1.txt), [GPT 6.1 Sol](../research/all-track-scoring/gpt-retry-answer.txt), [DeepSeek V4.1 Flash](../research/all-track-scoring/fireworks-round1.txt).
For the complete raw per-model dimensions, fatal-risk comments, answer metadata, and validation records, see [aggregate-scores.json](../research/all-track-scoring/aggregate-scores.json) and the adjacent `*-score-*` artifacts.
Competitor checks include [MetaMask delegation](https://docs.metamask.io/smart-accounts-kit/), [Sablier/OVRFLO stream cashflows](https://blog.sablier.com/turning-fixed-yield-into-collateral-with-sablier-streams), and [Uniswap swap protections](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps). The model scores account for these substitutes; verify current target users and integrations before committing to a build.
