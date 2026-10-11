import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  bootstrap,
  BTC_FEED,
  Env,
  makerParams,
  PYTH_RECEIVER,
  SOL_PRICE_ACCOUNT,
  solAssetArgs,
  SPOT,
  T0,
  UNIT,
} from "./lib/harness";

const initParams = (over: any = {}) => ({
  feeBps: 50,
  faucetAmount: new BN((1_000n * UNIT).toString()),
  faucetCooldown: new BN(3_600),
  makerParams: makerParams(),
  ...over,
});

describe("admin", () => {
  it("initialize stores the config, collateral mint and treasury; only once", async () => {
    const env = await bootstrap({ treasury: 0n });
    const c = env.fetchConfig();
    expect(c.admin.equals(env.admin.publicKey)).to.be.true;
    expect(c.collateralMint.equals(env.collateralMint)).to.be.true;
    expect(c.maker.equals(env.maker)).to.be.true;
    expect(c.treasury.equals(env.treasury)).to.be.true;
    expect(c.feeBps).to.eq(50);
    expect(c.paused).to.be.false;
    expect(c.marketCount.toNumber()).to.eq(0);
    expect(c.makerParams.levels).to.eq(2);
    // collateral mint: 6 decimals, mint authority = config PDA
    const mint = env.data(env.collateralMint)!;
    expect(mint[44]).to.eq(6);
    expect(new PublicKey(mint.subarray(4, 36)).equals(env.config)).to.be.true;
    // treasury: collateral token account owned by the maker PDA
    const t = env.data(env.treasury)!;
    expect(new PublicKey(t.subarray(0, 32)).equals(env.collateralMint)).to.be.true;
    expect(new PublicKey(t.subarray(32, 64)).equals(env.maker)).to.be.true;
    await env.fails(null, [env.ixInitialize(initParams())], [env.admin]);
  });

  it("initialize validates fee and maker params", async () => {
    const env = new Env();
    env.setTime(T0);
    await env.fails("FeeTooHigh", [env.ixInitialize(initParams({ feeBps: 101 }))], [env.admin]);
    await env.fails("BadArgs", [env.ixInitialize(initParams({ makerParams: makerParams({ levels: 0 }) }))], [env.admin]);
    await env.fails("BadArgs", [env.ixInitialize(initParams({ faucetCooldown: new BN(-1) }))], [env.admin]);
    await env.exec([env.ixInitialize(initParams({ feeBps: 100 }))], [env.admin]);
    expect(env.fetchConfig().feeBps).to.eq(100);
  });

  it("set_params: admin only, bounded, rotates admin", async () => {
    const env = await bootstrap({ treasury: 0n });
    const eve = env.newUser();
    await env.fails("BadAccount", [env.ixSetParams({ feeBps: 10 }, eve.publicKey)], [eve]);
    await env.fails("FeeTooHigh", [env.ixSetParams({ feeBps: 101 })], [env.admin]);
    for (const bad of [{ levels: 0 }, { levels: 5 }, { levelSpacing: 0 }, { minHalfSpread: 0 }, { levelNotional: new BN(0) }, { maxPriceAge: new BN(0) }, { minTte: new BN(-1) }]) {
      await env.fails("BadArgs", [env.ixSetParams({ makerParams: makerParams(bad) })], [env.admin]);
    }
    await env.fails("BadArgs", [env.ixSetParams({ faucetCooldown: new BN(-5) })], [env.admin]);
    await env.fails("BadArgs", [env.ixSetParams({ newAdmin: PublicKey.default })], [env.admin]);

    await env.exec([env.ixSetParams({ feeBps: 100, paused: true, makerParams: makerParams({ levels: 4 }) })], [env.admin]);
    let c = env.fetchConfig();
    expect([c.feeBps, c.paused, c.makerParams.levels]).to.deep.eq([100, true, 4]);
    // untouched fields keep their values
    expect(c.faucetCooldown.toNumber()).to.eq(3_600);

    const next = env.newUser();
    await env.exec([env.ixSetParams({ newAdmin: next.publicKey })], [env.admin]);
    await env.fails("BadAccount", [env.ixSetParams({ paused: false })], [env.admin]);
    await env.exec([env.ixSetParams({ paused: false }, next.publicKey)], [next]);
    c = env.fetchConfig();
    expect(c.admin.equals(next.publicKey)).to.be.true;
    expect(c.paused).to.be.false;
  });

  it("add_asset validates the Pyth account (owner, discriminator, Full, feed) and params", async () => {
    const env = new Env();
    env.setTime(T0);
    await env.exec([env.ixInitialize(initParams())], [env.admin]);
    const good = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
    env.setPyth(good, { price: SPOT, publishTime: T0 });

    const wrongOwner = Keypair.generate().publicKey;
    env.setPyth(wrongOwner, { price: SPOT, publishTime: T0 }, Keypair.generate().publicKey);
    await env.fails("BadPriceAccount", [env.ixAddAsset(solAssetArgs(), wrongOwner)], [env.admin]);

    const partial = Keypair.generate().publicKey;
    env.setPyth(partial, { price: SPOT, publishTime: T0, partial: true });
    await env.fails("PriceNotVerified", [env.ixAddAsset(solAssetArgs(), partial)], [env.admin]);

    const btc = Keypair.generate().publicKey;
    env.setPyth(btc, { price: SPOT, publishTime: T0, feedId: BTC_FEED });
    await env.fails("FeedMismatch", [env.ixAddAsset(solAssetArgs(), btc)], [env.admin]);

    const badDisc = Keypair.generate().publicKey;
    env.setPyth(badDisc, { price: SPOT, publishTime: T0 });
    const acc = env.svm.getAccount(badDisc)!;
    const d = Buffer.from(acc.data);
    d[0] ^= 0xff;
    env.svm.setAccount(badDisc, { ...acc, data: d, owner: PYTH_RECEIVER });
    await env.fails("BadPriceAccount", [env.ixAddAsset(solAssetArgs(), badDisc)], [env.admin]);

    // empty account owned by the system program
    await env.fails("BadPriceAccount", [env.ixAddAsset(solAssetArgs(), env.admin.publicKey)], [env.admin]);

    await env.fails("BadArgs", [env.ixAddAsset(solAssetArgs({ symbol: "sol" }), good)], [env.admin]);
    await env.fails("BadStrike", [env.ixAddAsset(solAssetArgs({ strikeStep: new BN(0) }), good)], [env.admin]);
    await env.fails("BadArgs", [env.ixAddAsset(solAssetArgs({ maxConfBps: 0 }), good)], [env.admin]);
    await env.fails("BadArgs", [env.ixAddAsset(solAssetArgs({ volBps: 0 }), good)], [env.admin]);
    await env.fails("BadArgs", [env.ixAddAsset(solAssetArgs({ settleWindow: new BN(-1) }), good)], [env.admin]);
    const eve = env.newUser();
    await env.fails("BadAccount", [env.ixAddAsset(solAssetArgs(), good, eve.publicKey)], [eve]);

    await env.exec([env.ixAddAsset(solAssetArgs(), good)], [env.admin]);
    const a = env.fetchAsset(env.assetPda("SOL"));
    expect(a.symbol).to.eq("SOL");
    expect(Buffer.from(a.feedId).toString("hex")).to.eq(Buffer.from(solAssetArgs().feedId).toString("hex"));
    expect(a.priceAccount.equals(good)).to.be.true;
    expect(a.strikeStep.toString()).to.eq("100000000");
    expect([a.volBps, a.maxConfBps, a.active, a.settleWindow.toNumber(), a.marketCount]).to.deep.eq([8500, 200, true, 60, 0]);
    // same symbol twice fails
    await env.fails(null, [env.ixAddAsset(solAssetArgs(), good)], [env.admin]);
  });

  it("set_asset: admin only, bounded", async () => {
    const env = await bootstrap({ treasury: 0n });
    const asset = env.assetPda("SOL");
    const eve = env.newUser();
    await env.fails("BadAccount", [env.ixSetAsset(asset, { active: false }, eve.publicKey)], [eve]);
    await env.fails("BadArgs", [env.ixSetAsset(asset, { volBps: 0 })], [env.admin]);
    await env.fails("BadArgs", [env.ixSetAsset(asset, { maxConfBps: 10_001 })], [env.admin]);
    await env.fails("BadArgs", [env.ixSetAsset(asset, { settleWindow: new BN(3_601) })], [env.admin]);
    await env.fails("BadStrike", [env.ixSetAsset(asset, { strikeStep: new BN(0) })], [env.admin]);
    await env.exec([env.ixSetAsset(asset, { volBps: 9000, active: false, settleWindow: new BN(30) })], [env.admin]);
    const a = env.fetchAsset(asset);
    expect([a.volBps, a.active, a.settleWindow.toNumber(), a.maxConfBps]).to.deep.eq([9000, false, 30, 200]);
  });

  it("mint_collateral is admin-only", async () => {
    const env = await bootstrap({ treasury: 0n });
    const eve = env.newUser();
    const dest = env.ata(env.collateralMint, eve.publicKey);
    env.send([createAssociatedTokenAccountIdempotentInstruction(eve.publicKey, dest, eve.publicKey, env.collateralMint)], [eve]);
    await env.fails("BadAccount", [env.ixMintCollateral(dest, 5n * UNIT, eve.publicKey)], [eve]);
    await env.fails("BadQty", [env.ixMintCollateral(dest, 0n)], [env.admin]);
    await env.exec([env.ixMintCollateral(dest, 5n * UNIT)], [env.admin]);
    expect(env.tokenBalance(dest)).to.eq(5n * UNIT);
    await env.exec([env.ixMintCollateral(env.treasury, 7n * UNIT)], [env.admin]);
    expect(env.tokenBalance(env.treasury)).to.eq(7n * UNIT);
  });
});

describe("faucet", () => {
  it("mints faucet_amount to the caller's ATA once per cooldown", async () => {
    const env = await bootstrap({ treasury: 0n });
    const u = env.newUser();
    const ata = env.ata(env.collateralMint, u.publicKey);
    await env.exec([env.ixFaucet(u.publicKey)], [u]); // creates claim + ATA
    expect(env.tokenBalance(ata)).to.eq(1_000n * UNIT);
    await env.fails("FaucetCooldown", [env.ixFaucet(u.publicKey)], [u]);
    env.setTime(T0 + 3_599);
    await env.fails("FaucetCooldown", [env.ixFaucet(u.publicKey)], [u]);
    env.setTime(T0 + 3_600);
    await env.exec([env.ixFaucet(u.publicKey)], [u]);
    expect(env.tokenBalance(ata)).to.eq(2_000n * UNIT);
    const claim = env.program.coder.accounts.decode(
      "faucetClaim",
      env.data(env.pda([Buffer.from("faucet"), u.publicKey.toBuffer()]))!
    );
    expect(claim.lastClaim.toNumber()).to.eq(T0 + 3_600);

    // other users are independent; works while paused (devnet test money, not market risk)
    await env.exec([env.ixSetParams({ paused: true })], [env.admin]);
    const v = env.newUser();
    await env.exec([env.ixFaucet(v.publicKey)], [v]);
    expect(env.tokenBalance(env.ata(env.collateralMint, v.publicKey))).to.eq(1_000n * UNIT);

    // amount 0 disables it
    await env.exec([env.ixSetParams({ faucetAmount: new BN(0) })], [env.admin]);
    const w = env.newUser();
    await env.fails("BadArgs", [env.ixFaucet(w.publicKey)], [w]);
  });
});
