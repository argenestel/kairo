Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (incl. the DIRECTION UPDATE).

# Job: finish + polish the Montions UI (Grok)

This continues /home/arg/projects/hack/colessolana/.orchestra/jobs/ui-polish-codex.md — read it fully; every requirement there still applies, EXCEPT where the DIRECTION UPDATE changes things. A Codex run made partial progress before it ran out of credits (its last notes mention an inline insufficient-balance failure, faucet, successful retry and receipt editing) — inspect the current state of montions-app first (`pnpm build`, read src/), and continue.

You own montions-app/** EXCEPT: src/chains/types.ts (frozen), src/chains/solana.ts, src/chains/base.ts, src/chains/evm.ts (adapter jobs), src/mascot/** and public/mascot/** (mascot job). Ignore tsc errors that come only from files you don't own.

Scope for THIS job (modes, multi-chain routing and the paper/docs pages come in a later job — but structure the code so they slot in): finish all 6 steps + chrome to the quality bar in the original brief, make the chain switch data-driven from a registry (src/chains/index.ts) that can hold Base, Arbitrum, Hyperliquid, Solana and Demo entries (Arbitrum/Hyperliquid can point at the mock until their adapters exist, clearly badged "coming online"), and introduce a theme/token layer (CSS variables grouped per theme, a `data-mode` attribute on <html>) so a second visual mode can be added without touching components. Visually verify with screenshots (desktop 1440×900 + mobile 390×844) of every step as the brief says; save them to montions-app/docs/screens/.
