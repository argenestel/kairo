/** Client-side lognormal fair value (zero rate) — used for instant previews before an adapter quote lands, and by the mock. */
import type { Direction } from '../chains/types';

export function normCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26 via erf
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? y : -y));
}

export const YEAR = 365 * 24 * 3600;

/** P(S_T >= K) — N(d2). */
export function probAbove(spot: number, strike: number, vol: number, seconds: number): number {
  if (spot <= 0 || strike <= 0) return 0.5;
  if (seconds <= 0) return spot >= strike ? 1 : 0;
  const T = seconds / YEAR;
  const sd = vol * Math.sqrt(T);
  if (sd <= 0) return spot >= strike ? 1 : 0;
  const d2 = (Math.log(spot / strike) - (vol * vol * T) / 2) / sd;
  return normCdf(d2);
}

export function chanceFor(direction: Direction, spot: number, strike: number, vol: number, seconds: number): number {
  const p = probAbove(spot, strike, vol, seconds);
  return direction === 'above' ? p : 1 - p;
}

/** Rough instant estimate of the ask a maker would show (fair + ~1.5¢ half-spread, 1–99¢). */
export function estimatePrice(chance: number): number {
  return Math.min(0.99, Math.max(0.01, Math.ceil((chance + 0.015) * 100) / 100));
}

/** One-sigma move over `seconds` as a fraction of spot. */
export function sigmaMove(vol: number, seconds: number): number {
  return vol * Math.sqrt(Math.max(seconds, 60) / YEAR);
}
