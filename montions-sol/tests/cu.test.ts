// Compute-unit report. Each measured instruction runs alone in its transaction (plus a
// ComputeBudget limit ix, whose 150 CU are subtracted). Prints a table; asserts < 1.4M.
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  bootstrap,
  createMarket,
  Env,
  EXPIRY,
  makerParams,
  MarketKeys,
  SIDE_ASK,
  SIDE_BID,
  SOL_PRICE_ACCOUNT,
  SPOT,
  TIF_GTC,
  TIF_IOC,
  trader,
  E8,
  PlaceArgsTs,
} from "./lib/harness";

const CB_IX = 150;
const rows: { label: string; cu: number }[] = [];

async function measure(env: Env, label: string, ix: Promise<any>, signer: Keypair) {
  const meta = await env.exec([ix], [signer], { cuLimit: 1_400_000 });
  const cu = Number(meta.computeUnitsConsumed()) - CB_IX;
  rows.push({ label, cu });
  expect(cu).to.be.lessThan(1_400_000);
  return meta;
}

async function restAsks(env: Env, mk: MarketKeys, n: number, startTick = 40) {
  const a = await trader(env, mk);
  for (let i = 0; i < n; i++) {
    await env.exec([env.ixPlace(mk, a.publicKey, { side: SIDE_ASK, tick: startTick + (i % 50), qty: 1n, tif: TIF_GTC })], [a]);
  }
}

async function takerFills(n: number, label: string) {
  const env = await bootstrap();
  const mk = await createMarket(env);
  await restAsks(env, mk, n);
  const t = await trader(env, mk);
  const a: PlaceArgsTs = { side: SIDE_BID, tick: 99, qty: BigInt(n), tif: TIF_IOC, maxFills: n > 32 ? 64 : 0 };
  const meta = await measure(env, label, env.ixPlace(mk, t.publicKey, a), t);
  expect(env.placeResult(meta).filled).to.eq(BigInt(n));
}

describe("compute units", () => {
  it("create_market", async () => {
    const env = await bootstrap();
    const mk = env.marketKeys(env.assetPda("SOL"), SPOT, EXPIRY);
    env.markets.push(mk);
    await measure(env, "create_market", env.ixCreateMarket(mk, env.admin.publicKey), env.admin);
  });

  it("place_order 0 fills (IOC, empty book) / 0 fills resting GTC (new seat)", async () => {
    const env = await bootstrap();
    const mk = await createMarket(env);
    const t = await trader(env, mk);
    await measure(env, "place_order IOC, 0 fills", env.ixPlace(mk, t.publicKey, { side: SIDE_BID, tick: 50, qty: 5n }), t);
    await measure(env, "place_order GTC rest, 0 fills (seat alloc)", env.ixPlace(mk, t.publicKey, { side: SIDE_BID, tick: 50, qty: 5n, tif: TIF_GTC }), t);
    await measure(env, "place_order GTC rest, 0 fills (2nd order)", env.ixPlace(mk, t.publicKey, { side: SIDE_BID, tick: 49, qty: 5n, tif: TIF_GTC }), t);
    await measure(env, "cancel_order (+ seat payout)", env.ixCancel(mk, t.publicKey, 1n), t);
  });

  it("place_order with 1 / 6 / 16 / 32 / 64 fills", async () => {
    await takerFills(1, "place_order IOC, 1 fill");
    await takerFills(6, "place_order IOC, 6 fills");
    await takerFills(16, "place_order IOC, 16 fills");
    await takerFills(32, "place_order IOC, 32 fills (max_fills default)");
    await takerFills(64, "place_order IOC, 64 fills (max_fills 64)");
  });

  it("refresh_quotes (2 and 4 levels; first quote and re-quote) / maker_sweep", async () => {
    for (const levels of [2, 4]) {
      const env = await bootstrap({ maker: makerParams({ levels, maxMarketExposure: new (require("@coral-xyz/anchor").BN)("1000000000") }) });
      const mk = await createMarket(env);
      await measure(env, `refresh_quotes ${levels} lvls, first (seat alloc + ${2 * levels} posts)`, env.ixRefresh(mk, SOL_PRICE_ACCOUNT), env.admin);
      await measure(env, `refresh_quotes ${levels} lvls, re-quote (${2 * levels} cancels + posts)`, env.ixRefresh(mk, SOL_PRICE_ACCOUNT), env.admin);
      if (levels === 4) {
        // a busy book: 40 other resting orders
        await restAsks(env, mk, 40, 60);
        await measure(env, "refresh_quotes 4 lvls, re-quote, 48 resting orders", env.ixRefresh(mk, SOL_PRICE_ACCOUNT), env.admin);
        env.setTime(EXPIRY - 30);
        await measure(env, "maker_sweep near expiry (cancel 8)", env.ixSweep(mk), env.admin);
      }
    }
  });

  it("split / merge / resolve / redeem / void", async () => {
    const env = await bootstrap();
    const mk = await createMarket(env);
    const u = await trader(env, mk);
    await measure(env, "split", env.ixSplit(mk, u.publicKey, 10n), u);
    await measure(env, "merge", env.ixMerge(mk, u.publicKey, 2n), u);
    env.setTime(EXPIRY + 5);
    env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT + E8, publishTime: EXPIRY + 1 });
    await measure(env, "resolve", env.ixResolve(mk, SOL_PRICE_ACCOUNT), env.admin);
    await measure(env, "redeem", env.ixRedeem(mk, u.publicKey, 8n, 8n), u);
    const mk2 = await (async () => {
      env.setTime(EXPIRY - 3_600);
      return createMarket(env, 151n * E8);
    })();
    env.setTime(EXPIRY + 86_400);
    await measure(env, "void_market", env.ixVoid(mk2), env.admin);
  });

  after(() => {
    const w = Math.max(...rows.map((r) => r.label.length));
    console.log("\n  CU report (default per-instruction limit 200,000; tx max 1,400,000)");
    for (const r of rows) {
      const flag = r.cu > 200_000 ? "  ← needs ComputeBudget" : "";
      console.log(`  ${r.label.padEnd(w)}  ${r.cu.toLocaleString("en-US").padStart(9)}${flag}`);
    }
  });
});
