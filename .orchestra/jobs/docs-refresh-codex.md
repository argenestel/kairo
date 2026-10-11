Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (incl. items 8 and 9).

# Job: refresh every status claim in the paper, thesis pack and docs to match reality (Codex)

You own /home/arg/projects/hack/colessolana/paper/** for this job. Ground truth, gather it yourself and cite it:
- Solana devnet: `solana program show MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh --url devnet`; markets/status via `cd /home/arg/projects/hack/colessolana/montions-sol && sdk/node_modules/.bin/tsx scripts/status.ts --cluster devnet --rpc https://api.devnet.solana.com` (public RPC rate-limits: retry gently).
- EVM: montions-base/deployments/84532.json and 421614.json (+ `cast code <book> --rpc-url …` to confirm bytecode exists; series count via the Book), montions-base/docs/EVM.md.
- Reports: /home/arg/projects/hack/colessolana/.orchestra/out/*.md (evm-base-grok, ui-modes-grok, app-e2e-grok, evm-review-grok, sol-review-grok) and .orchestra/STATUS.md.
- Website URL: provided by the manager in this brief's follow-up line below if known.

Update: paper/cross-chain-options.md §9 (status table: real addresses + explorer links for Base Sepolia and Arbitrum Sepolia if deployed, Hyperliquid = PAUSED, known limitations from CONTEXT item 9 + any open evm-review findings as a "Known limitations" subsection), paper/docs/chains.md + developers.md + user-guide.md (addresses, faucet/gas instructions per chain, the website URL), paper/thesis/thesis.md "What we built" + executive-summary status line, paper/thesis/submission.md (replace every {{PLACEHOLDER}} with real values or remove the line), litepaper/pitch status lines. Never upgrade a claim beyond what you verified; keep timestamps ("as of <UTC time>"). Report a diff summary per file.

Website URL: https://kairo-nu-red.vercel.app
GitHub: https://github.com/argenestel/kairo
Product name: **Kairo** (formerly Montions) — rename every user-facing mention in paper/** (keep "formerly Montions" once in each long document). Hyperliquid: paused. Stocks: 29 tickers, keeper-reported demo oracle (Pyth path built, switches on with an API key). Event markets: optimistic resolver (check deployments for whether they're live yet; say "deploying" otherwise).
Base Sepolia was REDEPLOYED (v2): read montions-base/deployments/84532.json + 84532.stocks.json for current addresses; Arbitrum may still be v1 or v2 — read deployments/421614.json. Solana devnet program MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh (verify with `solana program show … --url devnet`).

ADDITIONAL deliverable — **paper/thesis/colosseum.md**: a submission for the Colosseum (Solana) hackathon, Solana-first: one-liner, problem, solution, why Solana (Anchor program with an onchain CLOB in one zero-copy account, Pyth PriceUpdateV2 settlement on devnet, SPL outcome tokens, permissionless market creation in the same tx as the first trade), what's live on Solana devnet (program id, explorer link https://explorer.solana.com/address/MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh?cluster=devnet, markets count, how to trade in 2 minutes on the website with Phantom/Solflare or the burner + faucet), the cross-chain "Canonical Events" angle (Base/Arbitrum live as additional venues), tech stack, team/AI-assisted build disclosure, links (website, GitHub, paper, docs, demo-video placeholder "{{DEMO_VIDEO_URL}}"), and short field-by-field answers sized for a typical hackathon form: project name, tagline (≤ 80 chars), short description (≤ 280 chars), long description (≤ 2,000 chars), tracks/categories, tech tags. Keep it honest (testnet, unaudited, known limitations).
