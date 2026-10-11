Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first. READ-ONLY job: do not modify any file.

This is a follow-up to /home/arg/projects/hack/colessolana/.orchestra/jobs/sol-review-codex.md. The first run produced no output because the request was flagged by a content filter, so this brief is reframed as an internal defensive code review of our own unreleased program before launch.

Task: review the Solana program at montions-sol/programs/montions/src/** for correctness and accounting bugs, against montions-sol/docs/SPEC.md. Focus on: account validation and PDA/seed checks, value conservation (vault vs seat balances, fees, rounding), state consistency on error paths (no partial mutation before Err), settlement window logic and price-account checks (owner, discriminator, feed id, verification level, staleness), and maker/treasury exposure limits.

Do not write exploit code, proof-of-concept transactions, or step-by-step attack payloads. Describe each issue as a defect: the failing invariant, the affected file and line, and the minimal code fix. Mark anything unverified as "needs test".

Output: numbered findings, most severe first, each with severity (critical/high/medium/low/info), file:line, the broken invariant, and the fix. Then a short list of areas checked and found sound.
