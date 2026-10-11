/**
 * Units: collateral base units (6 decimals, bigint), ticks 1..=99 (cents), prices/strikes 1e-8 USD (bigint).
 * Port of the EVM sdk's ticks.ts (WAD prices replaced by e8).
 */
import { MAX_TICK, MIN_TICK, PRICE_SCALE, TICKS, TICK_UNIT, UNIT } from './constants.js';

export type Tick = number;
export type TickRounding = 'down' | 'up' | 'nearest';

/** ceil(n / d) for n >= 0, d > 0. */
export function ceilDiv(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new RangeError('ceilDiv expects n >= 0 and d > 0');
  return n === 0n ? 0n : (n - 1n) / d + 1n;
}

export function assertTick(tick: number, allowZero = false): Tick {
  const lower = allowZero ? 0 : MIN_TICK;
  if (!Number.isInteger(tick) || tick < lower || tick > MAX_TICK) {
    throw new RangeError(`tick must be an integer in [${lower}, ${MAX_TICK}]`);
  }
  return tick;
}

export function clampTick(tick: number): Tick {
  if (!Number.isFinite(tick)) throw new RangeError('tick must be finite');
  return Math.max(MIN_TICK, Math.min(MAX_TICK, Math.round(tick)));
}

/** Collateral for `quantity` contracts at `tick` (base units). */
export function tickToUsdc(tick: number, quantity: bigint = 1n): bigint {
  assertTick(tick);
  if (quantity < 0n) throw new RangeError('quantity must be non-negative');
  return BigInt(tick) * TICK_UNIT * quantity;
}

/** YES tick → NO tick (and back). */
export const oppositeTick = (tick: number): number => TICKS - tick;

/** Tick → probability/price in [0,1]. */
export const tickToProb = (tick: number): number => tick / TICKS;

/** Probability in [0,1] → tick (not clamped unless `clamp`). */
export function probToTickNumber(p: number, rounding: TickRounding = 'nearest', clamp = true): number {
  const raw = p * TICKS;
  const eps = 1e-9;
  const t = rounding === 'down' ? Math.floor(raw + eps) : rounding === 'up' ? Math.ceil(raw - eps) : Math.round(raw);
  return clamp ? Math.max(MIN_TICK, Math.min(MAX_TICK, t)) : t;
}

/** Parse decimal USD ("10.25", 10.25, "$1,000") into base units (6 decimals, truncating extra digits). */
export function parseUsdc(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RangeError('USDC amount must be non-negative');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('USDC amount must be a finite non-negative number');
    return BigInt(Math.floor(value * 1_000_000 + 1e-6));
  }
  let text = value.trim();
  if (text.startsWith('$')) text = text.slice(1);
  text = text.replaceAll(',', '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new TypeError(`invalid USDC amount: ${value}`);
  const whole = BigInt(m[1]!);
  const frac = (m[2] ?? '').slice(0, 6).padEnd(6, '0');
  return whole * UNIT + BigInt(frac || '0');
}

/** Base units → float USD (display only). */
export const usdcToNumber = (amount: bigint): number => Number(amount) / 1_000_000;

export interface FormatUsdcOptions {
  decimals?: number;
  symbol?: string;
  trim?: boolean;
}

export function formatUsdc(amount: bigint, options: FormatUsdcOptions = {}): string {
  if (amount < 0n) return `-${formatUsdc(-amount, options)}`;
  const decimals = options.decimals ?? 2;
  const symbol = options.symbol ?? '$';
  const trim = options.trim ?? true;
  const whole = amount / UNIT;
  const six = (amount % UNIT).toString().padStart(6, '0');
  let frac = decimals === 0 ? '' : six.slice(0, decimals);
  if (trim && frac) frac = frac.replace(/0+$/, '');
  return `${symbol}${whole}${frac ? `.${frac}` : ''}`;
}

// ── 1e-8 USD prices / strikes ──

/** USD (number or decimal string) → 1e-8 fixed point (rounded to nearest). */
export function usdToE8(usd: number | string): bigint {
  if (typeof usd === 'number') {
    if (!Number.isFinite(usd)) throw new RangeError('price must be finite');
    // Go through a fixed decimal string to avoid binary float drift (0.01 → 1_000_000 exactly).
    return usdToE8(usd.toFixed(8));
  }
  const text = usd.trim().replace(/^\$/, '').replaceAll(',', '');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new TypeError(`invalid USD price: ${usd}`);
  const neg = m[1] === '-';
  const frac = m[3] ?? '';
  let v = BigInt(m[2]!) * PRICE_SCALE + BigInt(frac.slice(0, 8).padEnd(8, '0') || '0');
  if (frac.length > 8 && Number(frac[8]) >= 5) v += 1n;
  return neg ? -v : v;
}

/** 1e-8 fixed point → float USD (display / model input). */
export const e8ToUsd = (v: bigint | number): number => Number(v) / 1e8;

/** Rescale a Pyth (value, exponent) to 1e-8 (truncating toward zero when exponent < -8). */
export function toE8(value: bigint, expo: number): bigint {
  const shift = expo + 8;
  if (shift >= 0) return value * 10n ** BigInt(shift);
  return value / 10n ** BigInt(-shift);
}

/** Format an e8 price with up to `maxDecimals` (trimmed). */
export function formatE8(v: bigint, maxDecimals = 8): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / PRICE_SCALE;
  let frac = (a % PRICE_SCALE).toString().padStart(8, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
