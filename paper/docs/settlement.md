# Settlement

Kairo (formerly Montions).

Shared rule: **the first print at or after expiry**. YES iff that price `≥` strike (WAD or 1e8, depending on the chain). If no valid print can be proven in time, the market **voids 50/50** after `VOID_GRACE`.

Nobody in Kairo chooses the timestamp except where an oracle **cannot** prove first-print (HyperCore window, Pyth sponsored-feed fallback). Those cases are labelled below.

![Settlement proofs](../figures/settlement-proofs.svg)

## Chainlink (Base, Arbitrum)

Rounds are contiguous inside a proxy **phase**. `updatedAt` is non-decreasing. Exactly one round `R` in the current phase satisfies

```
updatedAt(R) ≥ expiry  AND  updatedAt(R − 1) < expiry
```

`record(feed, expiry, roundIdHint)` checks both onchain. A wrong hint reverts. `recordFirstRound` / `findRound` search onchain (gallop + binary search). The first successful record is final.

Rejected (series stays not-ready → void after grace):

- hint in another phase, or first round of phase `> 1` (no predecessor through the proxy)
- incomplete / future / non-positive answer, or `updatedAt > expiry + maxDelay` (stalled feed)
- decimals `> 18`

`maxDelay` is the oracle’s one-time `settleDelayOf(asset)` (Base Sepolia rehearsal used 3600 s). Residual trust: Chainlink’s network and the feed proxy’s owner.

## Pyth (Solana; EVM pull path)

PriceUpdateV2 / Hermes updates carry `publish_time` and `prev_publish_time`.

**Exact first print**, when posted:

```
publish_time ≥ expiry  AND  prev_publish_time < expiry
```

On Solana this is accepted even outside the short window. Confidence must satisfy `conf * 10_000 ≤ max_conf_bps * |price|` (devnet `max_conf_bps = 200` → 2%). Full verification only. YES iff `price_e8 ≥ strike`.

**Sponsored-feed fallback** (devnet push accounts, ~1–5 s): if the update is not proven first-print, it is accepted only when `publish_time ∈ [expiry, expiry + settle_window]` (60 s on Solana). A keeper usually resolves within seconds; anyone may resolve earlier. That path **does** let the resolver pick a print inside the window.

EVM `PythSettlementResolver` uses `parsePriceFeedUpdatesUnique` in `[expiry, expiry + 300 s]`.

If nothing valid is stored, `void_market` / Book void after grace (24 h Solana, 2 days EVM). Residual trust: Pyth publishers, aggregation, and the onchain receiver upgrade key. Hermes currently requires an API key for pull; Solana **devnet sponsored accounts do not**.

## HyperCore (HyperEVM, proposed / PAUSED)

Read precompile `0x0000000000000000000000000000000000000807`, `oraclePx(uint32 perpIndex) → uint64`. Price = `raw / 10^(6 − szDecimals)`. The precompile exposes the **current** price, not history.

Proposed settlement (not live) is a permissionless `record(assetId, expiry)` that succeeds only if

```
expiry ≤ block.timestamp ≤ expiry + window
```

and nothing is stored yet. First recorder wins. Window default 60 s, hard cap 300 s. `resolve` reads the stored price; otherwise not-ready → void after grace.

This is **weaker** than Chainlink/Pyth: the recorder chooses the moment inside the window. Mitigation is a short window plus a keeper that records in seconds. Residual trust: HyperCore oracle, HyperBFT, and recorder latency.

## Void

Anyone may void after `expiry + VOID_GRACE` if the market is still open. Redeem pays `(yesQty + noQty) * $1 / 2`. Redemption requires a successful resolve/void transaction and available RPC access.

## When venues disagree

Each venue settles **its own** oracle. Near the strike, a few seconds or one heartbeat can flip YES/NO. That is basis risk, not a bug. Proposed contingent-surplus netting pays each venue’s surplus per its own oracle and uses a disagreement reserve for the $0 / $2 cells — see the [paper](../cross-chain-options.md). That primitive is not built.

As of **2026-10-11 18:36 UTC**: [evidence](https://github.com/argenestel/kairo/blob/main/paper/STATUS-EVIDENCE.md), [known limitations](../cross-chain-options.md#known-limitations). Equity feeds on Base use a **keeper-reported demo oracle**, not live Pyth equity settlement. Event markets are **deploying** and use a different optimistic proposal/challenge/arbitration flow; first-price-print rules do not apply to real-world event questions.
