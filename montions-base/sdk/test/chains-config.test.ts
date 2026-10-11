import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalMarketKey, chainById, parseChainsConfig, strikeStepFor } from "../src/chains-config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("config/chains.json", () => {
  const cfg = parseChainsConfig(JSON.parse(readFileSync(resolve(root, "config/chains.json"), "utf8")));

  it("declares the shared strike grids and 16:00 UTC expiry schedule", () => {
    expect(cfg.canonicalAssets).toEqual(["ETH", "BTC", "LINK", "SOL"]);
    expect(cfg.strikeCount).toBe(7);
    expect(cfg.strikeGrids).toEqual({ ETH: 25, BTC: 500, LINK: 0.25, SOL: 1 });
    expect(cfg.expirySchedule).toMatchObject({ hourUtc: 16, minuteUtc: 0 });
  });

  it("fills Base Sepolia, Arbitrum Sepolia and a HyperCore schema stub", () => {
    const base = chainById(cfg, 84532);
    const arb = chainById(cfg, 421614);
    const hyper = chainById(cfg, 998);
    expect(base.oracle).toBe("chainlink");
    expect(arb.oracle).toBe("chainlink");
    expect(hyper.oracle).toBe("hypercore");
    expect(base.assets.filter((a) => a.ladder).map((a) => a.symbol)).toEqual(["ETH", "BTC", "LINK"]);
    expect(arb.assets.filter((a) => a.ladder).map((a) => a.symbol)).toEqual(["ETH", "BTC", "LINK"]);
    const stockTiers = new Set(["stock", "etf", "commodity"]);
    expect(base.assets.filter((a) => a.tier && stockTiers.has(a.tier)).map((a) => a.symbol)).toHaveLength(29);
    expect(arb.assets.filter((a) => a.tier && stockTiers.has(a.tier)).map((a) => a.symbol)).toHaveLength(29);
    expect(base.assets.find((a) => a.symbol === "TSLA")?.tier).toBe("stock");
    expect(base.assets.find((a) => a.symbol === "SPY")?.tier).toBe("etf");
    expect(base.assets.find((a) => a.symbol === "GLD")?.tier).toBe("commodity");
    expect(hyper.assets.map((a) => a.symbol)).toEqual(["SOL", "BTC", "ETH"]);
    expect(strikeStepFor(cfg, "ETH")).toBe(25);
    expect(canonicalMarketKey("eth", 2500, 1_700_150_400)).toBe("ETH:2500:1700150400");
  });
});
