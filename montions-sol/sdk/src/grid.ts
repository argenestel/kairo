/**
 * Strike and expiry grids shared by the scripts, the keeper and the UI adapter.
 * All times are unix seconds (UTC; no DST). Strikes are bigint 1e-8 USD on the asset's `strikeStep` grid.
 */
import { EXPIRY_GRID, MAX_DURATION, MIN_DURATION } from "./constants.js";

const HOUR = 3600;
const DAY = 86_400;

/** Smallest multiple of `grid` strictly greater than `t`. */
export function nextGrid(t: number, grid = EXPIRY_GRID): number {
  return (Math.floor(t / grid) + 1) * grid;
}

/** Smallest multiple of `grid` >= `t`. */
export function ceilGrid(t: number, grid = EXPIRY_GRID): number {
  return Math.ceil(t / grid) * grid;
}

export function isValidExpiry(expiry: number, now: number): boolean {
  return (
    expiry % EXPIRY_GRID === 0 &&
    expiry >= now + MIN_DURATION &&
    expiry <= now + MAX_DURATION
  );
}

/** Next `hourUtc`:00 UTC at least `minAhead` seconds after `now`. */
export function nextDailyAt(now: number, hourUtc = 16, minAhead = 0): number {
  const dayStart = Math.floor(now / DAY) * DAY;
  let t = dayStart + hourUtc * HOUR;
  while (t < now + minAhead || t <= now) t += DAY;
  return t;
}

/** Next `weekday` (0 = Sunday … 5 = Friday) at `hourUtc`:00 UTC at least `minAhead` seconds after `now`. */
export function nextWeeklyAt(
  now: number,
  weekday = 5,
  hourUtc = 16,
  minAhead = 0
): number {
  let t = nextDailyAt(now, hourUtc, minAhead);
  while (new Date(t * 1000).getUTCDay() !== weekday) t += DAY;
  return t;
}

/** Last Friday of the month that contains `t` (16:00 UTC). */
export function isLastFridayOfMonth(t: number): boolean {
  const d = new Date(t * 1000);
  if (d.getUTCDay() !== 5) return false;
  const next = new Date((t + 7 * DAY) * 1000);
  return next.getUTCMonth() !== d.getUTCMonth();
}

export type LadderBucket = "hourly" | "daily" | "weekly";

export interface LadderExpiry {
  bucket: LadderBucket;
  expiry: number;
}

/**
 * The canonical "~1h / ~1d / ~1w" expiries the seed script and the keeper maintain:
 * - hourly: one hour ahead, rounded up to the 5-minute grid,
 * - daily: tomorrow at 16:00 UTC,
 * - weekly: next Friday at 16:00 UTC.
 * Deterministic inside each window, so repeated runs are idempotent.
 */
export function ladderExpiries(now: number): LadderExpiry[] {
  const hourly = ceilGrid(now + HOUR);
  const daily = (Math.floor(now / DAY) + 1) * DAY + 16 * HOUR;
  const weekly = nextWeeklyAt(now, 5, 16, MIN_DURATION);
  return [
    { bucket: "hourly", expiry: hourly },
    { bucket: "daily", expiry: daily },
    { bucket: "weekly", expiry: weekly },
  ];
}

export interface ExpiryChoice {
  expiry: number;
  tag?: string;
}

/**
 * Selectable expiries for the UI: 5-minute grid slots from `minAhead` to 1 h out, hourly to 6 h, every daily
 * 16:00 UTC for `days` days, Fridays tagged "Weekly", last Friday of the month "Monthly".
 * `minAhead` defaults to 15 min — the protocol maker stops quoting `min_tte` (10 min) before expiry.
 */
export function selectableExpiries(
  now: number,
  opts: { minAhead?: number; days?: number } = {}
): ExpiryChoice[] {
  const minAhead = opts.minAhead ?? 15 * 60;
  const days = opts.days ?? 30;
  const out = new Map<number, ExpiryChoice>();
  const add = (expiry: number, tag?: string) => {
    if (!isValidExpiry(expiry, now) || expiry < now + minAhead) return;
    const prev = out.get(expiry);
    if (!prev || (tag && !prev.tag))
      out.set(expiry, { expiry, ...(tag ? { tag } : {}) });
  };
  for (let t = ceilGrid(now + minAhead); t <= now + HOUR; t += EXPIRY_GRID)
    add(t);
  for (let t = ceilGrid(now + HOUR, HOUR); t <= now + 6 * HOUR; t += HOUR)
    add(t, t - now <= 1.5 * HOUR ? "Hourly" : undefined);
  let d = nextDailyAt(now, 16, minAhead);
  for (let i = 0; i < days; i++, d += DAY) {
    const dow = new Date(d * 1000).getUTCDay();
    add(
      d,
      dow === 5 ? (isLastFridayOfMonth(d) ? "Monthly" : "Weekly") : "Daily"
    );
  }
  return [...out.values()].sort((a, b) => a.expiry - b.expiry);
}

// ── strikes ──

/** Round a 1e-8 price to the nearest positive multiple of `stepE8`. */
export function snapStrike(
  priceE8: bigint,
  stepE8: bigint,
  mode: "nearest" | "down" | "up" = "nearest"
): bigint {
  if (stepE8 <= 0n) throw new RangeError("strike step must be positive");
  let k = priceE8 / stepE8;
  const r = priceE8 - k * stepE8;
  if (mode === "up" && r > 0n) k += 1n;
  if (mode === "nearest" && r * 2n >= stepE8) k += 1n;
  if (k < 1n) k = 1n;
  return k * stepE8;
}

/** `count` strikes centred on the grid strike nearest to `spotE8`, `spacingSteps` grid steps apart (ascending, > 0). */
export function strikesAround(
  spotE8: bigint,
  stepE8: bigint,
  count: number,
  spacingSteps = 1
): bigint[] {
  if (count <= 0) return [];
  const centre = snapStrike(spotE8, stepE8);
  const half = Math.floor((count - 1) / 2);
  const spacing = stepE8 * BigInt(Math.max(1, Math.round(spacingSteps)));
  const out: bigint[] = [];
  // If the bottom would go non-positive, shift the window up.
  let lowest = centre - BigInt(half) * spacing;
  while (lowest <= 0n) lowest += spacing;
  for (let i = 0; i < count; i++) out.push(lowest + BigInt(i) * spacing);
  return out;
}

/**
 * Strike spacing (in grid steps) so that `count` strikes span about ±`sigmas` standard deviations of the
 * log-price move to expiry (never below one step).
 */
export function autoStrikeSpacing(
  spotUsd: number,
  stepUsd: number,
  vol: number,
  tteSecs: number,
  count: number,
  sigmas = 1.5
): number {
  const half = Math.max(1, Math.floor((count - 1) / 2));
  const sd = vol * Math.sqrt(Math.max(tteSecs, 60) / (365 * DAY));
  const width = sigmas * sd * spotUsd;
  return Math.max(1, Math.round(width / half / stepUsd));
}
