import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  DEFAULT_MAX_ETH_PER_DAY,
  DEFAULT_REFRESH_LIMIT,
  DEFAULT_REFRESH_MIN_TICKS,
  DEFAULT_REFRESH_WEI,
  VAULT_MIN_QUOTE_LIFE_SECONDS,
  estimateTxWei,
  formatWeiAsEth,
  isKeeperEntrypoint,
  parseEthToWei,
  quoteStateFrom,
  readGasStateFile,
  refreshReasonFor,
  rollDailyGas,
  selectRefreshTargets,
  wouldExceedDailyBudget,
  writeGasStateFile,
  type SeriesQuoteState,
} from "../src/evm-keeper.js";

const NOW = 1_760_000_000n;
const LIVE = NOW + BigInt(VAULT_MIN_QUOTE_LIFE_SECONDS) + 3_600n;

function id(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

function series(partial: Partial<SeriesQuoteState> & { n: number }): SeriesQuoteState {
  const { n, ...rest } = partial;
  return {
    id: id(n),
    expiry: LIVE,
    fairTick: 50,
    tracked: true,
    vaultBidTick: 48,
    vaultAskTick: 52,
    ...rest,
  };
}

describe("defaults", () => {
  it("caps refreshes and daily ETH at the gas-policy defaults", () => {
    expect(DEFAULT_REFRESH_LIMIT).toBe(4);
    expect(DEFAULT_REFRESH_MIN_TICKS).toBe(2);
    expect(VAULT_MIN_QUOTE_LIFE_SECONDS).toBe(600);
    expect(parseEthToWei(DEFAULT_MAX_ETH_PER_DAY)).toBe(10n ** 16n);
    expect(formatWeiAsEth(DEFAULT_REFRESH_WEI)).toBe("0.00007");
    expect(estimateTxWei("refresh")).toBe(DEFAULT_REFRESH_WEI);
  });
});

describe("ETH / daily gas accounting", () => {
  it("parses ETH decimals to wei", () => {
    expect(parseEthToWei("0.01")).toBe(10n ** 16n);
    expect(parseEthToWei("0.010")).toBe(10n ** 16n);
    expect(parseEthToWei("1")).toBe(10n ** 18n);
    expect(parseEthToWei("0")).toBe(0n);
    expect(parseEthToWei("1.5")).toBe(15n * 10n ** 17n);
  });

  it("rejects non-decimal ETH amounts", () => {
    expect(() => parseEthToWei("abc")).toThrow(/EVM_MAX_ETH_PER_DAY/);
    expect(() => parseEthToWei("-0.01")).toThrow(/EVM_MAX_ETH_PER_DAY/);
  });

  it("formats wei as a trimmed ETH decimal", () => {
    expect(formatWeiAsEth(0n)).toBe("0");
    expect(formatWeiAsEth(10n ** 18n)).toBe("1");
    expect(formatWeiAsEth(10n ** 16n)).toBe("0.01");
    expect(formatWeiAsEth(DEFAULT_REFRESH_WEI)).toBe("0.00007");
  });

  it("rolls the daily bucket at UTC midnight", () => {
    const morning = Date.parse("2026-04-11T00:00:00.000Z");
    const next = Date.parse("2026-04-12T00:00:00.000Z");
    const spent = rollDailyGas({ day: "2026-04-11", spentWei: 10n ** 16n }, morning);
    expect(spent).toEqual({ day: "2026-04-11", spentWei: 10n ** 16n });
    expect(rollDailyGas(spent, next)).toEqual({ day: "2026-04-12", spentWei: 0n });
    expect(rollDailyGas(undefined, morning)).toEqual({ day: "2026-04-11", spentWei: 0n });
  });

  it("treats an exact match as exhausted so refresh/create stop", () => {
    expect(wouldExceedDailyBudget(0n, parseEthToWei("0.01"))).toBe(false);
    expect(wouldExceedDailyBudget(10n ** 16n, parseEthToWei("0.01"))).toBe(true);
    expect(wouldExceedDailyBudget(0n, 0n)).toBe(true);
  });

  it("round-trips the state file and zeros a stale day", () => {
    const dir = mkdtempSync(join(tmpdir(), "evm-keeper-gas-"));
    const path = join(dir, "evm-keeper-gas.json");
    try {
      writeGasStateFile(path, { day: "2026-04-11", spentWei: 123n });
      const stored = JSON.parse(readFileSync(path, "utf8")) as { day: string; spentWei: string };
      expect(stored).toEqual({ day: "2026-04-11", spentWei: "123" });
      const sameDay = readGasStateFile(path, Date.parse("2026-04-11T12:00:00.000Z"));
      expect(sameDay).toEqual({ day: "2026-04-11", spentWei: 123n });
      writeFileSync(path, "{not json");
      const recovered = readGasStateFile(path, Date.parse("2026-04-11T12:00:00.000Z"));
      expect(recovered.spentWei).toBe(0n);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("vault quote aggregation", () => {
  it("takes the best open bid and ask and ignores filled/zero qty", () => {
    const state = quoteStateFrom({ id: id(1), expiry: LIVE }, 50, true, [
      { open: true, side: 0, tick: 47, qty: 10n },
      { open: true, side: 0, tick: 49, qty: 4n },
      { open: false, side: 0, tick: 90, qty: 9n },
      { open: true, side: 1, tick: 53, qty: 10n },
      { open: true, side: 1, tick: 51, qty: 2n },
      { open: true, side: 1, tick: 40, qty: 0n },
    ]);
    expect(state.vaultBidTick).toBe(49);
    expect(state.vaultAskTick).toBe(51);
    expect(state.fairTick).toBe(50);
    expect(state.tracked).toBe(true);
  });
});

describe("refresh selection", () => {
  const options = { now: NOW, minTicks: DEFAULT_REFRESH_MIN_TICKS, limit: DEFAULT_REFRESH_LIMIT };

  it("skips quotes still inside the min-tick band", () => {
    const close = series({ n: 1, vaultBidTick: 49, vaultAskTick: 51 }); // mid 50, |fair-mid|=0
    const almost = series({ n: 2, vaultBidTick: 48, vaultAskTick: 51 }); // mid 49.5, abs=0.5
    expect(refreshReasonFor(close, NOW, 2, VAULT_MIN_QUOTE_LIFE_SECONDS)).toBeUndefined();
    expect(selectRefreshTargets([close, almost], options)).toEqual([]);
  });

  it("refreshes when |fair − midpoint| is at least EVM_REFRESH_MIN_TICKS", () => {
    const stale = series({ n: 3, fairTick: 50, vaultBidTick: 46, vaultAskTick: 50 }); // mid 48, abs=2
    expect(refreshReasonFor(stale, NOW, 2, VAULT_MIN_QUOTE_LIFE_SECONDS)).toBe("stale");
    expect(selectRefreshTargets([stale], options).map((item) => item.reason)).toEqual(["stale"]);
  });

  it("refreshes a tracked series with a missing bid or ask", () => {
    const noAsk = series({ n: 4, vaultBidTick: 48, vaultAskTick: 0 });
    const noBid = series({ n: 5, vaultBidTick: 0, vaultAskTick: 52 });
    const bothGone = series({ n: 6, vaultBidTick: 0, vaultAskTick: 0, tracked: true });
    const picks = selectRefreshTargets([noAsk, noBid, bothGone], { ...options, limit: 10 });
    expect(picks.map((item) => item.reason)).toEqual(["missing_side", "missing_side", "missing_side"]);
  });

  it("treats an untracked series with no quotes as new", () => {
    const fresh = series({ n: 7, tracked: false, vaultBidTick: 0, vaultAskTick: 0 });
    expect(refreshReasonFor(fresh, NOW, 2, VAULT_MIN_QUOTE_LIFE_SECONDS)).toBe("new");
  });

  it("never refreshes inside the vault min time-to-expiry, even if quotes are gone", () => {
    const dying = series({
      n: 8,
      expiry: NOW + BigInt(VAULT_MIN_QUOTE_LIFE_SECONDS) - 1n,
      tracked: true,
      vaultBidTick: 0,
      vaultAskTick: 0,
    });
    const onBoundary = series({
      n: 9,
      expiry: NOW + BigInt(VAULT_MIN_QUOTE_LIFE_SECONDS),
      tracked: false,
      vaultBidTick: 0,
      vaultAskTick: 0,
    });
    expect(refreshReasonFor(dying, NOW, 2, VAULT_MIN_QUOTE_LIFE_SECONDS)).toBeUndefined();
    expect(refreshReasonFor(onBoundary, NOW, 2, VAULT_MIN_QUOTE_LIFE_SECONDS)).toBe("new");
  });

  it("skips unsupported fairs and already-expired series", () => {
    const zero = series({ n: 10, fairTick: 0, tracked: false, vaultBidTick: 0, vaultAskTick: 0 });
    const expired = series({ n: 11, expiry: NOW, tracked: false, vaultBidTick: 0, vaultAskTick: 0 });
    expect(selectRefreshTargets([zero, expired], options)).toEqual([]);
  });

  it("never returns more than the per-tick limit and ranks missing_side then new then stale", () => {
    const fixtures: SeriesQuoteState[] = [
      series({ n: 21, fairTick: 50, vaultBidTick: 38, vaultAskTick: 42 }), // mid 40, deviation 10
      series({ n: 22, fairTick: 50, vaultBidTick: 42, vaultAskTick: 46 }), // mid 44, deviation 6
      series({ n: 23, fairTick: 50, vaultBidTick: 48, vaultAskTick: 51 }), // mid 49.5, skip (<2)
      series({ n: 24, tracked: false, vaultBidTick: 0, vaultAskTick: 0 }), // new
      series({ n: 25, tracked: false, vaultBidTick: 0, vaultAskTick: 0, expiry: LIVE + 10n }), // new, later
      series({ n: 26, vaultBidTick: 48, vaultAskTick: 0 }), // missing ask
      series({ n: 27, vaultBidTick: 0, vaultAskTick: 52 }), // missing bid
      series({ n: 28, fairTick: 50, vaultBidTick: 28, vaultAskTick: 32 }), // mid 30, deviation 20
    ];
    const picks = selectRefreshTargets(fixtures, options);
    expect(picks).toHaveLength(4);
    expect(picks.map((item) => item.reason)).toEqual(["missing_side", "missing_side", "new", "new"]);
    expect(picks.map((item) => item.id)).toEqual([id(26), id(27), id(24), id(25)]);

    const staleOnly = selectRefreshTargets(
      fixtures.filter((item) => item.vaultBidTick > 0 && item.vaultAskTick > 0),
      { ...options, limit: 2 },
    );
    expect(staleOnly.map((item) => item.id)).toEqual([id(28), id(21)]);
    expect(staleOnly.every((item) => item.reason === "stale")).toBe(true);
  });

  it("returns nothing when the limit is zero", () => {
    const fresh = series({ n: 30, tracked: false, vaultBidTick: 0, vaultAskTick: 0 });
    expect(selectRefreshTargets([fresh], { ...options, limit: 0 })).toEqual([]);
  });
});

describe("entrypoint guard", () => {
  it("runs for the keeper scripts but not for vitest importing this module", () => {
    expect(isKeeperEntrypoint("/repo/bots/src/evm-keeper.ts")).toBe(true);
    expect(isKeeperEntrypoint("/repo/bots/src/base-keeper.ts")).toBe(true);
    expect(isKeeperEntrypoint("/repo/bots/test/evm-keeper.test.ts")).toBe(false);
    expect(isKeeperEntrypoint("/usr/bin/vitest")).toBe(false);
  });
});
