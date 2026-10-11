import { describe, expect, it } from "vitest";
import {
  autoStrikeSpacing,
  ceilGrid,
  formatE8,
  formatUsdc,
  isValidExpiry,
  ladderExpiries,
  nextDailyAt,
  nextWeeklyAt,
  parseUsdc,
  planSentence,
  pnlAtExpiry,
  redeemPayout,
  resolvesYes,
  selectableExpiries,
  settlePosition,
  snapStrike,
  steppedPayoffCurve,
  strikesAround,
  usdToE8,
  voidPayout,
} from "../src/index.js";
import { decodeMarket } from "../src/index.js";
import { buildMarket, pk } from "./marketBuilder.js";

describe("payoff", () => {
  it("settles YES/NO", () => {
    expect(
      settlePosition({ side: "YES", quantity: 10n, cost: 3_500_000n }, true)
    ).toMatchObject({ won: true, payout: 10_000_000n, pnl: 6_500_000n });
    expect(
      pnlAtExpiry({ side: "no", quantity: 10n, entryTick: 35 }, true)
    ).toBe(-3_500_000n);
    expect(redeemPayout("resolved", false, 3n, 4n)).toBe(4_000_000n);
    expect(redeemPayout("void", false, 3n, 4n)).toBe(3_500_000n);
    expect(voidPayout(3n)).toBe(1_500_000n);
    expect(resolvesYes(11_000_000_000n, 11_000_000_000n)).toBe(true);
  });

  it("stepped curve: YES wins at equality", () => {
    const c = steppedPayoffCurve({
      side: "YES",
      quantity: 2n,
      cost: 1_000_000n,
      strikeE8: 100n,
      lowerE8: 0n,
      upperE8: 200n,
    });
    expect(c.map((p) => [p.x, p.y])).toEqual([
      [0n, -1_000_000n],
      [99n, -1_000_000n],
      [100n, 1_000_000n],
      [200n, 1_000_000n],
    ]);
  });
});

describe("units", () => {
  it("usdc", () => {
    expect(parseUsdc("10.25")).toBe(10_250_000n);
    expect(parseUsdc(0.1)).toBe(100_000n);
    expect(parseUsdc("$1,000")).toBe(1_000_000_000n);
    expect(formatUsdc(3_500_000n)).toBe("$3.5");
  });
  it("e8", () => {
    expect(usdToE8(0.01)).toBe(1_000_000n);
    expect(usdToE8(0.001)).toBe(100_000n);
    expect(usdToE8("109.35")).toBe(10_935_000_000n);
    expect(usdToE8(500)).toBe(50_000_000_000n);
    expect(formatE8(10_935_000_000n)).toBe("109.35");
    expect(formatE8(100_000n)).toBe("0.001");
  });
});

describe("grids", () => {
  const now = Date.UTC(2026, 9, 11, 19, 47, 13) / 1000; // Sunday 2026-10-11 19:47:13 UTC
  it("expiry helpers", () => {
    expect(ceilGrid(now) % 300).toBe(0);
    expect(nextDailyAt(now, 16)).toBe(Date.UTC(2026, 9, 12, 16) / 1000);
    expect(nextWeeklyAt(now, 5, 16)).toBe(Date.UTC(2026, 9, 16, 16) / 1000);
    const lad = ladderExpiries(now);
    expect(lad.map((l) => l.bucket)).toEqual(["hourly", "daily", "weekly"]);
    expect(lad[0]!.expiry).toBe(Date.UTC(2026, 9, 11, 20, 50) / 1000); // one hour ahead, rounded to the 5-minute grid
    expect(lad[1]!.expiry).toBe(Date.UTC(2026, 9, 12, 16) / 1000);
    expect(lad[2]!.expiry).toBe(Date.UTC(2026, 9, 16, 16) / 1000);
    for (const l of lad) expect(isValidExpiry(l.expiry, now)).toBe(true);
    // idempotent within a window
    expect(ladderExpiries(now + 60)).toEqual(lad);
  });

  it("selectable expiries", () => {
    const xs = selectableExpiries(now);
    expect(xs.length).toBeGreaterThan(30);
    expect(xs[0]!.expiry - now).toBeGreaterThanOrEqual(15 * 60);
    expect(xs.every((x) => x.expiry % 300 === 0)).toBe(true);
    expect(
      xs.find((x) => x.expiry === Date.UTC(2026, 9, 16, 16) / 1000)?.tag
    ).toBe("Weekly");
    expect(
      xs.find((x) => x.expiry === Date.UTC(2026, 9, 30, 16) / 1000)?.tag
    ).toBe("Monthly");
    const sorted = [...xs].sort((a, b) => a.expiry - b.expiry);
    expect(xs).toEqual(sorted);
  });

  it("strikes", () => {
    expect(snapStrike(10_935_000_000n, 100_000_000n)).toBe(10_900_000_000n);
    expect(snapStrike(10_955_000_000n, 100_000_000n)).toBe(11_000_000_000n);
    const s = strikesAround(10_935_000_000n, 100_000_000n, 7);
    expect(s.map((x) => Number(x / 100_000_000n))).toEqual([
      106, 107, 108, 109, 110, 111, 112,
    ]);
    expect(strikesAround(150_000n, 100_000n, 5).every((x) => x > 0n)).toBe(
      true
    );
    expect(autoStrikeSpacing(109, 1, 0.85, 7 * 86_400, 7)).toBeGreaterThan(3);
    expect(autoStrikeSpacing(109, 1, 0.85, 3600, 7)).toBe(1);
  });
});

describe("planSentence", () => {
  it("plans above (YES) and below (NO) orders", () => {
    const m = decodeMarket(
      buildMarket({
        asset: pk(1),
        feedId: new Uint8Array(32),
        creator: pk(2),
        yesMint: pk(3),
        noMint: pk(4),
        vault: pk(5),
        strike: 11_000_000_000n,
        expiry: 1_791_734_400,
        createdAt: 1,
        seats: [{ owner: pk(9) }],
        orders: [
          { side: 0, tick: 40, qty: 50n, seat: 0 },
          { side: 1, tick: 45, qty: 50n, seat: 0 },
        ],
      }),
      pk(77)
    );
    const [above] = planSentence(
      {
        direction: "above",
        strike: 11_000_000_000n,
        expiryCandidates: [1_791_734_400],
        payoffUsd: 20,
        maxSlippageTicks: 2,
      },
      [m]
    );
    expect(above!.complete).toBe(true);
    expect(above!.args.side).toBe(0);
    expect(above!.args.tick).toBe(47);
    expect(above!.cost).toBe(20n * 450_000n);
    const [below] = planSentence(
      {
        direction: "below",
        strike: 11_000_000_000n,
        expiryCandidates: [1_791_734_400],
        payoffUsd: "10.5",
        maxSlippageTicks: 0,
      },
      [m]
    );
    expect(below!.contracts).toBe(11n);
    expect(below!.args.side).toBe(1);
    expect(below!.args.tick).toBe(40);
    expect(below!.avgTick).toBe(60);
    expect(
      planSentence(
        {
          direction: "above",
          strike: 1n,
          expiryCandidates: [1_791_734_400],
          payoffUsd: 1,
          maxSlippageTicks: 0,
        },
        [m]
      )
    ).toEqual([]);
  });
});
