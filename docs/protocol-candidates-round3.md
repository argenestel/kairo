# Monad Metropolis - protocol candidates (Round 3)

24 candidates: 6 each from Claude (main), Grok 4.6 (Pi, xhigh), GPT 6.1 Sol (Codex, high), Gemini 3.8 Flash (agy, high).
Raw outputs: `research/protocol-round/r3-*.txt`. Earlier rounds: HOLD / RELY / VALENCE (r1/r2 files).
Verdicts are Claude's judgment after reading the models' own ratings and the Round 2 critiques. No customer evidence exists for any of them.

Tracks: F finance, S social, C consumer, T trust/AI infra.

| # | By | Name | Mechanism | Tracks | Verdict |
|---|---|---|---|---|---|
| 1 | Claude | Tally | Mutual-credit trustlines, atomic multi-hop pay, fault-burning vouches | F S C T | A (netting cluster) |
| 2 | Claude | Unseal | Atomic data-for-payment, keccak-CTR chunk proof of misdelivery | T S C F | A- |
| 3 | Claude | Postage | Refundable bonds for inbound attention | S T C F | B+ safe, small |
| 4 | Claude | Wake | Heartbeat-gated actions | F S C T | A (merged with Pulse) |
| 5 | Claude | Epoch | Sealed-commit uniform-price batch clearing | F S C T | A- (merged with Equalize) |
| 6 | Claude | Ember | Decaying non-transferable participation shares | S T C F | B- |
| 7 | Grok | Lane | Skip-compensated ordering queue | F S C | B- guestbook risk |
| 8 | Grok | Offset | Standing IOU mesh, net not gross, margin rule | F S C | A (netting cluster) |
| 9 | Grok | Pulse | Liveness bonds with successor market | F S C T | A |
| 10 | Grok | Stamp | Consumable, attenuable, bonded credentials | F S C T | B+ |
| 11 | Grok | Cask | Bonded forced-reveal of sealed keys | F S T | B |
| 12 | Grok | Locus | Exclusive location mutex for an owned asset | F S C | C+ |
| 13 | Codex | Mosaic | Indivisible package barter clearing | F S C | B matching problem |
| 14 | Codex | Par | Price-protection cohorts with rebates | F S C T | B- feature, not protocol |
| 15 | Codex | Sieve | Buy a verified query answer, not the data | F S T | B needs ZK, heavy |
| 16 | Codex | Facet | Split asset rights, block conflicting exercise | F S C T | C+ |
| 17 | Codex | Forkbond | Bonds punishing contradictory signed checkpoints | F S C T | B clean, narrow |
| 18 | Codex | Mask | Anonymous participation backed by locked capital | F S T | C+ ZK in 7 days |
| 19 | Gemini | Harbor | Harberger leaseholds with streamed tax | F S C T | A- |
| 20 | Gemini | Netto | Bilateral tabs, cyclic netting | F S C T | A (netting cluster) |
| 21 | Gemini | Chrono | Time-decaying conviction staking | F S T | C+ Aragon prior art |
| 22 | Gemini | Equalize | Onchain micro-batch auction clearinghouse | F S C | A- (merged with Epoch) |
| 23 | Gemini | Datum | Bonded Schelling micro-verification | S C T | B- Kleros/UMA, bribery |
| 24 | Gemini | Sigil | Enclave attestation unlocks custody | S C T | C premise broken |

## Convergence (independent models reaching the same primitive)
- Netting / credit clearing: Tally, Offset, Netto (+ Codex's earlier Setoff backup) - 4 sources.
- Liveness: Wake, Pulse - 2 sources.
- Batch clearing: Epoch, Equalize - 2 sources.
- Data-for-payment: Unseal, Sieve, Cask, Datum - 4 variants, different mechanisms.

## Flags
- Sigil: Gemini's own Round 2 critique said browser passkeys do not sign raw hashes; its demo contradicts that. Registering a P256 key does not prove it is hardware-bound. Highest self-score (wow 10), weakest premise.
- Netto: "ERC-20 write contention" is overstated; transfers between distinct holders touch distinct slots.
- Convergence among models may reflect shared training bias, not market demand.
