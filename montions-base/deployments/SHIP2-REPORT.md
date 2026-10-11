# Kairo EVM ship continuation

In progress. Final addresses, receipts and balance deltas will replace this draft after verification.

Confirmed starting balances: Base 0.068138985431543456 ETH; Arbitrum 0.057135213056703499 ETH. Launch budgets remain 0.035 / 0.030 ETH, with 0.010 ETH reserve per chain.

Base handoff corrections: the claimed KeeperFeedHub 0x88C0F18816fCaEA45d266A14c1A66AC64EfE3F6B has no code. Actual live hub is 0xF4fDe98f037d8889c8e1a6C1C66f558a9091F6fC, with 29 feeds; the stock sidecar and oracle agree. Base began with 63 crypto series and no stock series, rather than the stated TSLA demo. Existing core and stocks deployment broadcasts were preserved.

Completed live: one 29-price feeder round (0x6707a6437c64adee18def1a43f11d8a14f1d99db6a426f93da64c1f3f17529ba), 87 stock series (29 tickers x three strikes), expiry 1792180800 = 2026-10-16 20:00 UTC, all 32 price assets trusted. Manifest/config repaired from live state.

Required additional fix: v2 vault refresh exceeds Base's 16,777,216 gas transaction limit at ~85 active markets. Limiting transaction padding resolved the earlier padding-only failures but not the eventual raw limit. MakerVault now records whether tracked orders include held YES asks; it skips their orderInfo inventory scan only when none exist. Existing held-inventory tests pass, plus a cold 150-market refresh gas test (7,046,963 gas). Original vault assets/shares are preserved; replacement only affects quote routing. See ship2-vault-decision.md.

Arbitrum oracle policy: current ETH/BTC prints show ~120-second spacing. LINK's last ten intervals include 2,400 and 2,520 seconds. ETH/BTC use heartbeat=120 and maxStaleness=240; LINK uses a conservative demo heartbeat policy=3,600 and maxStaleness=7,200. Positive prices and identity/decimals checks remain required; stale quotes still fail closed. This LINK policy is an operational demo setting, not a claim about a documented official heartbeat.

Validation so far: 368 Solidity tests, 98 bot tests, 44 SDK tests; bot/SDK and full app typechecks clean. Initial app chart export error was fixed by another workspace participant; no chart files edited in this job.

Processes: no production bots started. Temporary fork nodes are cleaned up on exit. Subagent launch was unavailable (thread-store error); work continued directly.
