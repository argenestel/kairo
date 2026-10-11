import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ETH_PER_DAY,
  MAX_DISAGREEMENT,
  NYSE_HOLIDAYS,
  addSpent,
  assetId,
  disagreement,
  formatQuoteLine,
  formatWeiAsEth,
  fridayAfter,
  isNyseHoliday,
  isStockFeederEntrypoint,
  isWeekendEt,
  loadStocksConfig,
  nextFridayCloseUtc,
  parseEthToWei,
  parseNasdaqQuote,
  parseStooqCsv,
  parseYahooChart,
  pushIntent,
  SESSION_INTERVAL_MS,
  sourcesAgree,
  strikeToWad,
  threeAtmStrikes,
  toE8,
  wouldExceedDailyBudget,
  zonedParts,
  type ResolvedQuote,
} from "../src/stock-feeder.js";

describe("catalog", () => {
  it("loads 29 symbols with strike grids and 30d vol", () => {
    const cfg = loadStocksConfig();
    expect(cfg.assets).toHaveLength(29);
    const symbols = cfg.assets.map((a) => a.symbol);
    expect(symbols).toEqual([
      "TSLA", "AMD", "MSFT", "SPY", "NVDA", "QQQ", "MSTR", "AAPL", "AMZN", "META",
      "NFLX", "GOOGL", "AVGO", "COIN", "PLTR", "JPM", "V", "WMT", "XOM", "LLY",
      "ORCL", "BA", "DIS", "HOOD", "UBER", "IWM", "GLD", "TLT", "IBIT",
    ]);
    const tsla = cfg.assets[0]!;
    expect(tsla.category).toBe("stock");
    expect(tsla.strikes).toHaveLength(7);
    expect(tsla.vol).toBeGreaterThan(0.2);
    expect(cfg.assets.find((a) => a.symbol === "GLD")?.category).toBe("commodity");
    expect(cfg.assets.find((a) => a.symbol === "SPY")?.category).toBe("etf");
    expect(cfg.oracle.settleDelay).toBe(3600);
    expect(cfg.oracle.heartbeatSeconds).toBe(900);
    expect(cfg.expirySchedule.hourUtc).toBe(20);
    expect(SESSION_INTERVAL_MS).toBe(15 * 60 * 1000);
    const tslaStrikes = threeAtmStrikes(tsla.strikes, tsla.price);
    expect(tslaStrikes).toEqual([380, 385, 390]);
    expect(strikeToWad(177.5)).toBe(1775n * 10n ** 17n);
  });
});

describe("parsers", () => {
  it("parses Stooq CSV with header", () => {
    const csv = `Symbol,Date,Time,Open,High,Low,Close,Volume
TSLA.US,2026-10-09,16:00:00,382.38,388.56,379.12,382.7,38953094
`;
    const q = parseStooqCsv(csv, "TSLA");
    expect(q.price).toBe(382.7);
    expect(q.source).toBe("stooq");
    expect(q.observedAt).toBe(Date.parse("2026-10-09T16:00:00Z") / 1000);
  });

  it("parses Yahoo chart meta", () => {
    const q = parseYahooChart({
      chart: { result: [{ meta: { regularMarketPrice: 382.7, regularMarketTime: 1791576000 } }] },
    }, "TSLA");
    expect(q.price).toBe(382.7);
    expect(q.observedAt).toBe(1791576000);
  });

  it("parses Nasdaq lastSalePrice", () => {
    const q = parseNasdaqQuote({
      data: { primaryData: { lastSalePrice: "$382.70", lastTradeTimestamp: "Oct 9, 2026" } },
    }, "TSLA");
    expect(q.price).toBe(382.7);
  });
});

describe("cross-check", () => {
  it("allows <= 1% disagreement and rejects more", () => {
    expect(sourcesAgree(100, 100.5)).toBe(true);
    expect(sourcesAgree(100, 101)).toBe(true);
    expect(disagreement(100, 101.1)).toBeGreaterThan(MAX_DISAGREEMENT);
    expect(sourcesAgree(100, 101.2)).toBe(false);
  });

  it("rounds USD to 8 decimals", () => {
    expect(toE8(382.7)).toBe(38_270_000_000n);
    expect(toE8(46.55)).toBe(4_655_000_000n);
    expect(() => toE8(0)).toThrow(/positive/);
  });

  it("hashes symbols the way the hub does", () => {
    expect(assetId("TSLA")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(assetId("TSLA")).not.toBe(assetId("AMD"));
  });
});

describe("NYSE calendar", () => {
  it("treats Sunday as weekend heartbeat and Friday evening as close", () => {
    expect(pushIntent(new Date("2026-10-11T16:00:00Z"))).toBe("weekend-heartbeat");
    expect(pushIntent(new Date("2026-10-09T20:05:00Z"))).toBe("close"); // Friday 16:05 EDT
    expect(pushIntent(new Date("2026-10-09T18:00:00Z"))).toBe("session"); // Friday 14:00 EDT
    expect(pushIntent(new Date("2026-10-09T12:00:00Z"))).toBe("idle"); // Friday 08:00 EDT
    expect(pushIntent(new Date("2026-12-25T15:00:00Z"))).toBe("holiday-heartbeat");
  });

  it("knows 2026 Thanksgiving and the Independence observed Friday", () => {
    expect(NYSE_HOLIDAYS.has("2026-11-26")).toBe(true);
    expect(NYSE_HOLIDAYS.has("2026-07-03")).toBe(true);
    const xmas = zonedParts(new Date("2026-12-25T15:00:00Z"));
    expect(isNyseHoliday(xmas)).toBe(true);
    expect(isWeekendEt(zonedParts(new Date("2026-10-11T12:00:00Z")))).toBe(true);
  });

  it("schedules next Friday 20:00 UTC and the Friday after from a Sunday", () => {
    const sun = new Date("2026-10-11T16:38:00Z");
    expect(nextFridayCloseUtc(sun).toISOString()).toBe("2026-10-16T20:00:00.000Z");
    expect(fridayAfter(sun).toISOString()).toBe("2026-10-23T20:00:00.000Z");
  });

  it("skips a holiday Friday to the previous session", () => {
    // Christmas 2026 is Friday 25 Dec.
    const tue = new Date("2026-12-22T12:00:00Z");
    expect(nextFridayCloseUtc(tue).toISOString()).toBe("2026-12-24T20:00:00.000Z");
  });
});

describe("gas budget", () => {
  it("parses ETH decimals and flags a breach", () => {
    expect(parseEthToWei(DEFAULT_MAX_ETH_PER_DAY)).toBe(10n ** 16n);
    expect(formatWeiAsEth(10n ** 16n)).toBe("0.01");
    const state = { day: "2026-10-11", spentWei: 9n * 10n ** 15n };
    expect(wouldExceedDailyBudget(state, 2n * 10n ** 15n, 10n ** 16n, new Date("2026-10-11T12:00:00Z"))).toBe(true);
    expect(wouldExceedDailyBudget(state, 5n * 10n ** 14n, 10n ** 16n, new Date("2026-10-11T12:00:00Z"))).toBe(false);
    const next = addSpent(state, 1n, new Date("2026-10-12T00:00:01Z"));
    expect(next.day).toBe("2026-10-12");
    expect(next.spentWei).toBe(1n);
  });
});

describe("formatting + entrypoint", () => {
  it("formats a dry-run line and detects the CLI", () => {
    const q: ResolvedQuote = {
      symbol: "TSLA",
      price: 382.7,
      priceE8: 38_270_000_000n,
      observedAt: 1791576000,
      sources: [
        { source: "yahoo", symbol: "TSLA", price: 382.7, observedAt: 1791576000 },
        { source: "nasdaq", symbol: "TSLA", price: 382.7, observedAt: 0 },
      ],
    };
    expect(formatQuoteLine(q)).toContain("yahoo=382.7");
    expect(isStockFeederEntrypoint("/x/stock-feeder.ts")).toBe(true);
    expect(isStockFeederEntrypoint("/x/evm-keeper.ts")).toBe(false);
  });

  it("round-trips a tiny gas state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kairo-feeder-"));
    const path = join(dir, "gas.json");
    writeFileSync(path, JSON.stringify({ day: "2026-10-11", spentWei: "7" }));
    const raw = JSON.parse(readFileSync(path, "utf8")) as { spentWei: string };
    expect(BigInt(raw.spentWei)).toBe(7n);
    rmSync(dir, { recursive: true, force: true });
  });
});
