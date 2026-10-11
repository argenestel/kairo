import type { Hex } from "viem";

/** Minimal data needed to select a Chainlink settlement round. */
export interface ChainlinkRound {
  roundId: bigint;
  updatedAt: bigint;
  answer?: bigint;
}

export interface RoundReader {
  getRoundData(roundId: bigint): Promise<ChainlinkRound>;
}

const AGGREGATOR_ROUND_MASK = (1n << 64n) - 1n;
const DEFAULT_MAX_ROUNDS = 8192; // > 2-day VOID_GRACE at a 30s Arbitrum heartbeat
const PAGE_SIZE = 512;

async function readRound(reader: RoundReader, roundId: bigint): Promise<ChainlinkRound | undefined> {
  try {
    const round = await reader.getRoundData(roundId);
    if (round.roundId !== roundId || round.updatedAt === 0n) return undefined;
    return round;
  } catch {
    return undefined;
  }
}

function isFirstRoundOfLaterPhase(roundId: bigint): boolean {
  const phase = roundId >> 64n;
  const aggregatorRound = roundId & AGGREGATOR_ROUND_MASK;
  return aggregatorRound === 1n && phase !== 1n;
}

/**
 * Walks backwards from a proxy's latest round and returns the first round at
 * or after expiry. Pages of 512 so a 30s Arbitrum feed that printed through a
 * keeper outage (VOID_GRACE = 2 days ≈ 5760 rounds) is still found. A later
 * phase's first round is rejected because the proxy does not expose a
 * provable predecessor for it.
 */
export async function findFirstRoundAfterExpiry(
  latestRoundId: bigint,
  expiry: bigint,
  reader: RoundReader,
  options: { maxRounds?: number } = {},
): Promise<bigint | undefined> {
  if (latestRoundId <= 0n) return undefined;
  if (expiry < 0n) throw new RangeError("expiry must be non-negative");
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  if (!Number.isInteger(maxRounds) || maxRounds <= 0) throw new RangeError("maxRounds must be positive");

  let current = latestRoundId;
  let scanned = 0;
  while (scanned < maxRounds) {
    const page = Math.min(PAGE_SIZE, maxRounds - scanned);
    for (let attempts = 0; attempts < page; attempts++) {
      scanned++;
      const round = await readRound(reader, current);
      if (!round) return undefined;
      if (round.updatedAt < expiry) return undefined;

      const aggregatorRound = current & AGGREGATOR_ROUND_MASK;
      if (aggregatorRound === 0n) return undefined;
      if (aggregatorRound === 1n) {
        // ChainlinkSettlementResolver accepts only the genesis phase's first
        // round; a phase upgrade must be allowed to void instead of guessing.
        return isFirstRoundOfLaterPhase(current) ? undefined : current;
      }

      const previous = current - 1n;
      const previousRound = await readRound(reader, previous);
      if (!previousRound) return undefined;
      if (previousRound.updatedAt < expiry) return current;
      current = previous;
    }
    // Exhausted a 512-round page but still sitting after expiry: search harder.
  }
  return undefined;
}

/** Decodes an ABI round tuple returned by viem in either tuple or named form. */
export function parseChainlinkRound(value: unknown): ChainlinkRound {
  const field = (index: number, name: string): unknown => {
    if (Array.isArray(value)) return value[index];
    if (value !== null && typeof value === "object") return (value as Record<string, unknown>)[name];
    return undefined;
  };
  const roundId = field(0, "roundId_") ?? field(0, "roundId");
  const updatedAt = field(3, "updatedAt");
  if (roundId === undefined || updatedAt === undefined) throw new Error("Malformed Chainlink round tuple");
  return { roundId: BigInt(roundId as bigint | number | string), updatedAt: BigInt(updatedAt as bigint | number | string) };
}

export function roundIdPhase(roundId: bigint): bigint {
  return roundId >> 64n;
}

export function roundIdInPhase(roundId: bigint): bigint {
  return roundId & AGGREGATOR_ROUND_MASK;
}

export type ChainlinkAssetId = Hex;
