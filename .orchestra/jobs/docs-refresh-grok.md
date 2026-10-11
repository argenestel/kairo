Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (incl. items 8 and 9).

# Job: refresh every status claim in the paper, thesis pack and docs to match reality (Grok)

You own /home/arg/projects/hack/colessolana/paper/** for this job. Ground truth, gather it yourself and cite it:
- Solana devnet: `solana program show MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh --url devnet`; markets/status via `cd /home/arg/projects/hack/colessolana/montions-sol && sdk/node_modules/.bin/tsx scripts/status.ts --cluster devnet --rpc https://api.devnet.solana.com` (public RPC rate-limits: retry gently).
- EVM: montions-base/deployments/84532.json and 421614.json (+ `cast code <book> --rpc-url …` to confirm bytecode exists; series count via the Book), montions-base/docs/EVM.md.
- Reports: /home/arg/projects/hack/colessolana/.orchestra/out/*.md (evm-base-grok, ui-modes-grok, app-e2e-grok, evm-review-grok, sol-review-grok) and .orchestra/STATUS.md.
- Website URL: provided by the manager in this brief's follow-up line below if known.

Update: paper/cross-chain-options.md §9 (status table: real addresses + explorer links for Base Sepolia and Arbitrum Sepolia if deployed, Hyperliquid = PAUSED, known limitations from CONTEXT item 9 + any open evm-review findings as a "Known limitations" subsection), paper/docs/chains.md + developers.md + user-guide.md (addresses, faucet/gas instructions per chain, the website URL), paper/thesis/thesis.md "What we built" + executive-summary status line, paper/thesis/submission.md (replace every {{PLACEHOLDER}} with real values or remove the line), litepaper/pitch status lines. Never upgrade a claim beyond what you verified; keep timestamps ("as of <UTC time>"). Report a diff summary per file.
