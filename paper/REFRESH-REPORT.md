# Kairo paper refresh report

Completed documentation refresh against the **2026-10-11 18:36 UTC** evidence snapshot. Edits confined to `paper/**`. No git commands or onchain writes. Website and GitHub links supplied by the manager.

## Per-file diff summary

| File | Change |
|---|---|
| `cross-chain-options.md` | Kairo naming; §9 current Books/explorers and 150/81 total series; stock/event/UI status; full unresolved Solana and EVM limitations; HyperCore explicitly proposed/paused; roadmap and cap/owner guarantees corrected. |
| `docs/chains.md` | Replaced stale table with current Base v2/Arbitrum v1 contract tables; Solana reported-state caveat; per-chain wallets/gas/faucets; 29 demo equity feeds, events deploying and limitations. |
| `docs/developers.md` | Current inspection commands and address/faucet references; generic EVM tooling; paused HyperCore; demo-equity/event trust and verification caveats. |
| `docs/user-guide.md` | Public website; live EVM addresses; Phantom/Solflare or burner; faucet/gas/rent instructions; paused Hyperliquid; realistic settlement delays and failure handling. |
| `docs/overview.md` | Kairo; actual deployed/reported distinction; paused Hyperliquid; stock/event status and evidence links. |
| `docs/faq.md` | Removed stale EVM deployment uncertainty and blanket exposure/owner guarantees; stock/event trust and known limitations. |
| `docs/settlement.md` | HyperCore explicitly proposed/paused; equity demo-oracle and optimistic-event distinction; void transaction/liveness caveat. |
| `docs/how-it-works.md` | Historical naming note; timestamp and actual-deployment/limitation links; distinguishes price flow from deploying event markets. |
| `docs/glossary.md` | Historical naming note; existing glossary definitions retained. |
| `meta.json` | Author Kairo; abstract distinguishes verified EVM deployment, reported Solana deployment and unverified browser flow. |
| `thesis/thesis.md` | Executive status line and “What we built” replaced; removed address placeholders and obsolete fork-only claims; full known limitations; roadmap/cold-start status corrected. |
| `thesis/submission.md` | All placeholders removed; current Books/explorers and status; website trial path; realistic trust/tracks; Colosseum source link. |
| `thesis/litepaper.md` | Kairo; concise current-status table; unresolved maker cap disclosure and evidence/addresses. |
| `thesis/pitch.md` | Kairo; Slide 11 and spoken close use current status/counts; cap/owner guarantees qualified. |
| `thesis/demo-script.md` | Kairo; spoken claims and failovers match deployed EVM / reported Solana status; no fake mode fallback; settlement selection limitation. |
| `thesis/colosseum.md` | New Solana-first submission: product, Anchor zero-copy CLOB, Pyth/SPL/composed market creation, trial, Canonical Events, stack/disclosure/limitations/links and sized form answers. Only intentional placeholder: `{{DEMO_VIDEO_URL}}`. |
| `STATUS-EVIDENCE.md` | New reproducible commands/results, source links, report reconciliation, failed Solana reads and UI/keeper verification boundaries. |
| `REFRESH-REPORT.md` | This per-file diff and validation/handoff report. |

Simplifications: removed deployment/address placeholders and obsolete deploy/funding assumptions; replaced repeated speculative status with timestamped evidence; removed instructions to fund/trade paused Hyperliquid. Kept repo names, deployed contract names and SDK identifiers unchanged. “formerly Montions” appears once in each existing long Markdown document and the Colosseum submission.

## Commands and results

- Read `.orchestra/CONTEXT.md` first, including 8/9; current manifests `84532.json`, `84532.stocks.json`, `421614.json`; `montions-base/docs/EVM.md`; manager status and relevant review/build reports. Empty UI/ship2 reports and absent app-e2e report explicitly recorded.
- `cast code <Book> --rpc-url <RPC>`: Base and Arbitrum each nonempty **20,525-byte** runtime. `cast call <Book> 'seriesCount()(uint256)'`: **Base 150 / Arbitrum 81**. Base KeeperFeedHub runtime also nonempty. Exact addresses/RPCs in [evidence](STATUS-EVIDENCE.md).
- Required `solana program show ... --url devnet` and `tsx scripts/status.ts --cluster devnet --rpc https://api.devnet.solana.com`: attempted twice; failed with transport / 429 errors after built-in gentle backoff. PublicNode/dRPC alternatives failed HTTP 404/400. No fresh Solana absence, count or uptime inferred.
- `curl -I -L --max-time 20 https://kairo-nu-red.vercel.app`: **HTTP 200**.
- `cd montions-app && pnpm typecheck`: **passed**.
- `cd montions-app && pnpm exec vite build --outDir /tmp/kairo-paper-build`: **passed**, 1,433 modules; existing large-chunk warning. Initial build command from workspace root failed because no package manifest; rerun from app directory passed. Output kept under `/tmp` to preserve write ownership.
- Python static checks: **all paper JSON/SVG parse; local Markdown links resolve; no unexpected placeholders; Colosseum tagline 66/80, short description 244/280, long description 1,687/2,000 characters**.
- No paper-specific lint/unit-test scripts exist; no protocol tests rerun for a documentation-only change. Markdown packaging validated by the app build. No dependencies added.

## Decisions and remaining risks

Source fixes are not promoted to verified deployed fixes. Base uses the v2 manager/manifests; Arbitrum still matches archived v1 addresses. Total series is not active liquidity. Solana retains **28 historically seeded markets and running keeper as reported**, with fresh verification unavailable. Mainnet remains not live, software unaudited; unresolved maker caps, print selection, book-capacity and operational issues remain disclosed.

The website reading router currently hardcodes a limited set of thesis routes outside this job’s ownership. The new Colosseum submission is a repository artifact; no unsupported `/colosseum` navigation entry was added. Evidence and Colosseum links use GitHub source URLs, which become current after the manager commits/publishes. App rendering also replaces the historical legacy-name note outside this job’s scope; source documents preserve the requested historical note. No live site publication is claimed. Manager must publish the paper assets, wire a Colosseum route if desired, add the demo video and recheck Solana state before submission. Wallet trading, keeper uptime, stock prices/settlements and event deployment remain unverified.
