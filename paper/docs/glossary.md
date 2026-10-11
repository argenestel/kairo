# Glossary

**Ask** — Resting sell of YES (a write, or a sale of held YES).

**Bid** — Resting buy of YES (or a close of held NO when `fromHeld`).

**Binary / digital** — Contract that pays a fixed $1 or $0, not a vanilla call’s linear payoff.

**Book / CLOB** — Onchain central limit order book. Price-time priority, ticks 1–99¢.

**Canonical event / canonical key** — Chain-agnostic id of a market: `(asset, strike, expiry, comparator)`. UI string `SYMBOL:strike:expiry`.

**Chance** — Model probability `N(d2)` shown in the UI; not the book mid.

**Collateral-local** — Each venue holds 100% of its own USDC-style collateral. Trading does not bridge.

**Comparator** — `≥` in production. “Below $K” is buy NO on the `≥ K` market.

**Contingent-surplus receipt (CSR)** — Proposed token: claim on a venue’s leftover pool if a named side wins (or 50¢ if void).

**Contingent-surplus netting (CSN)** — Proposed primitive: unpaired YES on A + unpaired NO on B worth $1 in agreeing states, paid after settlement.

**Disagreement reserve** — Proposed pool that tops up CSN when oracles disagree to the $0 cell, funded by haircutting the $2 cell.

**Equivalence band** — Typical `|P_A − P_B|` between two venues’ settlement prints, from oracle construction and timing.

**Expiry `T`** — Unix seconds, UTC. Trading while `now < T`; resolve after `now > T`.

**First print** — First oracle observation with timestamp ≥ `T`. The shared settlement rule.

**fromHeld** — Order that spends outcome tokens you already hold (sell YES, or close NO).

**Maker** — Resting liquidity. Protocol maker / MakerVault quotes a ladder around fair value.

**Merge / split** — Burn YES+NO for $1, or lock $1 for YES+NO, on one venue.

**NO** — Pays $1 if the event is false.

**Oracle-equivalent settlement (OES)** — Each venue implements first-print with its oracle’s onchain proof (or a documented approximation).

**Pool** — Collateral locked against outstanding YES/NO on a market.

**Premium** — What you pay for the ticket. Max loss on a long option/binary.

**Record** — Permissionless call that stores the settlement print (Chainlink round, Pyth update, HyperCore window snapshot).

**Resolve** — Marks the market YES or NO from the recorded print.

**Seat** — Solana per-market account holding a maker’s cash and tokens.

**Series / market** — One `(asset, strike, expiry)` book. EVM `seriesId`; Solana `Market` PDA.

**Strike `K`** — USD threshold. Grids: BTC $500, ETH $25, SOL $1 (intended, shared).

**tUSDC** — Test collateral, 6 decimals, faucet. Not Circle USDC.

**Taker** — The incoming order that crosses the book.

**Teleport** — Proposed: burn a leg on A, mint the same leg on B against a CSR (solver-fronted before expiry, or settle-anywhere after).

**Tick** — Integer cent, 1–99. `TICK_UNIT = 10_000` base units.

**UNIT** — $1 payout = `1_000_000` base units.

**Void** — 50/50 redemption when no valid print arrives by `VOID_GRACE`.

**YES** — Pays $1 if `price ≥ strike` at the first print.
