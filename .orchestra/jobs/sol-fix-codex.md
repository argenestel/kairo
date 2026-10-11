Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first.

# Job: verify and fix the Solana security review findings (Codex)

Inputs: two independent reviews of the Montions Solana program:
- /home/arg/projects/hack/colessolana/.orchestra/out/sol-review-grok.md
- /home/arg/projects/hack/colessolana/.orchestra/out/sol-review-codex.md

You own (for this job): montions-sol/programs/montions/src/{engine,oracle,pricing,maker_model}.rs, the handler bodies in montions-sol/programs/montions/src/instructions/*.rs, montions-sol/programs/montions/tests/**, montions-sol/tests/**. Interface files (constants/errors/state/events/lib.rs and #[derive(Accounts)] structs) may be changed ONLY when a confirmed finding requires it (e.g. a missing account constraint); errors.rs is append-only; never change the Market byte layout. If you change an Accounts struct or instruction args, run `anchor build` and list the IDL change explicitly (the SDK must be updated by another job).

For EACH finding in both reviews (dedupe first):
1. Decide: confirmed / not a bug / out of scope, with a one-line justification grounded in the code.
2. For confirmed ones, first write a failing test that demonstrates it (host test in programs/montions/tests/ or LiteSVM test in montions-sol/tests/), then fix, then show the test passing.
Severity order: critical/high first; fix mediums when cheap; list lows.

Finally run everything and paste the summary lines:
- `cd montions-sol && cargo test -p montions`
- `cd montions-sol && anchor build && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'`
- `cd montions-sol/sdk && npx vitest run`
Report a table: finding → verdict → test → fix (file:line). Report the new .so size.
