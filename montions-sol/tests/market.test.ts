import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  balances,
  bootstrap,
  createMarket,
  E8,
  EXPIRY,
  NIL,
  SOL_FEED,
  SOL_PRICE_ACCOUNT,
  SPOT,
  STATUS_OPEN,
  STATUS_RESOLVED,
  T0,
  trader,
  UNIT,
} from "./lib/harness";

describe("create_market", () => {
  it("writes the header, inits the book, creates mints + vault, bumps counters", async () => {
    const env = await bootstrap({ treasury: 0n });
    const creator = env.newUser();
    const mk = await createMarket(env, SPOT, EXPIRY, creator);
    const m = env.market(mk);
    expect(m.asset.equals(env.assetPda("SOL"))).to.be.true;
    expect(m.feedId.equals(SOL_FEED)).to.be.true;
    expect(m.creator.equals(creator.publicKey)).to.be.true;
    expect(m.yesMint.equals(mk.yesMint) && m.noMint.equals(mk.noMint) && m.vault.equals(mk.vault)).to.be.true;
    expect(m.strike).to.eq(SPOT);
    expect(m.expiry).to.eq(BigInt(EXPIRY));
    expect(m.createdAt).to.eq(BigInt(T0));
    expect(m.status).to.eq(STATUS_OPEN);
    expect(m.nextOrderId).to.eq(1n);
    expect(m.pool + m.yesTotal + m.noTotal + m.fees + m.volume).to.eq(0n);
    expect(m.bidLevels.every((l) => l.head === NIL && l.tail === NIL)).to.be.true;
    expect(m.askLevels.every((l) => l.head === NIL && l.tail === NIL)).to.be.true;
    expect(m.freeHead).to.not.eq(NIL);
    expect(m.orders.every((o) => o.id === 0n)).to.be.true;
    // bumps match the PDAs
    const s = Buffer.alloc(8);
    s.writeBigUInt64LE(SPOT);
    const e = Buffer.alloc(8);
    e.writeBigInt64LE(BigInt(EXPIRY));
    const [, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), mk.asset.toBuffer(), s, e],
      env.program.programId
    );
    expect(m.bump).to.eq(bump);
    // outcome mints: decimals 0, authority = market
    for (const mint of [mk.yesMint, mk.noMint]) {
      const d = env.data(mint)!;
      expect(d[44]).to.eq(0);
      expect(new PublicKey(d.subarray(4, 36)).equals(mk.market)).to.be.true;
    }
    const v = env.data(mk.vault)!;
    expect(new PublicKey(v.subarray(0, 32)).equals(env.collateralMint)).to.be.true;
    expect(new PublicKey(v.subarray(32, 64)).equals(mk.market)).to.be.true;
    expect(env.fetchConfig().marketCount.toNumber()).to.eq(1);
    expect(env.fetchAsset(mk.asset).marketCount).to.eq(1);
    // same (asset, strike, expiry) again fails
    await env.fails(null, [env.ixCreateMarket(mk, creator.publicKey)], [creator]);
  });

  it("validates strike grid, expiry grid and duration window", async () => {
    const env = await bootstrap({ treasury: 0n });
    const asset = env.assetPda("SOL");
    const p = env.admin;
    const bad = async (code: string, strike: bigint, expiry: number) =>
      env.fails(code, [env.ixCreateMarket(env.marketKeys(asset, strike, expiry), p.publicKey)], [p]);
    await bad("BadStrike", 0n, EXPIRY);
    await bad("BadStrike", SPOT + E8 / 2n, EXPIRY); // $150.50 on a $1 grid
    await bad("BadExpiry", SPOT, EXPIRY + 60); // off the 5-minute grid
    await bad("BadExpiry", SPOT, T0 - 300); // in the past
    await bad("BadExpiry", SPOT, T0 + 90 * 86_400 + 300); // beyond MAX_DURATION
    // MIN_DURATION boundary: expiry - now == 120 ok, 119 not
    env.setTime(EXPIRY - 119);
    await bad("BadExpiry", SPOT, EXPIRY);
    env.setTime(EXPIRY - 120);
    const mk = await createMarket(env, SPOT, EXPIRY);
    expect(env.market(mk).status).to.eq(STATUS_OPEN);
    // exactly MAX_DURATION ok
    env.setTime(T0);
    const far = T0 + 90 * 86_400 - ((T0 + 90 * 86_400) % 300);
    await createMarket(env, 200n * E8, far);
  });

  it("is blocked while paused and for inactive assets", async () => {
    const env = await bootstrap({ treasury: 0n });
    const mk = env.marketKeys(env.assetPda("SOL"), SPOT, EXPIRY);
    await env.exec([env.ixSetParams({ paused: true })], [env.admin]);
    await env.fails("Paused", [env.ixCreateMarket(mk, env.admin.publicKey)], [env.admin]);
    await env.exec([env.ixSetParams({ paused: false }), env.ixSetAsset(mk.asset, { active: false })], [env.admin]);
    await env.fails("AssetInactive", [env.ixCreateMarket(mk, env.admin.publicKey)], [env.admin]);
    await env.exec([env.ixSetAsset(mk.asset, { active: true })], [env.admin]);
    await createMarket(env);
  });
});

describe("split / merge", () => {
  it("split mints pairs for collateral, merge burns them back", async () => {
    const env = await bootstrap({ treasury: 0n });
    const mk = await createMarket(env);
    const u = await trader(env, mk);
    const b0 = balances(env, mk, u.publicKey);
    await env.exec([env.ixSplit(mk, u.publicKey, 5n)], [u]);
    let b = balances(env, mk, u.publicKey);
    expect([b.cash, b.yes, b.no]).to.deep.eq([b0.cash - 5n * UNIT, 5n, 5n]);
    let m = env.market(mk);
    expect([m.pool, m.yesTotal, m.noTotal]).to.deep.eq([5n * UNIT, 5n, 5n]);

    await env.exec([env.ixMerge(mk, u.publicKey, 3n)], [u]);
    b = balances(env, mk, u.publicKey);
    expect([b.cash, b.yes, b.no]).to.deep.eq([b0.cash - 2n * UNIT, 2n, 2n]);

    await env.fails("BadQty", [env.ixSplit(mk, u.publicKey, 0n)], [u]);
    await env.fails("BadQty", [env.ixMerge(mk, u.publicKey, 0n)], [u]);
    await env.fails("InsufficientTokens", [env.ixMerge(mk, u.publicKey, 3n)], [u]);
    await env.fails("InsufficientCash", [env.ixSplit(mk, u.publicKey, 1_000_000n)], [u]);

    // after expiry: no split, merge still works while Open
    env.setTime(EXPIRY);
    await env.fails("Expired", [env.ixSplit(mk, u.publicKey, 1n)], [u]);
    await env.exec([env.ixMerge(mk, u.publicKey, 1n)], [u]);
    // after resolution: merge is closed (redeem instead)
    env.setTime(EXPIRY + 5);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: EXPIRY + 1 });
    await env.exec([env.ixResolve(mk, SOL_PRICE_ACCOUNT)], [u]);
    expect(env.market(mk).status).to.eq(STATUS_RESOLVED);
    await env.fails("MarketNotOpen", [env.ixMerge(mk, u.publicKey, 1n)], [u]);
  });

  it("paused: split blocked, merge allowed", async () => {
    const env = await bootstrap({ treasury: 0n });
    const mk = await createMarket(env);
    const u = await trader(env, mk);
    await env.exec([env.ixSplit(mk, u.publicKey, 4n)], [u]);
    await env.exec([env.ixSetParams({ paused: true })], [env.admin]);
    await env.fails("Paused", [env.ixSplit(mk, u.publicKey, 1n)], [u]);
    await env.exec([env.ixMerge(mk, u.publicKey, 4n)], [u]);
    expect(balances(env, mk, u.publicKey).yes).to.eq(0n);
  });
});
