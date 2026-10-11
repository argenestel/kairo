Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (incl. the DIRECTION UPDATE).

# Follow-up: deploy the EVM stack to Arbitrum Sepolia (421614) and seed it (Grok)

This follows /home/arg/projects/hack/colessolana/.orchestra/jobs/evm-base-grok.md and its report /home/arg/projects/hack/colessolana/.orchestra/out/evm-base-grok.md. That run deployed Base Sepolia (84532, manifest deployments/84532.json) and passed fork rehearsals for both 84532 and 421614, but did NOT deploy Arbitrum because the deployer had 0 ETH there. The deployer now has 0.06 ETH on Arbitrum Sepolia (verified).

Owned paths: /home/arg/projects/hack/colessolana/montions-base/** (do not edit montions/ or montions-app/, and do not change the Base deployment).

Tasks:
1. Read montions-base/docs/EVM.md, scripts/evm-deploy.sh, scripts/evm-fork-rehearse.sh, config/chains.json (entry 421614) and the Arbitrum Chainlink feeds listed in CONTEXT item 2.
2. Re-run the fork rehearsal: `scripts/evm-fork-rehearse.sh 421614` and paste the pass summary.
3. Live deploy: print the gas and fee estimate first. Budget is at most 0.04 ETH from the deployer 0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39. Then run `scripts/evm-deploy.sh 421614`. Keys must only ever reach child processes through env or keystore, never printed.
4. Seed the same ladder used on Base (bots evm-seed for 421614, same grids and expiries from config/chains.json), inside the budget.
5. Verify by reading state back: series count, a YES quote, vault NAV, and each deployed contract's code size on https://sepolia-rollup.arbitrum.io/rpc. Produce deployments/421614.json in the same schema as 84532.json.
6. Give the Arbitrum Sepolia explorer links for 3 sample transactions (https://sepolia.arbiscan.io/tx/<hash>), the ETH spent, and the keeper start command (CHAIN_ID=421614, DEPLOYMENT=deployments/421614.json). Do NOT start any long-running process.

Run the test commands for anything you touched (forge test in montions-base; bots typecheck if it exists) and paste the summary lines.

Output: deployed addresses, balance before and after, ETH spent, readback results, the keeper command, and open risks.
