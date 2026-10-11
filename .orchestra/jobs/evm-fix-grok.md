Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (incl. the DIRECTION UPDATE).

# Job: fix the High and key Medium findings from the EVM review (Grok)

Input: /home/arg/projects/hack/colessolana/.orchestra/out/evm-review-grok.md (the adversarial review of montions-base). Owned paths: /home/arg/projects/hack/colessolana/montions-base/** (do not touch montions/ or montions-app/). Base (84532) and Arbitrum (421614) are already live with manifests deployments/84532.json and deployments/421614.json.

Fix, in this order:
1. Finding 1 (High): vault exposure to the 20-minute Chainlink heartbeat. Tighten quoting staleness or pricing, and add a test.
2. Finding 2 (High): extra registered feeds plus permissionless createSeries. Restrict series creation to the approved grid, or make the keeper quote only canonical series. Add a test.
3. Finding 3 (High): align the seeder with the canonical SYMBOL:strike:expiry key so the same market is built on every chain. Add a test.
4. Finding 4 (High, ops): fork-rehearsal scripts must never overwrite a live manifest (deployments/<chain>.json). Make the write opt-in or write to a separate path, and add a guard.
5. Finding 5 (Medium): the Arbitrum round-scan window (maxRounds=512) misses the first print. Widen the scan or walk back in pages, and test it.
6. Finding 6 (Medium): aggregator phase upgrade. Document it, and make the resolver reject or handle a phase change explicitly.

Rules: do NOT deploy and do NOT send any transaction, to any chain. Any change that needs a redeploy must be described in your report with a cost estimate, and not executed. Do not touch bots/ files that another running job is changing (keeper-gas-grok edits bots/keeper and rate-limit code): if a fix needs bots/, keep the change minimal and list it in the report.

Run forge test in montions-base and paste the summary line. Report: each finding (fixed / deferred / not applicable), the files changed, the test summary, and anything that needs a redeploy.
