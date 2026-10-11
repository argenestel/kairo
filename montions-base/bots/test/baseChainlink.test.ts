import { describe, expect, it } from "vitest";
import { findFirstRoundAfterExpiry, parseChainlinkRound } from "../src/baseChainlink.js";

function reader(rounds: Record<string, bigint>) {
  return {
    getRoundData: async (roundId: bigint) => ({ roundId, updatedAt: rounds[roundId.toString()] ?? 0n }),
  };
}

describe("Base Chainlink settlement scan", () => {
  it("returns the first round at or after expiry", async () => {
    const phase = 1n << 64n;
    const found = await findFirstRoundAfterExpiry(
      phase | 5n,
      1_000n,
      reader({
        [(phase | 1n).toString()]: 700n,
        [(phase | 2n).toString()]: 850n,
        [(phase | 3n).toString()]: 1_000n,
        [(phase | 4n).toString()]: 1_040n,
        [(phase | 5n).toString()]: 1_100n,
      }),
    );
    expect(found).toBe(phase | 3n);
  });

  it("handles exact expiry and refuses an unprovable later phase genesis", async () => {
    const phase = 1n << 64n;
    expect(await findFirstRoundAfterExpiry(phase | 2n, 1_000n, reader({
      [(phase | 1n).toString()]: 999n,
      [(phase | 2n).toString()]: 1_000n,
    }))).toBe(phase | 2n);
    const later = 2n << 64n;
    expect(await findFirstRoundAfterExpiry(later | 1n, 1_000n, reader({
      [(later | 1n).toString()]: 1_010n,
    }))).toBeUndefined();
  });

  it("parses viem's named and tuple round shapes", () => {
    expect(parseChainlinkRound([7n, 2_500n, 0n, 123n, 7n])).toEqual({ roundId: 7n, updatedAt: 123n });
    expect(parseChainlinkRound({ roundId: 7n, roundId_: 7n, updatedAt: 123n })).toEqual({ roundId: 7n, updatedAt: 123n });
  });

  it("pages past the old 512-round cap to find an Arb-style first print", async () => {
    const phase = 1n << 64n;
    const latestAgg = 600n;
    const firstAfter = 80n;
    const expiry = 10_000n;
    const rounds: Record<string, bigint> = {};
    for (let i = 1n; i <= latestAgg; i++) {
      // 30s cadence: round `firstAfter` is the first with updatedAt >= expiry.
      rounds[(phase | i).toString()] = expiry + (i - firstAfter) * 30n;
    }
    const found = await findFirstRoundAfterExpiry(phase | latestAgg, expiry, reader(rounds));
    expect(found).toBe(phase | firstAfter);
    const capped = await findFirstRoundAfterExpiry(phase | latestAgg, expiry, reader(rounds), { maxRounds: 512 });
    expect(capped).toBeUndefined();
  });
});
