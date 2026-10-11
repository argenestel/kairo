import { YEAR } from '../lib/model';

export function coneBand(spot: number, vol: number, dtSec: number): { up: number; down: number } {
  const sig = vol * Math.sqrt(Math.max(dtSec, 0) / YEAR);
  const e = Math.exp(sig);
  return { up: spot * e, down: spot / e };
}

export function buildCone(
  t0: number,
  s0: number,
  expiry: number,
  vol: number,
  steps = 24,
): { t: number; up: number; down: number }[] {
  if (!(expiry > t0) || !(s0 > 0)) return [];
  const out: { t: number; up: number; down: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((expiry - t0) * i) / steps;
    const b = coneBand(s0, vol, t - t0);
    out.push({ t, up: b.up, down: b.down });
  }
  return out;
}

