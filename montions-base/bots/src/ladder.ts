/**
 * Cross-chain strike/expiry ladder.
 *
 * Every Chainlink (and HyperCore) venue lists the same (asset, strike, expiry)
 * keys: seven strikes on a shared absolute grid and three 16:00 UTC expiries
 * (tomorrow, next Friday, last Friday of next month). Grids default to
 * ETH $25, BTC $500, LINK $0.25, SOL $1 and are overridden by config/chains.json.
 */
import type { PlannedSeries } from "./seriesLadder.js";
import { loadChainsConfig, tryLoadChain } from "./chains.js";

const HOUR = 60n * 60n;
const DAY = 24n * HOUR;
const MAX_BOOK_DURATION = 90n * DAY;
const FRIDAY = 5;

export const DEFAULT_STRIKE_STEPS: Readonly<Record<string, number>> = {
  ETH: 25,
  BTC: 500,
  LINK: 0.25,
  SOL: 1,
};

/** Coarse multiple of the strike step used to pick the 7-strike window.
 * ETH $25 × 4 = $100, so a few dollars (or even a couple of $25 steps) of
 * cross-chain basis cannot shift the shared `SYMBOL:strike:expiry` keys. */
export const STRIKE_CENTER_MULTIPLE = 4;

export interface LadderAsset {
  symbol: string;
  assetId: `0x${string}`;
  spotWad: bigint;
  settleDelay: number;
  /** Absolute spacing in quote units, e.g. 25 for ETH or 0.25 for LINK. */
  strikeStep?: number | string;
  ladder?: boolean;
}

export interface LadderOptions {
  strikeCount?: number;
  now?: bigint;
}

function utcAt(year: number, month: number, day: number, hour: number, minute: number): bigint {
  return BigInt(Date.UTC(year, month, day, hour, minute, 0) / 1000);
}

function dayAt(now: bigint): Date {
  if (now < 0n || now > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("now must be a non-negative safe Unix timestamp");
  return new Date(Number(now) * 1000);
}

function schedule(): { hour: number; minute: number } {
  try {
    const cfg = loadChainsConfig().expirySchedule;
    return { hour: cfg.hourUtc, minute: cfg.minuteUtc };
  } catch {
    return { hour: 16, minute: 0 };
  }
}

function stamp(year: number, month: number, day: number): bigint {
  const { hour, minute } = schedule();
  return utcAt(year, month, day, hour, minute);
}

/** The next calendar day at the shared expiry hour (16:00 UTC). */
export function tomorrow16Utc(now: bigint): bigint {
  const date = dayAt(now);
  return stamp(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** The next Friday at 16:00 UTC, strictly after tomorrow's expiry. */
export function nextFriday16Utc(now: bigint): bigint {
  const date = dayAt(now);
  let days = (FRIDAY - date.getUTCDay() + 7) % 7;
  let candidate = stamp(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
  if (candidate <= now || candidate <= tomorrow16Utc(now)) {
    days += 7;
    candidate = stamp(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
  }
  return candidate;
}

/** The last Friday of the calendar month immediately following `now`. */
export function lastFridayNextMonth16Utc(now: bigint): bigint {
  const date = dayAt(now);
  const { hour, minute } = schedule();
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0, hour, minute, 0));
  const daysBack = (end.getUTCDay() - FRIDAY + 7) % 7;
  return stamp(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - daysBack);
}

export function ladderExpiries(now: bigint): bigint[] {
  const expiries = [tomorrow16Utc(now), nextFriday16Utc(now), lastFridayNextMonth16Utc(now)];
  const unique = [...new Set(expiries.map((value) => value.toString()))].map(BigInt);
  for (const expiry of unique) {
    const duration = expiry - now;
    if (duration < 120n || duration > MAX_BOOK_DURATION) {
      throw new RangeError(`ladder expiry ${expiry} is outside the Book duration bounds`);
    }
  }
  return unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** @deprecated Use {@link ladderExpiries}. */
export const baseLadderExpiries = ladderExpiries;

function decimalWad(value: number | string): bigint {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new RangeError(`invalid strike step: ${text}`);
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > 18) throw new RangeError("strike step has more than 18 decimals");
  const result = BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
  if (result <= 0n) throw new RangeError("strike step must be positive");
  return result;
}

function defaultStep(symbol: string, spotWad: bigint): bigint {
  const upper = symbol.toUpperCase();
  try {
    const cfg = loadChainsConfig();
    if (cfg.strikeGrids[upper] !== undefined) return decimalWad(cfg.strikeGrids[upper]!);
  } catch {
    // Fall through to baked-in cross-chain defaults.
  }
  if (DEFAULT_STRIKE_STEPS[upper] !== undefined) return decimalWad(DEFAULT_STRIKE_STEPS[upper]!);
  return ((spotWad * 2n) / 100n) || 1n;
}

function configuredStrikeCount(): number {
  try {
    return loadChainsConfig().strikeCount;
  } catch {
    return 7;
  }
}

/** Floor `spotWad` onto `k * spacing * STRIKE_CENTER_MULTIPLE` so nearby spots share a center. */
export function alignedCenter(spotWad: bigint, spacing: bigint, multiple = STRIKE_CENTER_MULTIPLE): bigint {
  if (spotWad <= 0n) throw new RangeError("spot must be positive");
  if (spacing <= 0n) throw new RangeError("spacing must be positive");
  if (!Number.isInteger(multiple) || multiple < 1) throw new RangeError("center multiple must be a positive integer");
  const coarse = spacing * BigInt(multiple);
  let center = (spotWad / coarse) * coarse;
  if (center === 0n) center = (spotWad / spacing) * spacing;
  if (center === 0n) center = spacing;
  return center;
}

/** Returns an ascending strike grid of `k * step` around a coarse-aligned center. */
export function strikes(spotWad: bigint, step?: number | string, count = 7): bigint[] {
  if (spotWad <= 0n) throw new RangeError("spot must be positive");
  if (!Number.isInteger(count) || count < 5 || count > 7) throw new RangeError("strike count must be between 5 and 7");
  const spacing = step === undefined ? defaultStep("ETH", spotWad) : decimalWad(step);
  const center = alignedCenter(spotWad, spacing);
  const left = Math.floor((count - 1) / 2);
  const result: bigint[] = [];
  for (let i = -left; i <= count - 1 - left; i++) {
    const strike = center + BigInt(i) * spacing;
    if (strike > 0n) result.push(strike);
  }
  if (result.length < 5) throw new RangeError("strike grid produced fewer than five positive strikes");
  return result;
}

/** `SYMBOL:strikeWad:expiry` — same economic event on every chain. */
export function seriesMarketKey(symbol: string, strikeWad: bigint, expiry: bigint): string {
  return `${symbol.toUpperCase()}:${strikeWad.toString()}:${expiry.toString()}`;
}

export function isGridStrike(strikeWad: bigint, step: number | string): boolean {
  const spacing = decimalWad(step);
  return spacing > 0n && strikeWad > 0n && strikeWad % spacing === 0n;
}

/** @deprecated Use {@link strikes}. */
export const baseStrikes = strikes;

export function stepForAsset(symbol: string, explicit?: number | string): number | string {
  if (explicit !== undefined) return explicit;
  const upper = symbol.toUpperCase();
  try {
    const cfg = loadChainsConfig();
    if (cfg.strikeGrids[upper] !== undefined) return cfg.strikeGrids[upper]!;
    const chainId = Number(process.env.CHAIN_ID ?? 0);
    const chain = chainId ? tryLoadChain(chainId) : undefined;
    const asset = chain?.assets.find((item) => item.symbol.toUpperCase() === upper);
    if (asset) return asset.strikeStep;
  } catch {
    // ignore
  }
  if (DEFAULT_STRIKE_STEPS[upper] !== undefined) return DEFAULT_STRIKE_STEPS[upper]!;
  throw new RangeError(`no strike grid for ${symbol}`);
}

export function plannedSeries(
  now: bigint,
  assets: readonly LadderAsset[],
  options: LadderOptions = {},
): PlannedSeries[] {
  const count = options.strikeCount ?? configuredStrikeCount();
  const at = options.now ?? now;
  const expiries = ladderExpiries(at);
  const result: PlannedSeries[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    if (asset.ladder === false) continue;
    if (!Number.isInteger(asset.settleDelay) || asset.settleDelay <= 0) {
      throw new RangeError(`${asset.symbol} settleDelay must be positive`);
    }
    const step = stepForAsset(asset.symbol, asset.strikeStep);
    for (const expiry of expiries) {
      for (const strikeWad of strikes(asset.spotWad, step, count)) {
        const item: PlannedSeries = {
          symbol: asset.symbol,
          assetId: asset.assetId,
          strikeWad,
          expiry,
          above: true,
          window: asset.settleDelay,
          bucket: "1d",
        };
        const key = `${asset.assetId.toLowerCase()}:${expiry}:${strikeWad}:${asset.settleDelay}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
    }
  }
  return result;
}

/** @deprecated Use {@link plannedSeries}. */
export const basePlannedSeries = plannedSeries;

export type BaseLadderAsset = LadderAsset;
export type BaseLadderOptions = LadderOptions;
