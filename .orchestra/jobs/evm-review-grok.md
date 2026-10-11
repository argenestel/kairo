Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first. READ-ONLY job: do not modify any file.

# Job: adversarial review of the EVM multi-chain changes (Grok)

Scope: everything in montions-base that differs from the read-only original (`diff -ru /home/arg/projects/hack/colessolana/montions /home/arg/projects/hack/colessolana/montions-base -x out -x cache -x node_modules -x lib -x broadcast`): Chainlink + HyperCore oracles/resolvers, Quoter/MakerVault/Book changes, deploy scripts (scripts/evm-deploy.sh, hyperevm-*), bots/keepers, config/chains.json, deployments/*.json. Use /home/arg/projects/hack/colessolana/.orchestra/jobs/base-review-grok.md as the checklist and add: HyperCore record-window games (who can record, timestamp vs HyperCore block time skew, precompile behaviour in small vs big blocks, stale precompile reads), cross-chain consistency (same canonical keys/grids on every chain, decimals per chain), key handling in every script.
Output: numbered findings, most severe first — severity, file:line, concrete scenario, minimal fix — then what you checked and found sound.
