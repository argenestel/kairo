import { describe, it, expect, vi } from "vitest";
import {
  Connection,
  Keypair,
  PublicKey,
  MontionsClient,
  UNIT,
  PYTH_RECEIVER_ID,
  decodePythPrice,
  ladderExpiries,
  ceilGrid,
  type ConfigView,
  type AssetView,
} from "../src/index.js";
import capture from "./fixtures/pyth_devnet.json";
const address = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const raw = Buffer.from(
  capture.accounts["7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"].data,
  "base64"
);
const price = decodePythPrice(raw);
const now = price.publishTime;
const owner = Keypair.generate().publicKey;
function setup(amount = 1000n * UNIT) {
  const connection = new Connection("http://127.0.0.1:1");
  const client = new MontionsClient({ connection });
  const config: ConfigView = {
    admin: owner,
    collateralMint: client.collateralMint,
    maker: client.maker,
    treasury: client.treasury,
    feeBps: 0,
    paused: false,
    bump: 0,
    collateralBump: 0,
    makerBump: 0,
    treasuryBump: 0,
    faucetAmount: 1000n * UNIT,
    faucetCooldown: 600,
    marketCount: 0n,
    makerParams: {
      enabled: true,
      levels: 3,
      levelSpacing: 2,
      minHalfSpread: 2,
      levelNotional: 50n * UNIT,
      maxMarketExposure: 1500n * UNIT,
      minTte: 600,
      maxPriceAge: 60,
    },
  };
  const asset: AssetView = {
    address: client.assetAddress("SOL"),
    symbol: "SOL",
    feedId: price.feedId,
    priceAccount: address,
    strikeStep: 100_000_000n,
    volBps: 8500,
    maxConfBps: 200,
    active: true,
    bump: 0,
    settleWindow: 60,
    marketCount: 0,
  };
  const token = Buffer.alloc(165);
  token.writeBigUInt64LE(amount, 64);
  vi.spyOn(connection, "getAccountInfo").mockResolvedValue({
    data: token,
    owner: PublicKey.default,
    lamports: 1,
    executable: false,
    rentEpoch: 0,
  });
  const params = {
    owner,
    asset,
    config,
    market: null,
    price,
    now,
    strike: ((price.priceE8 + 50_000_000n) / 100_000_000n) * 100_000_000n,
    expiry: ceilGrid(now + 3600),
    outcome: "yes" as const,
    budget: 10,
  };
  return { client, connection, params };
}
describe("production quote guards", () => {
  it("does not promise liquidity when treasury is empty", async () => {
    const { client, params } = setup(0n);
    expect((await client.quoteBuyMarket(params)).quote.contracts).toBe(0n);
    await expect(client.buildBuyTx(params)).rejects.toThrow("No liquidity");
  });
  it("rejects stale, partial, wrong-feed and uncertain oracle estimates", async () => {
    const { client, params } = setup();
    for (const patch of [
      { publishTime: now - 61 },
      { verification: "partial" as const },
      { feedId: "0".repeat(64) },
      { conf: price.price },
    ]) {
      await expect(
        client.quoteBuyMarket({ ...params, price: { ...price, ...patch } })
      ).rejects.toThrow(/Oracle/);
    }
  });
  it("has estimated liquidity when funded", async () => {
    const { client, params } = setup();
    const q = await client.quoteBuyMarket(params);
    expect(q.needsMarket && q.refresh && q.estimated).toBe(true);
    expect(q.quote.contracts).toBeGreaterThan(0n);
    expect(q.quote.escrow).toBeLessThanOrEqual(10n * UNIT);
  });
  it("checks the oracle owner singly and batched", async () => {
    const { client, connection } = setup();
    const info = {
      data: raw,
      owner: PublicKey.default,
      lamports: 1,
      executable: false,
      rentEpoch: 0,
    };
    vi.mocked(connection.getAccountInfo).mockResolvedValue(info);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([info]);
    expect(await client.fetchPrice(address)).toBeNull();
    expect(await client.fetchPrices([address])).toEqual([null]);
    info.owner = PYTH_RECEIVER_ID;
    expect((await client.fetchPrice(address))?.feedId).toBe(price.feedId);
  });
});
describe("operator ladder dates", () => {
  it.each([
    "2026-10-11T14:42:00Z",
    "2026-10-15T23:59:00Z",
    "2026-10-16T17:00:00Z",
  ])("uses requested UTC dates from %s", (iso) => {
    const t = Date.parse(iso) / 1000;
    const [hour, day, week] = ladderExpiries(t);
    expect(hour.expiry - t).toBeGreaterThanOrEqual(3600);
    expect(hour.expiry - t).toBeLessThan(3900);
    expect(hour.expiry % 300).toBe(0);
    expect(Math.floor(day.expiry / 86400)).toBe(Math.floor(t / 86400) + 1);
    expect(new Date(day.expiry * 1000).getUTCHours()).toBe(16);
    expect(new Date(week.expiry * 1000).getUTCDay()).toBe(5);
    expect(new Date(week.expiry * 1000).getUTCHours()).toBe(16);
    expect(week.expiry).toBeGreaterThan(t);
  });
});
