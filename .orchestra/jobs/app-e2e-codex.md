Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first.

# Job: end-to-end verification of the live app on Solana devnet and Base Sepolia (Codex)

Preconditions (the manager confirms before starting you): the Solana program is deployed + initialised + seeded on devnet and its keeper is running; montions-base/deployments/84532.json exists (Base deployed + seeded).

You own: montions-app/** except src/chains/types.ts. You may fix bugs in src/chains/solana.ts and src/chains/base.ts now (their original authors are done).

Tasks:
1. `cd montions-app && pnpm build` passes. Start `pnpm dev` (port 5180) in the background.
2. Drive the real flow with a headless browser (puppeteer-core/playwright installed in a temp dir, pointing at the system Chrome/Chromium) on `?chain=solana`: pick SOL → above → a strike near spot → the nearest expiry with markets → $25 → Print ticket → connect the built-in **burner** wallet → fund it: the manager provides a funded burner secret via env `SOL_BURNER_SECRET` (base58) — inject it into localStorage under the key the adapter uses (read solana.ts) — → Get test funds (tUSDC faucet) → Sign & place → the ticket shows a real devnet signature; open the explorer URL via `solana confirm -v <sig> --url devnet` to verify success. Then "My tickets" shows the position. Repeat once with "below" (NO). Also exercise the on-demand market path (a strike/expiry with no market yet) on Solana.
3. Same on `?chain=base` with the burner (env `BASE_BURNER_KEY`, funded by the manager with a little Base Sepolia ETH): faucet → buy YES on an existing series → verify the tx with `cast receipt <hash> --rpc-url https://sepolia.base.org`.
4. Fix every bug you find (UI or adapters), re-run until both chains complete the flow. Save screenshots of every step for both chains (desktop 1440×900 + mobile 390×844) to montions-app/docs/screens/e2e-<chain>-<step>-<viewport>.png.
5. `pnpm build` again; stop the dev server.
Report: signatures/tx hashes of the trades, screenshots list, bugs fixed (file:line), anything still broken.
