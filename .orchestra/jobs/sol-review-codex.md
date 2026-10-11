Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first. READ-ONLY job: do not modify any file.

# Job: adversarial security review of the Montions Solana program (Codex — independent second review)

Scope: /home/arg/projects/hack/colessolana/montions-sol/programs/montions/src/** (engine.rs = matching/accounting,
instructions/*.rs = Anchor handlers + accounts, oracle.rs = Pyth PriceUpdateV2 parsing, pricing.rs + maker_model.rs =
fair value + maker ladder), against the normative spec montions-sol/docs/SPEC.md. Tests for reference: programs/montions/tests/
and montions-sol/tests/ (LiteSVM).

Hunt for real, exploitable or fund-affecting bugs. At minimum check:
- Account validation: every account a handler trusts (market↔vault↔mints↔asset, PDA seeds/bumps, token account mint/authority, signer checks, the maker PDA/treasury, price account owner/discriminator/feed id/verification level), duplicate/aliased mutable accounts (e.g. user_yes == user_no, vault passed as user account), type confusion between Market/Asset/Config, init_if_needed re-init risks.
- Value conservation: vault == Σ seat.cash + Σ seat.locked + pool + fees; SPL supply + seat balances == yes_total/no_total; rounding (fees ceil, void halves), overflow/underflow, any path that mints without collateral or pays out twice (redeem after settle, withdraw_seat after redeem_seat, cancel after settlement, merge after resolution, maker_sweep races).
- Matching engine: price-time priority, self-trade prevention, max_fills edge, POST_ONLY atomicity (Err must leave state unchanged — check every early return after a mutation), free-list/linked-list corruption, seat reuse while orders/balances remain, order id reuse.
- Settlement/oracle: can a caller choose a favourable print? (window logic, prev_publish_time path, posted PriceUpdateV2 accounts from anyone — note the Pyth receiver lets anyone post verified updates for any timestamp; does `prev_publish_time < expiry <= publish_time` really pin the first print?), conf check, exponent scaling, stale price for quoting, void timing.
- Maker: can anyone drain the treasury via refresh_quotes (e.g. quoting at manipulated fair, repeated refresh + adverse fills, exposure cap bypass by many markets), griefing (seat/order table exhaustion — 24 seats / 64 orders per market), DoS of resolution or of takers.
- Pause semantics (exits always allowed), admin powers (can admin move user funds or change outcomes?), compute-budget / stack DoS.

Output format: a numbered list of findings, most severe first. For each: severity (critical/high/medium/low/info), file:line, the concrete exploit or failure scenario (inputs → wrong outcome), and the minimal fix. Then a short list of things you checked and found sound. Mark anything you are unsure of as "needs test". No generic advice.
