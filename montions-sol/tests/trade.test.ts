import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  balances,
  bookSide,
  bootstrap,
  createMarket,
  Env,
  EXPIRY,
  feeOf,
  MarketKeys,
  MarketState,
  PlaceArgsTs,
  refresh,
  seatOf,
  SIDE_ASK,
  SIDE_BID,
  TICK_UNIT,
  TIF_GTC,
  TIF_IOC,
  TIF_POST_ONLY,
  trader,
  UNIT,
} from "./lib/harness";

const FEE = 50;

/// Expected taker outcome from the current book (price-time priority, fills at the resting tick).
function expectTaker(m: MarketState, a: PlaceArgsTs, feeBps = FEE) {
  const opp = bookSide(m, a.side === SIDE_BID ? SIDE_ASK : SIDE_BID);
  let left = a.qty;
  let base = 0n;
  const fills: { tick: number; f: bigint; makerHeld: boolean; seat: number }[] = [];
  for (const o of opp) {
    if (left === 0n) break;
    if (a.side === SIDE_BID ? o.tick > a.tick : o.tick < a.tick) break;
    const f = left < o.qty ? left : o.qty;
    fills.push({ tick: o.tick, f, makerHeld: o.fromHeld, seat: o.seat });
    // per contract: buy YES pays p, write YES pays 100-p, sell YES earns p, close NO earns 100-p
    const yesLeg = (a.side === SIDE_BID) !== !!a.fromHeld;
    base += f * BigInt(yesLeg ? o.tick : 100 - o.tick) * TICK_UNIT;
    left -= f;
  }
  const filled = a.qty - left;
  const fee = feeOf(base, feeBps);
  const held = !!a.fromHeld;
  return {
    filled,
    base,
    fee,
    fills,
    dCash: held ? base - fee : -(base + fee),
    dYes: a.side === SIDE_BID ? (held ? 0n : filled) : held ? -filled : 0n,
    dNo: a.side === SIDE_ASK ? (held ? 0n : filled) : held ? -filled : 0n,
  };
}

async function place(env: Env, mk: MarketKeys, u: Keypair, a: PlaceArgsTs, label?: string) {
  const meta = await env.exec([env.ixPlace(mk, u.publicKey, a)], [u], { label });
  return env.placeResult(meta);
}

/// Place a taker order and assert exact wallet deltas + return data against `expectTaker`.
async function takeAndCheck(env: Env, mk: MarketKeys, u: Keypair, a: PlaceArgsTs) {
  const m0 = env.market(mk);
  const exp = expectTaker(m0, a);
  const b0 = balances(env, mk, u.publicKey);
  const r = await place(env, mk, u, a);
  const b1 = balances(env, mk, u.publicKey);
  expect(r.filled, "filled").to.eq(exp.filled);
  expect(r.fee, "fee").to.eq(exp.fee);
  expect(b1.cash - b0.cash, "cash delta").to.eq(exp.dCash);
  expect(b1.yes - b0.yes, "yes delta").to.eq(exp.dYes);
  expect(b1.no - b0.no, "no delta").to.eq(exp.dNo);
  const m1 = env.market(mk);
  expect(m1.fees - m0.fees).to.eq(exp.fee);
  expect(m1.volume - m0.volume).to.eq(exp.filled);
  if (exp.filled > 0n) expect(m1.lastTradeTick).to.eq(exp.fills[exp.fills.length - 1].tick);
  return { r, exp, m0, m1 };
}

async function setup(withMaker = false) {
  const env = await bootstrap({ feeBps: FEE });
  const mk = await createMarket(env);
  if (withMaker) await refresh(env, mk);
  return { env, mk };
}

describe("place_order: the eight fill cases (exact deltas on both sides)", () => {
  // [taker side, taker held, maker side, maker held, maker tick, description]
  const cases: [number, boolean, boolean, number, string][] = [
    [SIDE_BID, false, false, 60, "buy YES  vs write-YES ask   → mint pairs"],
    [SIDE_BID, false, true, 70, "buy YES  vs sell-YES ask    → YES moves"],
    [SIDE_BID, true, false, 60, "close NO vs write-YES ask   → NO moves"],
    [SIDE_BID, true, true, 70, "close NO vs sell-YES ask    → burn pairs"],
    [SIDE_ASK, false, false, 40, "write YES vs buy-YES bid    → mint pairs"],
    [SIDE_ASK, false, true, 45, "write YES vs close-NO bid   → NO moves"],
    [SIDE_ASK, true, false, 40, "sell YES vs buy-YES bid     → YES moves"],
    [SIDE_ASK, true, true, 45, "sell YES vs close-NO bid    → burn pairs"],
  ];
  for (const [tSide, tHeld, mHeld, tick, desc] of cases) {
    it(desc, async () => {
      const { env, mk } = await setup();
      const maker = await trader(env, mk);
      const taker = await trader(env, mk);
      // inventory for held legs
      await env.exec([env.ixSplit(mk, maker.publicKey, 10n)], [maker]);
      await env.exec([env.ixSplit(mk, taker.publicKey, 10n)], [taker]);
      const mSide = tSide === SIDE_BID ? SIDE_ASK : SIDE_BID;
      const rest = await place(env, mk, maker, { side: mSide, tick, qty: 6n, tif: TIF_GTC, fromHeld: mHeld });
      expect(rest.resting).to.eq(6n);
      expect(rest.filled).to.eq(0n);
      const seat0 = seatOf(env.market(mk), maker.publicKey)!;
      const escrowPer = BigInt(mSide === SIDE_BID ? tick : 100 - tick) * TICK_UNIT;
      if (mHeld) {
        expect(mSide === SIDE_ASK ? seat0.yesLocked : seat0.noLocked).to.eq(6n);
      } else {
        expect(seat0.locked).to.eq(6n * escrowPer);
      }
      const { m0, m1 } = await takeAndCheck(env, mk, taker, {
        side: tSide,
        tick: tSide === SIDE_BID ? 99 : 1,
        qty: 4n,
        tif: TIF_IOC,
        fromHeld: tHeld,
      });
      // maker side: 4 of 6 filled at `tick`
      const seat1 = seatOf(m1, maker.publicKey)!;
      const yesPx = 4n * BigInt(tick) * TICK_UNIT;
      const noPx = 4n * BigInt(100 - tick) * TICK_UNIT;
      if (mSide === SIDE_ASK) {
        if (mHeld) {
          expect(seat1.yesLocked).to.eq(2n);
          expect(seat1.cash - seat0.cash).to.eq(yesPx);
        } else {
          expect(seat0.locked - seat1.locked).to.eq(noPx);
          expect(seat1.no - seat0.no).to.eq(4n);
        }
      } else {
        if (mHeld) {
          expect(seat1.noLocked).to.eq(2n);
          expect(seat1.cash - seat0.cash).to.eq(noPx);
        } else {
          expect(seat0.locked - seat1.locked).to.eq(yesPx);
          expect(seat1.yes - seat0.yes).to.eq(4n);
        }
      }
      const dPairs = m1.yesTotal - m0.yesTotal;
      expect(dPairs).to.eq(!tHeld && !mHeld ? 4n : tHeld && mHeld ? -4n : 0n);
      expect(m1.trades[(m1.tradeHead + 15) % 16]).to.deep.include({ qty: 4, tick, takerIsBuyer: tSide === SIDE_BID });
    });
  }
});

describe("place_order against the protocol maker", () => {
  it("buy YES (bid IOC) lifts maker asks across levels; buy NO (ask IOC) hits maker bids", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    const asks = bookSide(env.market(mk), SIDE_ASK);
    const bids = bookSide(env.market(mk), SIDE_BID);
    expect(asks.length).to.be.greaterThan(1);
    expect(bids.length).to.be.greaterThan(1);
    const makerSeat0 = seatOf(env.market(mk), env.maker)!;

    // spans the best ask level and 3 contracts of the next
    const q = asks[0].qty + 3n;
    const { r, exp } = await takeAndCheck(env, mk, u, { side: SIDE_BID, tick: 99, qty: q });
    expect(exp.fills.length).to.eq(2);
    expect(r.yesOut).to.eq(q);
    expect(r.resting).to.eq(0n);
    const principal = q * 99n * TICK_UNIT;
    expect(r.cashOut).to.eq(principal + feeOf(principal, FEE) - exp.base - exp.fee);
    // maker wrote YES: received NO in its seat
    expect(seatOf(env.market(mk), env.maker)!.no - makerSeat0.no).to.eq(q);

    // buy NO = write YES at limit 1
    const q2 = bids[0].qty + 2n;
    const res2 = await takeAndCheck(env, mk, u, { side: SIDE_ASK, tick: 1, qty: q2 });
    expect(res2.exp.fills.length).to.eq(2);
    expect(res2.r.noOut).to.eq(q2);
  });

  it("limit respected: bid below the best ask fills nothing (IOC refund) ", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    const bestAsk = bookSide(env.market(mk), SIDE_ASK)[0].tick;
    const { r } = await takeAndCheck(env, mk, u, { side: SIDE_BID, tick: bestAsk - 1, qty: 5n });
    expect(r.filled).to.eq(0n);
  });

  it("sell YES and close NO (from_held) into the maker's quotes", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    await env.exec([env.ixSplit(mk, u.publicKey, 30n)], [u]);
    // sell 5 YES into maker bids
    const s = await takeAndCheck(env, mk, u, { side: SIDE_ASK, tick: 1, qty: 5n, fromHeld: true });
    expect(s.r.filled).to.eq(5n);
    expect(s.r.yesOut).to.eq(0n);
    // close 7 NO into maker asks
    const c = await takeAndCheck(env, mk, u, { side: SIDE_BID, tick: 99, qty: 7n, fromHeld: true });
    expect(c.r.filled).to.eq(7n);
    // unfillable held order is refunded (IOC): limit far above every bid
    const n = await takeAndCheck(env, mk, u, { side: SIDE_ASK, tick: 99, qty: 4n, fromHeld: true });
    expect(n.r.filled).to.eq(0n);
    expect(n.r.yesOut).to.eq(4n);
  });

  it("re-quoting after inventory: maker posts held-backed quotes, sells into them burn pairs", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    // user buys YES from the maker → maker accumulates NO inventory
    await takeAndCheck(env, mk, u, { side: SIDE_BID, tick: 99, qty: 10n });
    await refresh(env, mk);
    const m = env.market(mk);
    const heldBids = bookSide(m, SIDE_BID).filter((o) => o.fromHeld);
    expect(heldBids.length, "maker should quote its NO inventory as close-NO bids").to.be.greaterThan(0);
    // user sells YES back into a held bid: pairs burn
    const before = env.market(mk);
    const q = heldBids[0].qty < 3n ? heldBids[0].qty : 3n;
    if (bookSide(before, SIDE_BID)[0].fromHeld) {
      await takeAndCheck(env, mk, u, { side: SIDE_ASK, tick: heldBids[0].tick, qty: q, fromHeld: true });
      expect(env.market(mk).yesTotal).to.eq(before.yesTotal - q);
    }
  });
});

describe("resting orders, cancel, withdraw_seat", () => {
  it("GTC rests, partial fill accrues in the seat, cancel pays everything out", async () => {
    const { env, mk } = await setup();
    const a = await trader(env, mk);
    const b = await trader(env, mk);
    const a0 = balances(env, mk, a.publicKey);
    const r = await place(env, mk, a, { side: SIDE_BID, tick: 49, qty: 10n, tif: TIF_GTC });
    expect([r.filled, r.resting, r.fee]).to.deep.eq([0n, 10n, 0n]);
    expect(r.orderId).to.eq(1n);
    // resting maker pays no fee: only the principal is locked, reserve refunded
    expect(balances(env, mk, a.publicKey).cash).to.eq(a0.cash - 10n * 49n * TICK_UNIT);
    let seat = seatOf(env.market(mk), a.publicKey)!;
    expect([seat.locked, seat.openOrders]).to.deep.eq([10n * 49n * TICK_UNIT, 1]);

    // b writes 4 YES into it (buy NO at 51)
    await takeAndCheck(env, mk, b, { side: SIDE_ASK, tick: 49, qty: 4n });
    seat = seatOf(env.market(mk), a.publicKey)!;
    expect([seat.yes, seat.locked]).to.deep.eq([4n, 6n * 49n * TICK_UNIT]);
    expect(bookSide(env.market(mk), SIDE_BID)[0].qty).to.eq(6n);

    // only the owner can cancel; unknown ids fail
    await env.fails("NotOrderOwner", [env.ixCancel(mk, b.publicKey, 1n)], [b]);
    await env.fails("OrderNotOpen", [env.ixCancel(mk, a.publicKey, 99n)], [a]);
    await env.exec([env.ixCancel(mk, a.publicKey, 1n)], [a]);
    const a1 = balances(env, mk, a.publicKey);
    expect(a1.cash).to.eq(a0.cash - 4n * 49n * TICK_UNIT);
    expect(a1.yes).to.eq(4n);
    expect(seatOf(env.market(mk), a.publicKey)).to.be.undefined; // seat freed
    expect(bookSide(env.market(mk), SIDE_BID).length).to.eq(0);
    await env.fails("OrderNotOpen", [env.ixCancel(mk, a.publicKey, 1n)], [a]);
  });

  it("withdraw_seat mints a fully filled order's proceeds; no-op without a seat", async () => {
    const { env, mk } = await setup();
    const a = await trader(env, mk);
    const b = await trader(env, mk);
    await place(env, mk, a, { side: SIDE_ASK, tick: 55, qty: 3n, tif: TIF_GTC }); // write YES at 55
    await takeAndCheck(env, mk, b, { side: SIDE_BID, tick: 55, qty: 3n });
    const seat = seatOf(env.market(mk), a.publicKey)!;
    expect([seat.no, seat.locked, seat.openOrders]).to.deep.eq([3n, 0n, 0]);
    const a0 = balances(env, mk, a.publicKey);
    await env.exec([env.ixWithdrawSeat(mk, a.publicKey)], [a]);
    expect(balances(env, mk, a.publicKey).no - a0.no).to.eq(3n);
    expect(seatOf(env.market(mk), a.publicKey)).to.be.undefined;
    await env.exec([env.ixWithdrawSeat(mk, a.publicKey)], [a]); // nothing left: no-op
  });

  it("self-trade prevention cancels the taker's own resting order and continues", async () => {
    const { env, mk } = await setup(true);
    const a = await trader(env, mk);
    const makerAsk = bookSide(env.market(mk), SIDE_ASK)[0];
    // a rests an ask one tick inside the maker's best ask
    const own = await place(env, mk, a, { side: SIDE_ASK, tick: makerAsk.tick - 1, qty: 5n, tif: TIF_GTC });
    expect(own.resting).to.eq(5n);
    const before = balances(env, mk, a.publicKey);
    const r = await place(env, mk, a, { side: SIDE_BID, tick: makerAsk.tick, qty: 3n });
    // own order cancelled (escrow back to the seat), 3 filled against the maker at its tick
    expect(r.filled).to.eq(3n);
    const m = env.market(mk);
    expect(bookSide(m, SIDE_ASK).some((o) => o.seat === m.seats.findIndex((s) => s.owner.equals(a.publicKey)))).to.be.false;
    const base = 3n * BigInt(makerAsk.tick) * TICK_UNIT;
    expect(balances(env, mk, a.publicKey).cash - before.cash).to.eq(-(base + feeOf(base, FEE)));
    const seat = seatOf(m, a.publicKey)!;
    expect([seat.cash, seat.locked, seat.openOrders]).to.deep.eq([5n * BigInt(100 - makerAsk.tick + 1) * TICK_UNIT, 0n, 0]);
    await env.exec([env.ixWithdrawSeat(mk, a.publicKey)], [a]);
    expect(seatOf(env.market(mk), a.publicKey)).to.be.undefined;
  });

  it("min_filled reverts the whole order; POST_ONLY never crosses", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    const asks = bookSide(env.market(mk), SIDE_ASK);
    const depth = asks.reduce((s, o) => s + o.qty, 0n);
    const b0 = balances(env, mk, u.publicKey);
    await env.fails("MinFillNotMet", [env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 99, qty: depth + 1n, minFilled: depth + 1n })], [u]);
    expect(balances(env, mk, u.publicKey)).to.deep.eq(b0);
    const r = await place(env, mk, u, { side: SIDE_BID, tick: 99, qty: 2n, minFilled: 2n });
    expect(r.filled).to.eq(2n);
    await env.fails("WouldCross", [env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: asks[0].tick, qty: 1n, tif: TIF_POST_ONLY })], [u]);
    const p = await place(env, mk, u, { side: SIDE_BID, tick: 2, qty: 1n, tif: TIF_POST_ONLY });
    expect(p.resting).to.eq(1n);
  });

  it("max_fills bounds the walk; GTC remainder does not rest when the bound is hit while crossing", async () => {
    const { env, mk } = await setup();
    const a = await trader(env, mk);
    const b = await trader(env, mk);
    for (const t of [50, 51, 52]) await place(env, mk, a, { side: SIDE_ASK, tick: t, qty: 1n, tif: TIF_GTC });
    const r = await place(env, mk, b, { side: SIDE_BID, tick: 60, qty: 5n, tif: TIF_GTC, maxFills: 2 });
    expect([r.filled, r.resting, r.orderId]).to.deep.eq([2n, 0n, 0n]);
    expect(bookSide(env.market(mk), SIDE_BID).length).to.eq(0);
    expect(bookSide(env.market(mk), SIDE_ASK).map((o) => o.tick)).to.deep.eq([52]);
  });

  it("argument validation and balance checks", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    const bad = (code: string, a: PlaceArgsTs) => env.fails(code, [env.ixPlace(mk, u.publicKey, a)], [u]);
    await bad("BadTick", { side: SIDE_BID, tick: 0, qty: 1n });
    await bad("BadTick", { side: SIDE_BID, tick: 100, qty: 1n });
    await bad("BadQty", { side: SIDE_BID, tick: 50, qty: 0n });
    await bad("BadQty", { side: SIDE_BID, tick: 50, qty: 1_000_000_001n });
    await bad("BadArgs", { side: 2, tick: 50, qty: 1n });
    await bad("BadArgs", { side: SIDE_BID, tick: 50, qty: 1n, tif: 3 });
    await bad("InsufficientCash", { side: SIDE_BID, tick: 99, qty: 100_000n });
    await bad("InsufficientTokens", { side: SIDE_ASK, tick: 50, qty: 1n, fromHeld: true });
    await bad("InsufficientTokens", { side: SIDE_BID, tick: 50, qty: 1n, fromHeld: true });
    // someone else's token accounts cannot be used (Anchor token::authority constraint)
    const v = await trader(env, mk);
    const accts = env.userMarketAccounts(mk, u.publicKey);
    const ix = await env.program.methods
      .placeOrder({ side: SIDE_BID, tick: 50, qty: new (require("@coral-xyz/anchor").BN)(1), tif: TIF_IOC, fromHeld: false, maxFills: 0, minFilled: new (require("@coral-xyz/anchor").BN)(0) })
      .accountsStrict({ ...accts, userCollateral: env.ata(env.collateralMint, v.publicKey) })
      .instruction();
    await env.fails(null, [ix], [u]);
  });

  it("paused: only from_held orders; cancels and withdrawals still work", async () => {
    const { env, mk } = await setup(true);
    const u = await trader(env, mk);
    await env.exec([env.ixSplit(mk, u.publicKey, 10n)], [u]);
    const g = await place(env, mk, u, { side: SIDE_BID, tick: 5, qty: 2n, tif: TIF_GTC });
    await env.exec([env.ixSetParams({ paused: true })], [env.admin]);
    await env.fails("Paused", [env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 99, qty: 1n })], [u]);
    await env.fails("Paused", [env.ixPlace(mk, u.publicKey, { side: SIDE_ASK, tick: 1, qty: 1n })], [u]);
    await takeAndCheck(env, mk, u, { side: SIDE_ASK, tick: 1, qty: 2n, fromHeld: true });
    await takeAndCheck(env, mk, u, { side: SIDE_BID, tick: 99, qty: 2n, fromHeld: true });
    await env.exec([env.ixCancel(mk, u.publicKey, g.orderId)], [u]);
    await env.exec([env.ixWithdrawSeat(mk, u.publicKey)], [u]);
  });

  it("trading stops at expiry; cancel still works", async () => {
    const { env, mk } = await setup();
    const u = await trader(env, mk);
    const g = await place(env, mk, u, { side: SIDE_BID, tick: 30, qty: 2n, tif: TIF_GTC });
    env.setTime(EXPIRY);
    await env.fails("Expired", [env.ixPlace(mk, u.publicKey, { side: SIDE_BID, tick: 30, qty: 1n })], [u]);
    const b0 = balances(env, mk, u.publicKey);
    await env.exec([env.ixCancel(mk, u.publicKey, g.orderId)], [u]);
    expect(balances(env, mk, u.publicKey).cash - b0.cash).to.eq(2n * 30n * TICK_UNIT);
  });

  it("market account substitution is rejected (vault / mint constraints)", async () => {
    const env = await bootstrap({ feeBps: FEE });
    const mk1 = await createMarket(env);
    const mk2 = await createMarket(env, 151n * 100_000_000n);
    const u = await trader(env, mk1);
    env.send(env.ixAtas(mk2, u.publicKey), [u]);
    await env.exec([env.ixSplit(mk2, u.publicKey, 3n)], [u]);
    // market 1 with market 2's vault
    const accts = { ...env.userMarketAccounts(mk1, u.publicKey), vault: mk2.vault };
    const BN = require("@coral-xyz/anchor").BN;
    const ix = await env.program.methods.merge(new BN(1)).accountsStrict(accts).instruction();
    await env.fails("BadAccount", [ix], [u]);
    // market 1 with market 2's mints
    const accts2 = { ...env.userMarketAccounts(mk2, u.publicKey), market: mk1.market, vault: mk1.vault };
    const ix2 = await env.program.methods.merge(new BN(1)).accountsStrict(accts2).instruction();
    await env.fails("BadAccount", [ix2], [u]);
  });
});
