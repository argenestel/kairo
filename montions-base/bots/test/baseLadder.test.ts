import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRIKE_STEPS,
  lastFridayNextMonth16Utc,
  ladderExpiries,
  nextFriday16Utc,
  plannedSeries,
  seriesMarketKey,
  strikes,
  tomorrow16Utc,
} from "../src/ladder.js";

const ETH = `0x${"11".repeat(32)}` as const;

describe("cross-chain Chainlink ladder schedule", () => {
  const now = 1_760_000_000n;

  it("anchors tomorrow, next Friday and next month's last Friday at 16:00 UTC", () => {
    const expiries = ladderExpiries(now);
    expect(expiries).toEqual([tomorrow16Utc(now), nextFriday16Utc(now), lastFridayNextMonth16Utc(now)]);
    for (const expiry of expiries) {
      const date = new Date(Number(expiry) * 1000);
      expect(date.getUTCHours()).toBe(16);
      expect(date.getUTCMinutes()).toBe(0);
    }
  });

  it("uses seven $25 ETH strikes on the shared absolute grid", () => {
    const grid = strikes(2_500n * 10n ** 18n, 25, 7);
    expect(grid).toHaveLength(7);
    expect(grid[3]).toBe(2_500n * 10n ** 18n);
    expect(grid[0]).toBe(2_425n * 10n ** 18n);
    expect(grid[6]).toBe(2_575n * 10n ** 18n);
  });

  it("keeps the same SYMBOL:strike:expiry keys when spots differ by a few steps", () => {
    const wad = (n: number) => BigInt(n) * 10n ** 18n;
    const base = strikes(wad(2512), 25, 7);
    const arb = strikes(wad(2513), 25, 7);
    const drifted = strikes(wad(2575), 25, 7);
    expect(base).toEqual(arb);
    expect(base).toEqual(drifted);
    expect(base[3]).toBe(wad(2500));

    const now = 1_760_000_000n;
    const plan = (spot: bigint) =>
      plannedSeries(now, [{ symbol: "ETH", assetId: ETH, spotWad: spot, settleDelay: 3_600, strikeStep: 25 }]);
    const keys = (items: ReturnType<typeof plannedSeries>) =>
      items.map((item) => seriesMarketKey(item.symbol, item.strikeWad, item.expiry));
    expect(keys(plan(wad(2512)))).toEqual(keys(plan(wad(2575))));
  });

  it("uses the shared absolute grids for ETH/BTC/LINK/SOL", () => {
    expect(DEFAULT_STRIKE_STEPS).toEqual({ ETH: 25, BTC: 500, LINK: 0.25, SOL: 1 });
    expect(strikes(83_000n * 10n ** 18n, 500, 7)[3]).toBe(82_000n * 10n ** 18n); // $2,000 coarse center
    expect(strikes(13n * 10n ** 18n, 0.25, 7)[3]).toBe(13n * 10n ** 18n);
    expect(strikes(110n * 10n ** 18n, 1, 7)[3]).toBe(108n * 10n ** 18n); // $4 coarse center
  });

  it("plans three expiries and seven strikes per eligible asset", () => {
    const plan = plannedSeries(now, [
      { symbol: "ETH", assetId: ETH, spotWad: 2_500n * 10n ** 18n, settleDelay: 3_600, strikeStep: 25 },
      { symbol: "USDC", assetId: `0x${"22".repeat(32)}`, spotWad: 1n * 10n ** 18n, settleDelay: 90_000, strikeStep: 0.001, ladder: false },
    ]);
    expect(plan).toHaveLength(21);
    expect(new Set(plan.map((item) => item.expiry)).size).toBe(3);
    expect(new Set(plan.map((item) => item.strikeWad)).size).toBe(7);
    expect(new Set(plan.map((item) => item.window))).toEqual(new Set([3_600]));
  });
});
