# Tradgents — Colosseum project answers (backup before replacing with Kairo, 2026-10-12)

- Project name: Tradgents
- Website: https://tradgents-sol-web.vercel.app
- Category: AI Platforms / Agents
- Chains: Solana, Monad

## Brief description
A live timeline of AI trading agents on Solana. Agents trade from their own wallets through a signer that enforces limits they cannot edit. Every trade is read from the chain with its profit or loss, and scores show a 95% Sharpe range so luck looks like luck. Anything we cannot value stays unranked. Live on devnet, open source (MIT).

## What are you building, and who is it for?
Tradgents is a public timeline of AI trading agents. Each agent trades from its own Solana wallet. A worker reads the chain, replays every transaction (FIFO cost basis, fees split out, deposits and withdrawals excluded) and shows each trade with its profit or loss. Scores are Sharpe with a 95% range, so a lucky streak looks like luck, and anything we cannot value (unknown programs, unpriced tokens) stays visible but unranked. It is for two groups: people who build or run trading agents and want a public, checkable track record, and people who want to follow agents without trusting screenshots. Agents never hold a key: a signer run by their human holds it and enforces limits the agent cannot edit (allowed tokens, per-trade and daily limits, slippage), validates every instruction from the aggregator, simulates, and checks an oracle before signing.

## Why did you decide to build this, and why build it now?
Agents that trade real money are arriving faster than any way to check them. Today a claim is a screenshot, and an AI agent makes screenshots free. We wanted the claim to be checkable from the chain, and the risk to be bounded by something other than the agent behaving well. Why now: coding agents (Claude Code, Codex and others) can already run a trading command, Solana has the speed and fees to make small trades practical, and Jupiter and Orca provide the venues. We also saw how easily a leaderboard misleads (short streaks, unrealized positions, tokens with no real price), so the product refuses to rank what it cannot value.

## What technologies are you using?
Solana (Anchor registry program, @solana/kit, getTransaction replay), Jupiter swap and price APIs, Orca Whirlpools (devnet), Supabase Postgres (row-level security, restricted roles), Vercel, Next.js, TypeScript, Hono, Vitest. Also Monad (viem, Foundry, Uniswap V2) for a testnet port. AI tools: Claude Code, OpenAI Codex (GPT-6) and Grok via the Pi agent, which also reviewed each other's code.

## How does your product use these chains?
Solana: an Anchor registry program (devnet, 73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA) holds optional agent bonds and emits events our indexer reads. Ownership is proven with ed25519 wallet signatures. The whole track record is computed from getTransaction data (token balances, rent, fees, Jito tips, versioned transactions). Agents swap through Jupiter (mainnet venue) and Orca (devnet). Monad: the same design runs on Monad testnet with its own registry contract.

## Did anyone not listed do meaningful work?
No one outside the team. For transparency: much of the code was written with AI coding agents (Claude Code, OpenAI Codex / GPT-6, and Grok through the Pi agent) under my direction, and the models reviewed each other's work. I checked behaviour by running it: tests, a real Postgres, and live devnet trades.

## Anything else judges should know?
Everything runs on Solana devnet (and Monad testnet): the mainnet code exists and was reviewed, but is not deployed or audited, and there are no external users yet. Try the live app at https://tradgents-sol-web.vercel.app. Real devnet transactions are listed in docs/COLOSSEUM.md in the repo.
