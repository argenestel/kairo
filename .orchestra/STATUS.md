# Orchestra status (maintained by the Haiku manager)

Engines: Codex OUT OF CREDITS (all Codex jobs cancelled). Grok (pi) only. Max 5 Grok at once.
Solana: devnet program MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh deployed+seeded by main (28 markets, keeper running). No new Solana work; sol-review-grok findings go to main.

| Job | Engine | State | Output |
|---|---|---|---|
| base-adapter-grok | Grok | DONE (tsc clean; book empty on public Sepolia until deploy) | out/base-adapter-grok.md |
| sol-review-grok | Grok | DONE: 2 High, 3 Medium, 2 Low/Info (reported to main) | out/sol-review-grok.md |
| evm-base-grok | Grok | DONE: Base 84532 live (63 series, NAV 1M); Arbitrum not deployed (0 ETH then) | out/evm-base-grok.md |
| hypercore-grok | Grok | STOPPED (Hyperliquid paused by user); partial files kept | out/hypercore-grok.md |
| ui-polish-grok | Grok | running (WAVE A-3) | out/ui-polish-grok.md |
| docs-refresh-grok | Grok | waiting (after evm-base + arb deploy + app-e2e; website URL pending) | |
| paper-grok | Grok | DONE (paper/) | out/paper-grok.md |
| mascot-grok | Grok | DONE | out/mascot-grok.md |
| thesis-grok | Grok | DONE (paper/thesis/) | out/thesis-grok.md |
| evm-adapter-grok | Grok | running (needs stable/ratio-feed filter note; follow-up if needed) | out/evm-adapter-grok.md |
| hyperevm-ship-grok | Grok | CANCELLED (Hyperliquid paused) | |
| evm-review-grok | Grok | waiting (after evm-base) | |
| ui-modes-grok | Grok | waiting (after ui-polish + mascot + paper) | |
| app-e2e-grok | Grok | waiting (last; Base + Arbitrum + Solana only) | |
| evm-arb-grok-fu1 | Grok | DONE: Arbitrum 421614 LIVE (63 series, NAV 1M, ~0.0123 ETH spent); keeper not started | out/evm-arb-grok-fu1.md |
| CANCELLED: sol-ops-codex, sol-review-codex(-fu1), sol-fix-codex, base-ship-codex, ui-polish-codex, app-e2e-codex, base-review-grok | | | |

| keeper-gas-grok | Grok | running (after arb-fu1) | out/keeper-gas-grok.md |

## Update (new user direction: Kairo rename, stocks/ETFs, event markets, UwU, order books)
- Priority: ui-modes > stocks/events > evm-fix/keeper-gas > ui-prod > evm-ship2 > app-e2e > docs-refresh. Grok only, max 5 at once.
- Arbitrum Book is 0x26F24a01ba7EE5C5Ca29f73b9BbB7d4cFAa0035e (0x635c...070d is its engine).
- Running: ui-polish-grok, keeper-gas-grok, evm-fix-grok, stocks-grok, events-grok. Waiting: ui-modes-grok (after ui-polish), ui-prod-grok, evm-ship2-grok, app-e2e-grok, docs-refresh-grok.
- Holding keeper restarts until evm-fix and keeper-gas report.
- ui-polish-grok first run FAILED (empty output/log); retried once. ui-modes-grok was started early and stopped; restart after ui-polish completes.
- keeper-gas-grok DONE: dry-run ok, 66 bots tests pass, policy refresh_limit=4 / min_ticks=2 / eth_budget 0.01 per day (reported to main below).
