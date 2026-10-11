import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  bookSide,
  bootstrap,
  BTC_FEED,
  createMarket,
  E8,
  Env,
  EXPIRY,
  makerParams,
  MarketKeys,
  MarketState,
  refresh,
  seatOf,
  SIDE_ASK,
  SIDE_BID,
  SOL_PRICE_ACCOUNT,
  SPOT,
  STATUS_RESOLVED,
  T0,
  TICK_UNIT,
  trader,
  UNIT,
} from "./lib/harness";

// TS twin of the fair value (float; tests allow ±1 tick).
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function fairTick(spot: bigint, strike: bigint, volBps: number, tte: number): number {
  const s = Number(spot) / Number(strike);
  const sig = volBps / 10_000;
  const T = tte / 31_536_000;
  const d2 = (Math.log(s) - (sig * sig * T) / 2) / (sig * Math.sqrt(T));
  return Math.min(99, Math.max(1, Math.round(normCdf(d2) * 100)));
}
function halfSpread(minHs: number, tte: number): number {
  return Math.max(minHs, Math.min(12, Math.max(1, Math.ceil(4 * Math.sqrt(600 / tte)))));
}
function makerOrders(env: Env, m: MarketState) {
  const idx = m.seats.findIndex((s) => s.owner.equals(env.maker));
  return { bids: bookSide(m, SIDE_BID).filter((o) => o.seat === idx), asks: bookSide(m, SIDE_ASK).filter((o) => o.seat === idx) };
}
function escrowOf(o: { side: number; tick: number; qty: bigint; fromHeld: boolean }) {
  if (o.fromHeld) return 0n;
  return o.qty * BigInt(o.side === SIDE_BID ? o.tick : 100 - o.tick) * TICK_UNIT;
}

async function quoted(opts: { treasury?: bigint; maker?: any } = {}) {
  const env = await bootstrap(opts);
  const mk = await createMarket(env);
  return { env, mk };
}

describe("refresh_quotes", () => {
  it("posts a sane ladder around fair value, funded from the treasury", async () => {
    const { env, mk } = await quoted();
    const t0 = env.tokenBalance(env.treasury);
    await refresh(env, mk);
    const m = env.market(mk);
    const { bids, asks } = makerOrders(env, m);
    const f = fairTick(SPOT, SPOT, 8500, EXPIRY - T0);
    const hs = halfSpread(2, EXPIRY - T0);
    expect(bids.map((o) => o.tick)).to.deep.eq([f - hs, f - hs - 2]);
    expect(asks.map((o) => o.tick)).to.deep.eq([f + hs, f + hs + 2]);
    expect(Math.max(...bids.map((o) => o.tick))).to.be.lessThan(Math.min(...asks.map((o) => o.tick)));
    // each level ≈ level_notional (20 tUSDC) of escrow
    for (const o of [...bids, ...asks]) {
      const e = escrowOf(o);
      expect(e <= 20n * UNIT && e > 19n * UNIT, `level escrow ${e}`).to.be.true;
      expect(o.fromHeld).to.be.false;
    }
    const seat = seatOf(m, env.maker)!;
    const total = [...bids, ...asks].reduce((s, o) => s + escrowOf(o), 0n);
    expect(seat.locked).to.eq(total);
    expect(seat.cash).to.eq(0n); // topped up exactly to cash_needed
    expect(seat.locked + seat.cash <= 200n * UNIT).to.be.true;
    expect(t0 - env.tokenBalance(env.treasury)).to.eq(total);
    expect(env.tokenBalance(mk.vault)).to.eq(total);
    expect(seat.openOrders).to.eq(4);
  });

  it("re-quoting is idempotent and never exceeds max_market_exposure", async () => {
    const { env, mk } = await quoted({ maker: makerParams({ levels: 4, maxMarketExposure: new BN((50n * UNIT).toString()) }) });
    await refresh(env, mk);
    const t1 = env.tokenBalance(env.treasury);
    const m1 = env.market(mk);
    const s1 = seatOf(m1, env.maker)!;
    expect(s1.cash + s1.locked <= 50n * UNIT).to.be.true;
    expect(s1.locked > 45n * UNIT, "budget mostly used").to.be.true;
    await refresh(env, mk);
    const m2 = env.market(mk);
    const s2 = seatOf(m2, env.maker)!;
    expect(env.tokenBalance(env.treasury)).to.eq(t1);
    expect(s2.cash + s2.locked).to.eq(s1.cash + s1.locked);
    const sig = (m: MarketState) => {
      const { bids, asks } = makerOrders(env, m);
      return [...bids, ...asks].map((o) => `${o.side}:${o.tick}x${o.qty}`);
    };
    expect(sig(m2)).to.deep.eq(sig(m1));
    expect(m2.nextOrderId > m1.nextOrderId).to.be.true; // fresh orders
  });

  it("is bounded by the treasury balance", async () => {
    const { env, mk } = await quoted({ treasury: 10n * UNIT });
    await refresh(env, mk);
    const s = seatOf(env.market(mk), env.maker)!;
    expect(s.locked <= 10n * UNIT && s.locked > 9n * UNIT).to.be.true;
    expect(env.tokenBalance(env.treasury)).to.eq(10n * UNIT - s.locked);
  });

  it("with an empty treasury posts nothing (no error)", async () => {
    const { env, mk } = await quoted({ treasury: 0n });
    await refresh(env, mk);
    expect(bookSide(env.market(mk), SIDE_BID).length + bookSide(env.market(mk), SIDE_ASK).length).to.eq(0);
  });

  it("rejects stale, uncertain, non-canonical, partial and wrong-feed prices", async () => {
    const { env, mk } = await quoted();
    const now = env.now();
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: now - 61 });
    await env.fails("PriceStale", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: now - 60 });
    await env.exec([env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);

    // conf: 2% exactly passes, above fails
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, conf: (SPOT * 200n) / 10_000n + 1n, publishTime: now });
    await env.fails("PriceTooUncertain", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, conf: (SPOT * 200n) / 10_000n, publishTime: now });
    await env.exec([env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);

    // a valid Pyth account that is not the asset's canonical feed account
    const other = Keypair.generate().publicKey;
    env.setPyth(other, { price: SPOT, publishTime: now });
    await env.fails("BadPriceAccount", [env.ixRefresh(mk, other)], [env.admin]);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: now }, Keypair.generate().publicKey);
    await env.fails("BadPriceAccount", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: now, partial: true });
    await env.fails("PriceNotVerified", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: now, feedId: BTC_FEED });
    await env.fails("FeedMismatch", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: 0n, conf: 0n, publishTime: now });
    await env.fails("BadPriceAccount", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
  });

  it("is blocked when disabled or paused; MarketNotOpen after settlement", async () => {
    const { env, mk } = await quoted();
    await env.exec([env.ixSetParams({ makerParams: makerParams({ enabled: false }) })], [env.admin]);
    await env.fails("MakerDisabled", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    await env.exec([env.ixSetParams({ makerParams: makerParams(), paused: true })], [env.admin]);
    await env.fails("Paused", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    await env.exec([env.ixSetParams({ paused: false })], [env.admin]);
    env.setTime(EXPIRY + 2);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: EXPIRY + 1 });
    await env.exec([env.ixResolve(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    await env.fails("MarketNotOpen", [env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
  });

  it("follows the price: deep in the money → high bids, no asks above 99", async () => {
    const { env, mk } = await quoted();
    env.setPyth(SOL_PRICE_ACCOUNT, { price: 160n * E8, publishTime: env.now() });
    await refresh(env, mk);
    const { bids, asks } = makerOrders(env, env.market(mk));
    const f = fairTick(160n * E8, SPOT, 8500, EXPIRY - T0);
    expect(f).to.eq(99);
    expect(asks.length).to.eq(0);
    expect(bids.map((o) => o.tick)).to.deep.eq([97, 95]);
    // slightly out of the money ($149.90 vs $150)
    const px = 14_990_000_000n;
    env.setPyth(SOL_PRICE_ACCOUNT, { price: px, publishTime: env.now() });
    await refresh(env, mk);
    const q = makerOrders(env, env.market(mk));
    const f2 = fairTick(px, SPOT, 8500, EXPIRY - T0);
    expect(f2).to.be.lessThan(50);
    expect(Math.abs(q.bids[0].tick + 2 - f2)).to.be.lessThanOrEqual(1);
    expect(q.asks[0].tick - q.bids[0].tick).to.eq(4);
  });

  it("pulls its quotes within min_tte of expiry; maker_sweep returns the cash", async () => {
    const { env, mk } = await quoted();
    const t0 = env.tokenBalance(env.treasury);
    await refresh(env, mk);
    expect(makerOrders(env, env.market(mk)).bids.length).to.eq(2);
    env.setTime(EXPIRY - 59); // tte 59 < min_tte 60
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: EXPIRY - 59 });
    await refresh(env, mk);
    const m = env.market(mk);
    expect(bookSide(m, SIDE_BID).length + bookSide(m, SIDE_ASK).length).to.eq(0);
    const seat = seatOf(m, env.maker)!;
    expect(seat.locked).to.eq(0n);
    expect(seat.cash > 0n).to.be.true;
    await env.exec([env.ixSweep(mk)], [env.admin]);
    expect(env.tokenBalance(env.treasury)).to.eq(t0);
    expect(seatOf(env.market(mk), env.maker)).to.be.undefined;
    expect(env.tokenBalance(mk.vault)).to.eq(0n);
  });

  it("re-quotes inventory as held-backed quotes; exposure counts cash at risk", async () => {
    const { env, mk } = await quoted();
    await refresh(env, mk);
    const u = await trader(env, mk);
    // user buys 30 YES from the maker → maker holds 30 NO (written asks)
    await env.exec([env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 99, qty: 30n })], [u]);
    const s0 = seatOf(env.market(mk), env.maker)!;
    expect(s0.no).to.eq(30n);
    await refresh(env, mk);
    const m = env.market(mk);
    const { bids, asks } = makerOrders(env, m);
    const heldNo = bids.filter((o) => o.fromHeld).reduce((s, o) => s + o.qty, 0n);
    expect(heldNo).to.eq(30n);
    expect(asks.every((o) => !o.fromHeld)).to.be.true;
    const s1 = seatOf(m, env.maker)!;
    expect([s1.no, s1.noLocked]).to.deep.eq([0n, 30n]);
    expect(s1.cash + s1.locked <= 200n * UNIT).to.be.true;
  });
});

describe("maker_sweep", () => {
  it("open market: returns only free seat cash, quotes stay", async () => {
    const { env, mk } = await quoted({ maker: makerParams({ levels: 4 }) });
    await refresh(env, mk);
    const locked4 = seatOf(env.market(mk), env.maker)!.locked;
    await env.exec([env.ixSetParams({ makerParams: makerParams({ levels: 1 }) })], [env.admin]);
    await refresh(env, mk);
    const s = seatOf(env.market(mk), env.maker)!;
    expect(s.cash > 0n && s.cash + s.locked === locked4).to.be.true;
    const t = env.tokenBalance(env.treasury);
    await env.exec([env.ixSweep(mk)], [env.admin]);
    expect(env.tokenBalance(env.treasury) - t).to.eq(s.cash);
    const s2 = seatOf(env.market(mk), env.maker)!;
    expect([s2.cash, s2.locked]).to.deep.eq([0n, s.locked]);
    expect(makerOrders(env, env.market(mk)).bids.length).to.eq(1);
  });

  it("paused or disabled: cancels the maker's quotes (risk-reducing)", async () => {
    const { env, mk } = await quoted();
    const t0 = env.tokenBalance(env.treasury);
    await refresh(env, mk);
    await env.exec([env.ixSetParams({ paused: true })], [env.admin]);
    await env.exec([env.ixSweep(mk)], [env.admin]);
    expect(bookSide(env.market(mk), SIDE_BID).length).to.eq(0);
    expect(env.tokenBalance(env.treasury)).to.eq(t0);
  });

  it("after resolution: redeems inventory into the treasury; no seat → no-op", async () => {
    const { env, mk } = await quoted();
    const t0 = env.tokenBalance(env.treasury);
    await refresh(env, mk);
    const u = await trader(env, mk);
    // user buys 10 YES (maker writes → maker holds 10 NO) and 10 NO (maker buys → 10 YES)
    await env.exec([env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 99, qty: 10n })], [u]);
    await env.exec([env.ixPlace(mk, u.publicKey, { side: SIDE_ASK, tick: 1, qty: 4n })], [u]);
    const s = seatOf(env.market(mk), env.maker)!;
    expect([s.yes, s.no]).to.deep.eq([4n, 10n]);
    env.setTime(EXPIRY + 3);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT - 1n, publishTime: EXPIRY + 2 }); // NO wins
    await env.exec([env.ixResolve(mk, SOL_PRICE_ACCOUNT)], [env.admin]);
    expect(env.market(mk).outcome).to.eq(0);
    await env.exec([env.ixSweep(mk)], [env.admin]);
    expect(seatOf(env.market(mk), env.maker)).to.be.undefined;
    expect(bookSide(env.market(mk), SIDE_BID).length + bookSide(env.market(mk), SIDE_ASK).length).to.eq(0);
    // user redeems: 10 YES lose, 4 NO win
    await env.exec([env.ixRedeem(mk, u.publicKey, 10n, 4n)], [u]);
    const m = env.market(mk);
    expect([m.pool, m.yesTotal, m.noTotal]).to.deep.eq([0n, 0n, 0n]);
    expect(env.tokenBalance(mk.vault)).to.eq(m.fees);
    // maker P&L = what the user paid minus what the user won (fees go to the protocol)
    const userPaid = 10n * 52n * TICK_UNIT + 4n * (100n - 48n) * TICK_UNIT;
    expect(env.tokenBalance(env.treasury) - t0).to.eq(userPaid - 4n * UNIT);
    await env.exec([env.ixSweep(mk)], [env.admin]); // no seat: no-op
  });
});
