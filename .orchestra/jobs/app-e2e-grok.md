Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first.

# Job: end-to-end verification of the live multi-chain app (Grok)

This is /home/arg/projects/hack/colessolana/.orchestra/jobs/app-e2e-codex.md adapted: run it for every chain that has a deployment (Base Sepolia, Arbitrum Sepolia, HyperEVM testnet, Solana devnet), in BOTH modes (serious + uwu) at least for the happy path, and verify best-venue routing picks the cheapest venue. Burner secrets arrive in env: SOL_BURNER_SECRET, EVM_BURNER_KEY (same key on all EVM chains; the manager funds it with a little gas per chain). You own montions-app/** except src/chains/types.ts. Verify every trade on-chain (`solana confirm -v <sig> --url devnet`, `cast receipt <hash> --rpc-url <chain rpc>`). Save screenshots to montions-app/docs/screens/e2e-*. Report tx ids per chain, bugs fixed (file:line), anything still broken.
