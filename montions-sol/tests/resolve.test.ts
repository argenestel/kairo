import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  balances,
  bootstrap,
  BTC_FEED,
  createMarket,
  E8,
  Env,
  EXPIRY,
  feeOf,
  MarketKeys,
  refresh,
  SIDE_BID,
  SOL_PRICE_ACCOUNT,
  SPOT,
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_VOID,
  TICK_UNIT,
  trader,
  UNIT,
  VOID_GRACE,
} from "./lib/harness";

/// A market with two holders: `yes` holds 6 YES, `no` holds 6 NO (via split + swap).
async function withHolders() {
  const env = await bootstrap();
  const mk = await createMarket(env);
  const y = await trader(env, mk);
  const n = await trader(env, mk);
  await env.exec([env.ixSplit(mk, y.publicKey, 6n)], [y]);
  await env.exec([env.ixSplit(mk, n.publicKey, 6n)], [n]);
  // hand all NO from y and all YES from n to each other via SPL transfers is not needed:
  // each simply keeps both legs; tests redeem selectively.
  return { env, mk, y, n };
}

/// Posted update (any Pyth-owned account) for the market's feed.
function post(env: Env, o: { price: bigint; publishTime: number; prevPublishTime?: number; conf?: bigint; expo?: number; feedId?: Buffer }) {
  const k = Keypair.generate().publicKey;
  env.setPyth(k, o);
  return k;
}

describe("resolve", () => {
  it("rejects before expiry, prints before expiry, stale prints; accepts the window", async () => {
    const { env, mk } = await withHolders();
    env.setTime(EXPIRY);
    const inWindow = post(env, { price: SPOT, publishTime: EXPIRY + 30 });
    await env.fails("NotExpired", [env.ixResolve(mk, inWindow)], [env.admin]); // now == expiry
    env.setTime(EXPIRY + 100);
    await env.fails("PriceNotReady", [env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY - 1 }))], [env.admin]);
    // after the window and not provably the first print
    await env.fails("PriceStale", [env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY + 61, prevPublishTime: EXPIRY + 60 }))], [env.admin]);
    await env.fails("PriceStale", [env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY + 61, prevPublishTime: EXPIRY }))], [env.admin]);
    // confidence: > 2% fails
    await env.fails("PriceTooUncertain", [env.ixResolve(mk, post(env, { price: SPOT, conf: (SPOT * 2n) / 100n + 1n, publishTime: EXPIRY + 5 }))], [env.admin]);
    // wrong feed, wrong owner, partial verification
    await env.fails("FeedMismatch", [env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY + 5, feedId: BTC_FEED }))], [env.admin]);
    const fake = Keypair.generate().publicKey;
    env.setPyth(fake, { price: SPOT, publishTime: EXPIRY + 5 }, Keypair.generate().publicKey);
    await env.fails("BadPriceAccount", [env.ixResolve(mk, fake)], [env.admin]);
    const partial = Keypair.generate().publicKey;
    env.setPyth(partial, { price: SPOT, publishTime: EXPIRY + 5, partial: true });
    await env.fails("PriceNotVerified", [env.ixResolve(mk, partial)], [env.admin]);
    // window end is inclusive; any Pyth-owned posted account is accepted
    const edge = post(env, { price: SPOT, publishTime: EXPIRY + 60, conf: (SPOT * 2n) / 100n });
    await env.exec([env.ixResolve(mk, edge)], [env.admin]);
    const m = env.market(mk);
    expect([m.status, m.outcome, m.settlePrice, m.settlePublishTime]).to.deep.eq([STATUS_RESOLVED, 1, SPOT, BigInt(EXPIRY + 60)]);
    await env.fails("AlreadySettled", [env.ixResolve(mk, inWindow)], [env.admin]);
  });

  it("strict first-print path: a print after the window whose predecessor is before expiry", async () => {
    const { env, mk } = await withHolders();
    env.setTime(EXPIRY + 4_000);
    const first = post(env, { price: SPOT - 1n, publishTime: EXPIRY + 3_600, prevPublishTime: EXPIRY - 1 });
    await env.exec([env.ixResolve(mk, first)], [env.admin]);
    const m = env.market(mk);
    expect([m.status, m.outcome, m.settlePublishTime]).to.deep.eq([STATUS_RESOLVED, 0, BigInt(EXPIRY + 3_600)]);
  });

  it("YES iff price >= strike (equality is YES), with exponent rescaling", async () => {
    for (const [price, expo, yes] of [
      [SPOT, -8, 1], // equal
      [SPOT - 1n, -8, 0], // one 1e-8 below
      [15_000_000n, -5, 1], // $150.00000 at expo -5
      [14_999_999n, -5, 0],
      [1_500_000_000_001n, -10, 1], // truncation keeps >= exact
      [1_499_999_999_999n, -10, 0],
    ] as [bigint, number, number][]) {
      const env = await bootstrap();
      const mk = await createMarket(env);
      env.setTime(EXPIRY + 1);
      await env.exec([env.ixResolve(mk, post(env, { price, expo, publishTime: EXPIRY, conf: 0n }))], [env.admin]);
      expect(env.market(mk).outcome, `${price}e${expo}`).to.eq(yes);
    }
  });

  it("redeem pays the winners; losers burn for 0; NotSettled before", async () => {
    const { env, mk, y, n } = await withHolders();
    await env.fails("NotSettled", [env.ixRedeem(mk, y.publicKey, 1n, 0n)], [y]);
    env.setTime(EXPIRY + 10);
    await env.exec([env.ixResolve(mk, post(env, { price: SPOT + E8, publishTime: EXPIRY + 3 }))], [env.admin]); // YES
    const y0 = balances(env, mk, y.publicKey);
    const meta = await env.exec([env.ixRedeem(mk, y.publicKey, 6n, 0n)], [y]);
    expect(Buffer.from(meta.returnData().data()).readBigUInt64LE(0)).to.eq(6n * UNIT);
    let y1 = balances(env, mk, y.publicKey);
    expect([y1.cash - y0.cash, y1.yes, y1.no]).to.deep.eq([6n * UNIT, 0n, 6n]);
    await env.exec([env.ixRedeem(mk, y.publicKey, 0n, 6n)], [y]); // losing NO: 0
    y1 = balances(env, mk, y.publicKey);
    expect([y1.cash - y0.cash, y1.no]).to.deep.eq([6n * UNIT, 0n]);
    await env.fails("BadQty", [env.ixRedeem(mk, n.publicKey, 0n, 0n)], [n]);
    await env.fails("InsufficientTokens", [env.ixRedeem(mk, n.publicKey, 7n, 0n)], [n]);
    await env.exec([env.ixRedeem(mk, n.publicKey, 6n, 6n)], [n]);
    const m = env.market(mk);
    expect([m.pool, m.yesTotal, m.noTotal]).to.deep.eq([0n, 0n, 0n]);
    expect(env.tokenBalance(mk.vault)).to.eq(0n);
  });

  it("NO outcome pays NO holders", async () => {
    const { env, mk, n } = await withHolders();
    env.setTime(EXPIRY + 10);
    await env.exec([env.ixResolve(mk, SOL_PRICE_ACCOUNT_AT(env, SPOT - E8, EXPIRY + 1))], [env.admin]);
    const b0 = balances(env, mk, n.publicKey);
    await env.exec([env.ixRedeem(mk, n.publicKey, 6n, 6n)], [n]);
    expect(balances(env, mk, n.publicKey).cash - b0.cash).to.eq(6n * UNIT);
  });

  it("resolved seats: makers withdraw then redeem; cancel works after settlement", async () => {
    const env = await bootstrap();
    const mk = await createMarket(env);
    const a = await trader(env, mk);
    const b = await trader(env, mk);
    const g = await env.exec([env.ixPlace(mk, a.publicKey, { side: SIDE_BID, tick: 40, qty: 10n, tif: 0 })], [a]);
    const orderId = env.placeResult(g).orderId;
    await env.exec([env.ixPlace(mk, b.publicKey, { side: 1, tick: 40, qty: 4n })], [b]); // a gets 4 YES in seat
    env.setTime(EXPIRY + 5);
    await env.exec([env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY + 1 }))], [env.admin]);
    const a0 = balances(env, mk, a.publicKey);
    await env.exec([env.ixCancel(mk, a.publicKey, orderId)], [a]); // refunds 6*40 and mints 4 YES
    const a1 = balances(env, mk, a.publicKey);
    expect([a1.cash - a0.cash, a1.yes]).to.deep.eq([6n * 40n * TICK_UNIT, 4n]);
    await env.exec([env.ixRedeem(mk, a.publicKey, 4n, 0n)], [a]);
    expect(balances(env, mk, a.publicKey).cash - a1.cash).to.eq(4n * UNIT);
    await env.exec([env.ixRedeem(mk, b.publicKey, 0n, 4n)], [b]);
    expect(env.market(mk).pool).to.eq(0n);
  });
});

function SOL_PRICE_ACCOUNT_AT(env: Env, price: bigint, publishTime: number): PublicKey {
  env.setPyth(SOL_PRICE_ACCOUNT, { price, publishTime });
  return SOL_PRICE_ACCOUNT;
}

describe("void_market", () => {
  it("only after expiry + VOID_GRACE; redeems 50/50; final", async () => {
    const { env, mk, y } = await withHolders();
    env.setTime(EXPIRY + VOID_GRACE - 1);
    await env.fails("VoidTooEarly", [env.ixVoid(mk)], [env.admin]);
    env.setTime(EXPIRY + VOID_GRACE);
    await env.exec([env.ixVoid(mk)], [env.newUser()]);
    expect(env.market(mk).status).to.eq(STATUS_VOID);
    await env.fails("AlreadySettled", [env.ixVoid(mk)], [env.admin]);
    await env.fails("AlreadySettled", [env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY + 1, prevPublishTime: EXPIRY - 1 }))], [env.admin]);
    const b0 = balances(env, mk, y.publicKey);
    await env.exec([env.ixRedeem(mk, y.publicKey, 3n, 0n)], [y]);
    await env.exec([env.ixRedeem(mk, y.publicKey, 0n, 1n)], [y]);
    expect(balances(env, mk, y.publicKey).cash - b0.cash).to.eq(2n * UNIT); // 4 × 0.5
    await env.exec([env.ixRedeem(mk, y.publicKey, 3n, 5n)], [y]);
    expect(balances(env, mk, y.publicKey).cash - b0.cash).to.eq(6n * UNIT);
  });

  it("cannot void a resolved market", async () => {
    const { env, mk } = await withHolders();
    env.setTime(EXPIRY + VOID_GRACE + 5);
    await env.exec([env.ixResolve(mk, post(env, { price: SPOT, publishTime: EXPIRY + 3_000, prevPublishTime: EXPIRY - 2 }))], [env.admin]);
    await env.fails("AlreadySettled", [env.ixVoid(mk)], [env.admin]);
  });

  it("maker inventory in a voided market is swept at 50/50", async () => {
    const env = await bootstrap();
    const mk = await createMarket(env);
    const t0 = env.tokenBalance(env.treasury);
    await refresh(env, mk);
    const u = await trader(env, mk);
    await env.exec([env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 99, qty: 10n })], [u]); // 10 @ maker best ask
    const paid = 10n * 52n * TICK_UNIT;
    env.setTime(EXPIRY + VOID_GRACE);
    await env.exec([env.ixVoid(mk)], [env.admin]);
    await env.exec([env.ixSweep(mk)], [env.admin]);
    expect(env.tokenBalance(env.treasury) - t0).to.eq(paid - 5n * UNIT);
    await env.exec([env.ixRedeem(mk, u.publicKey, 10n, 0n)], [u]);
    expect(env.market(mk).pool).to.eq(0n);
  });
});

describe("withdraw_fees", () => {
  it("admin collects non-zero taker fees from the vault", async () => {
    const env = await bootstrap({ feeBps: 100 });
    const mk = await createMarket(env);
    await refresh(env, mk);
    const u = await trader(env, mk);
    await env.exec([env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 99, qty: 7n })], [u]);
    const fees = env.market(mk).fees;
    expect(fees).to.eq(feeOf(7n * 52n * TICK_UNIT, 100));
    expect(fees > 0n).to.be.true;
    const dest = env.ata(env.collateralMint, env.admin.publicKey);
    env.send([createAssociatedTokenAccountIdempotentInstruction(env.admin.publicKey, dest, env.admin.publicKey, env.collateralMint)], [env.admin]);
    const eve = env.newUser();
    await env.fails("BadAccount", [env.ixWithdrawFees(mk, dest, eve.publicKey)], [eve]);
    const v0 = env.tokenBalance(mk.vault);
    await env.exec([env.ixWithdrawFees(mk, dest)], [env.admin]);
    expect(env.tokenBalance(dest)).to.eq(fees);
    expect(v0 - env.tokenBalance(mk.vault)).to.eq(fees);
    expect(env.market(mk).fees).to.eq(0n);
    await env.exec([env.ixWithdrawFees(mk, dest)], [env.admin]); // zero: no-op
    expect(env.tokenBalance(dest)).to.eq(fees);
    // other market's vault cannot be drained through this market
    const mk2 = await createMarket(env, 151n * E8);
    const bad = await env.program.methods
      .withdrawFees()
      .accountsStrict({ config: env.config, market: mk.market, vault: mk2.vault, destination: dest, admin: env.admin.publicKey, tokenProgram: require("@solana/spl-token").TOKEN_PROGRAM_ID })
      .instruction();
    await env.fails("BadAccount", [bad], [env.admin]);
    expect(env.market(mk).status).to.eq(STATUS_OPEN);
  });
});
