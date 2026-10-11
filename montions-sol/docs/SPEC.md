# Montions on Solana — Spec (v0.1, NORMATIVE)

Port of Montions (`../../montions`, Solidity on Monad; read its `docs/SPEC.md` §4 + §14 and `docs/THESIS.md`)
to a single Anchor program on **Solana devnet**. Same product: outcome-first binary options, a fully onchain
CLOB with price-time priority, 100% collateral, permissionless settlement on a real oracle, an onchain
model-priced maker. No backend, no indexer, no offchain matcher: the UI reads accounts over RPC.

Program id: `MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh` (keypair `target/deploy/montions-keypair.json`).
Toolchain: anchor-cli 0.32.1, anchor-lang/anchor-spl 0.32.1, solana-cli 3.1.x, platform-tools v1.53.
Build: `anchor build` (IDL → `target/idl/montions.json`, TS types → `target/types/montions.ts`).

## 1. What changed vs the EVM version (and why)

| EVM (Monad) | Solana |
|---|---|
| One `MontionsBook` holding every series | One **zero-copy `Market` account per market** holding its book, seats and stats (Phoenix-style), so matching touches a single account |
| Global per-user `cash` deposited into the Book | Wallet-in / wallet-out: `place_order` pulls exactly the escrow from the user's token account and pushes refunds/proceeds back in the same instruction. Only **makers** keep balances inside the market (a **seat**) |
| ERC-1155 YES/NO inside the Book | **Real SPL mints per market** (`["yes", market]`, `["no", market]`, decimals 0, authority = market PDA). Takers receive SPL tokens in their wallet; makers' fills accrue in the seat and are minted out on `withdraw_seat` |
| Separate series "above K" / "below K" | One market per (asset, strike, expiry): "asset ≥ strike at expiry?". **Above = buy YES, Below = buy NO** |
| Resolver contracts (TWAP / Pyth / Timelock) | Built-in Pyth settlement on the **Pyth sponsored PriceUpdateV2 accounts** that are live on devnet (no API key) |
| ERC-4626 MakerVault (LP shares) | Protocol maker PDA + treasury; permissionless `refresh_quotes` (Pyth prices can't be moved by the caller). LP shares are out of scope for v0.1 |
| `createSeries` permissionless | `create_market` permissionless on a strike grid / 5-minute expiry grid; the UI can create a market and quote it in the same transaction as the user's first trade |

## 2. Repo layout and ownership

| Path | What | Owner |
|---|---|---|
| `programs/montions/src/{constants,errors,state,events,lib}.rs`, all `#[derive(Accounts)]` structs in `instructions/*` | frozen interface (errors: append-only) | main |
| `programs/montions/src/engine.rs`, `programs/montions/tests/engine_*.rs` | matching engine + accounting, host tests | **engine** |
| `programs/montions/src/pricing.rs`, `maker_model.rs`, `programs/montions/tests/pricing_*.rs`, `sdk/src/pricing.ts` | fixed-point N(d2), ladder | **pricing** |
| `programs/montions/src/oracle.rs`, handler bodies in `instructions/*`, `tests/` (TS LiteSVM integration) | Anchor glue, Pyth parsing, CPIs | **program** |
| `sdk/`, `keeper/`, `scripts/` | TS SDK, keeper bot, devnet init/seed scripts | **sdk** |
| `../montions-app/` | multi-chain UI (Base + Solana) | **ui** (+ adapters: `src/chains/solana.ts` by **sdk**, `src/chains/base.ts` by **base**) |
| `../montions-base/` | EVM version on Base Sepolia | **base** |

### Sandbox workflow (parallel agents share one crate)
1. `mkdir -p ../montions-sol-wt && rsync -a --delete --exclude target --exclude node_modules --exclude .anchor ./ ../montions-sol-wt/<name>/` then
   `cp -r target/deploy ../montions-sol-wt/<name>/target/` is NOT needed for host tests; for `anchor build` in a sandbox copy
   `target/deploy/montions-keypair.json` into the sandbox so the program id matches.
2. Work and test in your sandbox (`cargo test -p montions`, `anchor build`). Use `CARGO_TARGET_DIR` inside your sandbox.
3. Create/edit only the paths you own. If you need something another owner hasn't delivered yet, stub it **in your sandbox only**.
4. When your tests pass, copy ONLY your owned files back to `/home/arg/projects/hack/colessolana/montions-sol/...`.
5. Never run git. Never change frozen files; report needed interface changes to the main agent instead.
6. Report: files delivered, test output summary, deviations, open risks.

## 3. Units, accounts, PDAs

- Collateral: SPL mint, **6 decimals** (devnet: program-owned "tUSDC" PDA mint with a faucet). `UNIT = 1_000_000` = $1 payout.
- Prices are ticks **1..=99** (cents). `TICK_UNIT = 10_000`. YES price p ⇔ NO price 100−p.
- Strikes and settlement prices: **u64/i64 USD × 1e8** (`PRICE_DECIMALS = 8`).
- Outcome mints: decimals 0 (1 token = 1 contract).

PDAs (all under the program id):
| Account | Seeds |
|---|---|
| Config | `["config"]` |
| Collateral mint (tUSDC) | `["collateral"]` (mint authority = Config PDA) |
| Maker (signer / seat owner) | `["maker"]` |
| Maker treasury (token acct) | `["treasury"]` (authority = Maker PDA) |
| Asset | `["asset", symbol_bytes]` |
| Market | `["market", asset, strike.to_le_bytes() (u64), expiry.to_le_bytes() (i64)]` |
| YES / NO mint | `["yes", market]`, `["no", market]` (authority = Market PDA) |
| Market vault (token acct) | `["vault", market]` (authority = Market PDA) |
| Faucet claim | `["faucet", user]` |

### 3.1 `Market` byte layout (account data offsets incl. the 8-byte discriminator) — FROZEN
```
0    disc[8]            8    asset            40   feed_id[32]      72   creator
104  yes_mint           136  no_mint          168  vault            200  strike u64
208  expiry i64         216  created_at i64   224  settle_price i64 232  settle_publish_time i64
240  pool u64           248  yes_total u64    256  no_total u64     264  fees u64
272  volume u64         280  next_order_id    288  bid_bits [u64;2] 304  ask_bits [u64;2]
320  status u8  321 outcome  322 bump  323 vault_bump  324 yes_mint_bump  325 no_mint_bump
326  last_trade_tick u8  327 trade_head u8    328  trade_count u32  332 free_head u8  333 pad[3]
336  reserved [u64;4]
368  bid_levels [Level;100]  (Level = {head u8, tail u8}; index = tick)
568  ask_levels [Level;100]
768  orders [Order;64]  Order(32) = id u64 | qty u64 | ts i64 | seat u8 | side u8 | tick u8 | from_held u8 | prev u8 | next u8 | pad[2]
2816 seats  [Seat;24]   Seat(88)  = owner[32] | cash | locked | yes | no | yes_locked | no_locked (u64 each) | open_orders u32 | pad[4]
4928 trades [Trade;16]  Trade(16) = ts i64 | qty u32 | tick u8 | taker_is_buyer u8 | pad[2]
5184 end  (account space = 8 + MARKET_SIZE = 5184)
```
Bitmaps: bit `t` of `[lo, hi]` (lo = ticks 0..63, hi = 64..127) set ⇔ level `t` non-empty. `NIL = 255`.
Order slot free ⇔ `id == 0` (free slots are linked through `next` from `free_head`). Seat free ⇔ `owner == default`.

## 4. Instructions (accounts are frozen in `instructions/*`)

Admin: `initialize(InitParams)`, `set_params(ParamsUpdate)`, `add_asset(AddAssetArgs)` (validates the passed price
account is a PriceUpdateV2 for `feed_id`), `set_asset(AssetUpdate)`, `mint_collateral(amount)` (devnet tUSDC only),
`withdraw_fees()`.

Users / anyone:
- `faucet()` — mints `config.faucet_amount` tUSDC to the caller's ATA (created if needed) if
  `now - claim.last_claim >= config.faucet_cooldown`.
- `create_market(strike, expiry)` — not paused; asset active; `strike > 0 && strike % asset.strike_step == 0`;
  `expiry % EXPIRY_GRID == 0`; `now + MIN_DURATION <= expiry <= now + MAX_DURATION`. Writes header (asset, feed_id,
  creator, mints, vault, strike, expiry, created_at, bumps), calls `init_book()`, bumps `config.market_count` and
  `asset.market_count`, emits `MarketCreated`.
- `place_order(PlaceArgs) -> PlaceResult` — `e = Market::required_escrow(args, fee_bps)`; transfer `e.cash` user→vault,
  burn `e.yes` from `user_yes`, burn `e.no` from `user_no`; `r = place_taker(user, args, fee_bps, now)`; transfer
  `r.cash_out` vault→user, mint `r.yes_out` / `r.no_out` to the user. When paused, only `from_held` orders are allowed.
- `cancel_order(order_id)`; `withdraw_seat()` (pays out `take_seat_free`: cash transfer, YES/NO minted).
  `cancel_order` also pays out the seat's free balances.
- `split(qty)` (not paused, before expiry): transfer `qty*UNIT` in, mint `qty` YES + `qty` NO.
- `merge(qty)` (Open): burn `qty` YES + `qty` NO, transfer `qty*UNIT` out.
- `redeem(yes_qty, no_qty) -> payout` (Resolved/Void): burn, transfer payout.
- `resolve()`, `void_market()` — §7.
- `refresh_quotes()`, `maker_sweep()` — §6.

Every instruction leaves **`vault.amount == Σ seat.cash + Σ seat.locked + pool + fees`** and
**`yes_mint.supply + Σ seat.(yes + yes_locked) == yes_total`** (same for NO).

## 5. Engine semantics (`impl Market` in engine.rs)

**Atomicity:** every engine method either succeeds or returns `Err` with the `Market` **unchanged** (validate
everything — status, expiry, ticks, qty, POST_ONLY crossing, seat/order capacity for a resting remainder — before
mutating). The maker relies on this to skip a quote that would cross.

Order intents:
| Side | `from_held = false` | `from_held = true` |
|---|---|---|
| Bid (tick L) | **buy YES**, escrow cash `qty*L*TU` | **close NO** (sell NO at ≥ 100−L), escrow `qty` NO |
| Ask (tick L) | **write YES** (= buy NO at ≤ 100−L), escrow cash `qty*(100−L)*TU` | **sell YES** at ≥ L, escrow `qty` YES |

A fill of `f` contracts at the **resting order's tick p** between bid party B and ask party A:
1. B cash + A cash → mint `f` pairs: YES→B, NO→A; `pool += f*UNIT`; `yes_total += f`; `no_total += f`.
2. B cash + A held YES → YES moves A→B; A receives `f*p*TU` cash.
3. B held NO + A cash → NO moves B→A; B receives `f*(100−p)*TU` cash (from A's escrow).
4. B held NO + A held YES → burn `f` pairs; `pool −= f*UNIT`; totals −= f; A receives `f*p*TU`, B receives `f*(100−p)*TU`.

Matching: a Bid taker matches resting Asks with tick ≤ L (lowest first, FIFO within a tick); an Ask taker matches
resting Bids with tick ≥ L (highest first). Price improvement `(L−p)` (Bid) / `(p−L)` (write Ask) is refunded.
- **TIF:** GTC rests the remainder at L (seat allocated on demand; `SeatsFull` / `BookFull` → error); IOC refunds it;
  POST_ONLY errors `WouldCross` if any resting order would match (before any mutation).
- **Self-trade prevention:** if the best resting order belongs to the taker's own seat owner, cancel it (escrow → that
  seat's free balances) and continue. Counts toward `max_fills` (0 ⇒ 32). If the bound is hit while still crossing, a GTC
  remainder does **not** rest (refunded, `resting = 0`).
- **min_filled:** `filled < args.min_filled` ⇒ `MinFillNotMet`.
- **Fees (taker only, spec A4):** base = Σ fills of: cash Bid `f*p*TU`; write Ask `f*(100−p)*TU`; held sells = proceeds
  (`f*p*TU` for sell YES, `f*(100−p)*TU` for close NO). `fee = ceil(base*fee_bps/10_000)` once per order → `fees`.
  Cash-backed takers reserve `ceil(escrow_cash*fee_bps/10_000)` up front (included in `required_escrow.cash`), unused
  reserve refunded; held sells pay the fee from proceeds.
- **Outputs (`place_taker`):** `yes_out` = YES bought + unmatched held YES refunded (IOC); `no_out` = NO received + unmatched
  held NO refunded; `cash_out` = unused escrow + fee-reserve refund + proceeds − fee. Resting remainder escrow moves into
  the taker's seat (`locked` / `yes_locked` / `no_locked`), `open_orders += 1`.
- **`place_from_seat`:** identical matching, escrow debited from the seat's free balances (`InsufficientCash` /
  `InsufficientTokens`), outputs credited to the seat.
- **Makers' credits** go to their seat: cash proceeds → `cash`; received YES/NO → `yes`/`no`; consumed escrow leaves
  `locked`/`yes_locked`/`no_locked`; `open_orders −= 1` when an order is fully filled; slot returned to the free list.
- Each fill appends `{ts, qty, tick=p, taker_is_buyer = (taker side == Bid)}` to the trade ring, `volume += f`,
  `last_trade_tick = p`, `trade_count += 1`.
- Trading requires `status == OPEN && now < expiry` (`MarketNotOpen` / `Expired`). `cancel_order` works any time.
- `split` (Open, now < expiry), `merge` (Open). `settle`/`void` (Open only → `AlreadySettled`).
- `redeem`: Resolved ⇒ `(outcome==1 ? yes_qty : no_qty) * UNIT`; Void ⇒ `(yes_qty + no_qty) * UNIT / 2`. `pool −= payout`,
  `yes_total −= yes_qty`, `no_total −= no_qty`. `redeem_seat` does the same for a seat's free YES/NO into its `cash`.
- Bounds: `1 <= qty <= MAX_ORDER_QTY`, ticks 1..=99, checked arithmetic everywhere (`MathOverflow`).

Invariants (engine tests must check after every op of a randomized sequence against a simple reference model):
1. Open: `pool == yes_total*UNIT == no_total*UNIT`. Resolved: `pool == winning_total*UNIT`. Void: `2*pool == (yes_total+no_total)*UNIT`.
2. Collateral conservation: `Σ seat.cash + Σ seat.locked + pool + fees == Σ collateral in − Σ collateral out` (track in the test harness).
3. Per seat: `locked == Σ over its open cash orders of escrow`; `yes_locked`/`no_locked == Σ its held orders' qty`; `open_orders` matches.
4. Levels: FIFO lists consistent (prev/next), bitmap bit ⇔ level non-empty, `level_qty == Σ order qty`, free list covers exactly the free slots.
5. Price-time priority: no better-priced or older same-priced resting order is skipped (except STP cancels).
6. `yes_total == Σ seat.(yes + yes_locked) + (YES held by wallets in the harness)`.

## 6. Protocol maker (`maker_model.rs` + `refresh_quotes` / `maker_sweep`)

Fair value: `fair = digital_prob_above_wad(spot_e8, strike, asset.vol_bps, expiry − now)` (N(d2), zero rate).
Ladder (port the spirit of `MakerVault.sol`): centre `prob_to_tick(fair)`; half-spread
`max(params.min_half_spread, time-decay width)`; `params.levels` levels per side spaced `params.level_spacing`;
ticks clamped to 1..=99, bids < asks; each level sized to ≈ `level_notional` of escrow; inventory first (held YES →
`from_held` asks, held NO → `from_held` bids); total cash escrow ≤ `seat_cash + topup_available`.

`refresh_quotes` (permissionless): require maker enabled & not paused & market Open; if `expiry − now < min_tte`, only
cancel the maker's orders and return. Load the price (§7 checks + `now − publish_time <= max_price_age`), compute fair,
`seat = seat_or_alloc(maker)`, `cancel_all(seat)`, `topup_available = min(treasury.amount,
max_market_exposure.saturating_sub(seat.cash + seat.locked))`, build the ladder, transfer
`cash_needed − seat.cash` (if positive) treasury→vault signed by the maker PDA + `credit_seat_cash`, then
`place_from_seat(.., TIF_POST_ONLY)` for each quote, **skipping** quotes that error. Emit `QuotesRefreshed`.

`maker_sweep` (permissionless): if Resolved/Void → `cancel_all`, `redeem_seat`; if Open and within `min_tte` of expiry
→ `cancel_all`; then move the seat's free cash (`take_seat_free`; YES/NO must be 0 after redemption, otherwise keep them)
vault→treasury.

## 7. Oracle and settlement

Pyth **PriceUpdateV2** (owner `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`), Borsh layout:
`disc[8] = sha256("account:PriceUpdateV2")[..8]` · `write_authority[32]` · `verification_level` (enum: `0 = Partial{num_signatures:u8}`
(2 bytes), `1 = Full` (1 byte)) · `feed_id[32]` · `price i64` · `conf u64` · `exponent i32` · `publish_time i64` ·
`prev_publish_time i64` · `ema_price i64` · `ema_conf u64` · `posted_slot u64`. Only **Full** verification is accepted.

Devnet sponsored accounts (shard 0, live, updated every ~1–5 s):
SOL `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` · BTC `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` ·
ETH `42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC` · BNB `A3qp5QG9xGeJR1gexbW9b9eMMsMDLzx3rhud9SnNhwb4` ·
XRP `Ae3LGcV5Wt5Z11xvhxSX1h65uNyjuX4qYFFbgifLx5eX` · DOGE `681QkKLoAQrB5h23Ewq9c8rjM19RBuzqwXZf2RPr9Pyw`
(feed ids: see `config/assets.devnet.json`). Push-oracle PDA = `[shard u16 LE, feed_id]` under `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`.

`resolve` (anyone, `now > expiry`, status Open): price account owner/discriminator/Full; `feed_id == market.feed_id`;
accept iff `publish_time >= expiry` **and** (`publish_time <= expiry + asset.settle_window` **or**
`prev_publish_time < expiry` — i.e. provably the first Pythnet print at/after expiry, e.g. a posted Hermes update);
`conf * 10_000 <= max_conf_bps * |price|`; `price_e8 = to_e8(price, expo)`; **YES iff `price_e8 >= strike`**.
Errors: `PriceNotReady` (print before expiry), `PriceStale` (outside the window and not first-print), `PriceTooUncertain`.
`void_market` (anyone): Open and `now >= expiry + VOID_GRACE` → Void.

Honesty (docs + UI): the sponsored-feed path lets the resolver pick any print inside `[expiry, expiry + settle_window]`
(60 s on devnet); a keeper resolves within seconds, and anyone can resolve earlier. The strict first-print path removes
the choice entirely when a verified update for exactly that moment is posted.

## 8. SDK, keeper, scripts (`sdk/`, `keeper/`, `scripts/`)

TypeScript (`@coral-xyz/anchor` 0.32.1, `@solana/web3.js` ^1.98, `@solana/spl-token`). SDK: IDL + types copied from
`target/`, PDA helpers, a byte-offset `decodeMarket` (§3.1) with a unit test against an engine-produced fixture,
`decodePythPrice`, book depth / best bid-ask, `quoteBuy(market, outcome, budget)` (walk asks for YES, bids for NO; returns
contracts, avg & worst price, limit tick, max payout), `fairProb` (TS twin of pricing.rs), `MontionsClient` with
transaction builders that prepend `ComputeBudgetProgram.setComputeUnitLimit` and idempotent ATA creation, and a
`buildBuyTx` that, when the market does not exist yet, prepends `create_market` + `refresh_quotes` so the user's first
trade creates and quotes the market in one transaction. Keeper: create a ladder of markets per asset (strikes around spot
on the grid × expiries on the grid), `refresh_quotes` on a cadence / on price moves, `resolve` within seconds after expiry,
`maker_sweep` after settlement. Scripts: init config + collateral, add the 6 assets, fund the treasury, seed markets.

## 9. Multi-chain UI contract

`../montions-app/src/chains/types.ts` (FROZEN, main) defines `ChainAdapter`. The UI codes only against it; the Solana
adapter lives in `src/chains/solana.ts`, the Base adapter in `src/chains/base.ts`.
