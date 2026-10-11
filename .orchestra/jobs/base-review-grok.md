Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first. READ-ONLY job: do not modify any file.

# Job: adversarial review of the Base/Chainlink changes (Grok)

Scope: montions-base/src/oracle/chainlink/**, montions-base/src/resolvers/ChainlinkSettlementResolver.sol, every change made to Quoter/MakerVault/MontionsBook to support them (diff against the read-only original: `diff -ru montions/src montions-base/src`), script/DeployBase.s.sol, scripts/base-deploy.sh, bots/ keeper changes, deployments/84532.json.

Check: can anyone record a price other than the first round at/after expiry (hint manipulation, phase boundaries, round 0, aggregator upgrades on the proxy, rounds with updatedAt == expiry, answeredInRound semantics), stale/negative answers, decimals, griefing that forces a void, quoter/vault pricing with stale Chainlink spot (heartbeat up to 20 min — can a trader pick off the vault?), deployment script mistakes (owner/keeper roles, allowed resolvers, caps, leftover test minters), secret handling in scripts (any chance the key is echoed or written to disk/logs?).

Output: numbered findings, most severe first: severity, file:line, concrete scenario, minimal fix; then what you checked and found sound.
