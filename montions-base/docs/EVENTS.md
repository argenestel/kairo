# Kairo event markets ("Predictions")

Yes/no questions about real-world events, traded as the same fully collateralised $1 YES/NO contracts as the price book. Product name is **Kairo**. The Book, ticks, and redemption math do not change.

This is the event catalog + optimistic resolver that ships in `montions-base`. It is **not** live on Base/Arbitrum Sepolia until an owner allowlists the resolver on the deployed Book.

## Design

A listed question is identified by a **chain-agnostic key** (e.g. `FED-CUT-2026-10-28`). On every chain:

```
eventKey  = keccak256(bytes(key))
rulesHash = keccak256(bytes(rules))
data      = abi.encode(eventKey, uint64 closeTime, rulesHash)   // 96 bytes
seriesId  = keccak256(abi.encode(resolver, data, expiry))
```

`expiry` **must equal** `closeTime`. Trading is `timestamp < expiry` (Book). Proposals are accepted at `timestamp >= closeTime`. The Book will not `resolve` until `timestamp > expiry`.

Series data length is 96 (well under the Book's 512-byte cap). `validate` rejects a mismatched `rulesHash`, a `closeTime` that does not match the catalog, an expiry other than `closeTime`, an unregistered key, or a series created after the event has already closed.

### Optimistic flow

1. **Curator / owner** `registerEvent` — question, rules, source URL, category, icon, closeTime. Metadata lives onchain so a UI can `eventCount` / `eventKeyAt` / `eventInfo` with no indexer.
2. After `closeTime` **anyone** `propose(eventKey, YES|NO|INVALID)` posting `bondAmount` tUSDC (default 100).
3. For `challengeWindow` (default **2 hours** on testnet, owner-set **10 minutes–3 days**, snapshotted on the proposal) **anyone else** may `dispute` by matching that bond.
4. **Undisputed** after the window → the view `resolve` reports ready (YES/NO) so the Book can settle. `finalize` (permissionless) returns the proposer's bond and persists the outcome.
5. **Disputed** → `arbitrate(eventKey, outcome)` by the **arbitrator**. Both bonds minus `arbitrationFeeBps` (default 5%) go to the winner (proposer if the award matches the assertion, else the disputer); the fee goes to `treasury`.
6. **INVALID**, or nothing ever finalised → `resolve` stays `(false, false)`. After `VOID_GRACE` (2 days from expiry) the Book voids 50/50. That is the only void signal the Book understands; there is no third status.

`rejectProposal` (arbitrator, disputed only) throws the assertion out **without** finalising, pays the disputer as the round winner, and allows a new `propose`. That is the re-proposal path.

### Status (matches the UI `EventInfo.status`)

| Solidity `EventStatus` | UI | Meaning |
|---|---|---|
| Open | `open` | `timestamp < closeTime` |
| Closed | `closed` | closed, no live proposal |
| Proposed | `proposed` | bond posted, window open |
| Disputed | `disputed` | matching bond posted |
| Resolved | `resolved` | YES or NO is final (finalized **or** undisputed window elapsed) |
| Invalid | `void` | INVALID; Book will 50/50 after grace |

## Trust model (honest)

Three roles, none of them a token DAO:

| Role | Who on testnet | Power |
|---|---|---|
| **Curator** | owner, or an owner-set address | Lists questions. Cannot move user funds or set an outcome. |
| **Bonded proposer / disputer** | anyone with tUSDC | First-line economic check. A lie that nobody disputes **does** finalise. |
| **Arbitrator** | owner EOA / multisig (`0x4fcDca…` on the current testnets) | Final fact-finder on disputes. **Can set the wrong outcome and award both bonds.** |

This is **weaker than UMA and weaker than Polymarket**:

- **UMA Optimistic Oracle.** A proposer posts a bond; a dispute escalates to the DVM, a token-holder vote with a known economic game. Slow (hours to ~2 days + DVM), but the arbitrator is not a named admin.
- **Polymarket.** Resolution is the UMA OO. Polymarket's "proposers" are specialised; disputes still go to UMA, not to Polymarket staff.
- **Kairo (this contract).** The arbitrator is an **admin key**. Bonds only punish a liar if that key is honest and online. A captured arbitrator steals both bonds and writes the tape. On testnet we say so: the arbitrator **is** the deployer EOA. For anything with real money this should be a Safe with a delay, or the resolver should be replaced by UMA/Kleros.

Other residual risks:

- If nobody proposes, or a dispute sits past `VOID_GRACE` (2 days), the Book voids 50/50 even if the fact is obvious. A 3-day challenge window cannot finish before void; keep the window at 2 h on testnet.
- A late proposal still inside its window at `expiry + 2 days` can race `Book.resolve` (not-ready → void). Propose promptly after close.
- "Will X happen by DATE" markets cannot resolve early as YES even if X already happened; proposing is disabled until `closeTime`.
- Catalog rules are short onchain strings (≤ 768 bytes), not IPFS. Ambiguous rules are an arbitration problem, not a code problem.
- The Book owner must `setResolverAllowed`. Without that, nobody can `createSeries`.

The owner still cannot touch Book user funds; that invariant is unchanged.

## Catalog

`config/events.json` — 27 markets, researched 2026-10-11, all with an objective public source. Priors are Polymarket YES prices (or sums of buckets) from that day plus Coinbase spots where relevant. Categories: crypto, macro, politics, sports, tech, culture.

Every `closeTime` is inside the Book's 90-day `MAX_DURATION` from 2026-10-11, so a deploy can `createSeries` for all of them. Keys are stable and chain-agnostic.

## Contracts

| Piece | Path |
|---|---|
| Types | `src/resolvers/events/EventTypes.sol` |
| Resolver + catalog | `src/resolvers/OptimisticEventResolver.sol` |
| Tests | `test/events/*.t.sol` |
| Deploy / fork rehearsal | `script/DeployEvents.s.sol` |
| Maker bot | `bots/src/event-maker.ts` |
| Resolver bot | `bots/src/event-resolver-bot.ts` |

Constructor: `(collateral, owner, treasury, arbitrator)`. Defaults: 2 h window, 100 tUSDC bond, 5% fee, curator = owner.

`registerEvent` takes a single `EventRegistration` calldata struct (stack limit). Fields are still `(key, question, rules, source, closeTime, category, icon)`.

## Commands

```bash
# unit + Book lifecycle (this package)
forge test --mp 'test/events/*' --skip 'KeeperFeed'

# local anvil fork of Base Sepolia (does NOT spend live ETH)
anvil --fork-url https://sepolia.base.org --port 8552 --auto-impersonate
# Fat registerEvent calldata needs more than the forked 0.06 ETH; this is local anvil only:
cast rpc anvil_setBalance 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8552
# 1) deploy resolver, register 27 events, create series, buy on the first market
FORK=1 REHEARSE_E2E=1 forge script script/DeployEvents.s.sol:DeployEvents \
  --rpc-url http://127.0.0.1:8552 --broadcast --unlocked \
  --sender 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39
# writes deployments/rehearsal/events.json  (never overwrite deployments/84532.json)
# If the buy tx is missing (trader 0xE2E2 has no gas), fund it and:
#   FORK=1 forge script script/DeployEvents.s.sol:DeployEvents --sig 'rehearseBuyFromManifest()' \
#     --rpc-url http://127.0.0.1:8552 --broadcast --unlocked
# 2) propose → warp challenge window → Book.resolve → redeem (warps belong in a test, not a broadcast script)
ANVIL_REHEARSE=1 forge test --mp test/events/EventAnvilRehearse.t.sol -vv

# full suite
forge test

# maker (6¢ inner spread, 3 rungs, refresh on fill or every 3 h)
cd bots
DEPLOYMENT=../deployments/rehearsal/events.json EVENT_RESOLVER=0x… \
  pnpm exec tsx src/event-maker.ts --once --dry-run

# resolver bot — will not propose unless the operator confirmed the result
EVENT_OUTCOMES=../config/event-outcomes.json \
  pnpm exec tsx src/event-resolver-bot.ts --once --dry-run
```

Both bots take `--once` and `--dry-run`, and go through `guardedWriteContract` (0.04 ETH Base / 0.03 ETH Arbitrum budget). They never print keys.

Operator file (`EVENT_OUTCOMES`), one entry per key, **required** before a propose:

```json
{
  "outcomes": {
    "FED-CUT-2026-10-28": {
      "outcome": "no",
      "confirmed": true,
      "note": "FOMC 28 Oct 2026 statement: target range unchanged."
    }
  }
}
```

`outcome` is `yes` | `no` | `invalid`. Missing / `confirmed: false` → the bot logs `waiting_operator` and does nothing. Disputes are logged; the bot does not call `arbitrate`.

## Gas (from `forge test`, Cancun, optimizer 200, not via-IR)

| Action | Order of magnitude |
|---|---|
| `registerEvent` (short copy) | ~320k |
| `createSeries` | Book path, ~150–250k |
| `propose` (tUSDC transferFrom) | ~160k |
| `dispute` | ~80–120k |
| `finalize` / `arbitrate` | ~60–100k |
| `Book.resolve` after a ready YES | ~50k |
| `IResolver.resolve` view | ≪ 500k (the Book's staticcall cap) |

Long `rules` strings dominate `registerEvent` SSTOREs. Keep rules under 768 bytes.

## Integration needs (other jobs)

This job does **not** edit the Book, SDK, UI, or live manifests.

- **Book owner (ops):** `setResolverAllowed(eventResolver, true)` on Base Sepolia `0xB38658485ed69fA70BDe9aC0989926c33506Ac48` and Arbitrum Sepolia `0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e`. Then run `DeployEvents` (or a live variant) **only after** the user authorises spend.
- **SDK:** generate ABI for `OptimisticEventResolver`; add `contracts.eventResolver` to the manifest schema.
- **UI (`listEvents` / `quoteEvent` / `buyEvent`):** page `eventCount`/`eventKeyAt`/`eventInfo`, compute `seriesId`, read `Book.bestBidAsk` / `volumeOf`. Map Solidity `Invalid` → UI `void`. `icon` is an emoji. Canonical key is `EventInfo.key`, not `SYMBOL:strike:expiry`.
- **Keeper / MakerVault / Quoter:** ignore series whose resolver is not the Chainlink/TWAP resolver they already trust. Event series have no fair-tick model; the EOA event-maker quotes the prior/mid instead.
- **Paper / docs site:** event keys are the second canonical identity next to `SYMBOL:strike:expiry`.

## Known limitations

Same Book limits as price markets (64-deep recent trades, 2-day void, 90-day max duration, 1–99 ticks). Plus the admin arbitrator, no early YES, and the VOID_GRACE race above. Testnet collateral is mintable tUSDC.
