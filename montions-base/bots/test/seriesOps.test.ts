import { describe, expect, it } from "vitest";
import { seriesStatus, SERIES_STATUS } from "../src/seriesOps.js";

const BOOK = "0x00000000000000000000000000000000000000b0" as const;
const SERIES = `0x${"11".repeat(32)}` as const;

function contextWith(readContract: () => Promise<unknown>) {
  return { publicClient: { readContract } } as never;
}

describe("series status probing", () => {
  it("treats the Book's SeriesUnknown revert as a missing series", async () => {
    const status = await seriesStatus(
      contextWith(async () => { throw new Error("ContractFunctionRevertedError: 0x52708a9c"); }),
      BOOK,
      SERIES,
    );
    expect(status).toBe(SERIES_STATUS.None);
  });

  it("keeps transport failures unknown so a seed batch cannot collide", async () => {
    const status = await seriesStatus(
      contextWith(async () => { throw new Error("unexpected decode failure"); }),
      BOOK,
      SERIES,
    );
    expect(status).toBeNull();
  });
});
