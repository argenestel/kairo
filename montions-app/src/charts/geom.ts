/** Chart geometry helpers — ticks, mapping, clamp. */

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function nice(range: number, round: boolean): number {
  if (!(range > 0) || !isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

/** Approximately `count` ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  if (max - min < 1e-12) return [min];
  const step = nice((max - min) / Math.max(1, count), true);
  if (!(step > 0)) return [min, max];
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let x = start, i = 0; x <= max + step * 0.01 && i < 14; x += step, i++) {
    const v = Math.abs(x) < step * 1e-9 ? 0 : x;
    ticks.push(v);
  }
  return ticks.length ? ticks : [min, max];
}

export function fmtAxisTime(t: number): string {
  const d = new Date(t * 1000);
  const now = Date.now() / 1000;
  const sameDay = Math.abs(t - now) < 36 * 3600 && d.getUTCDate() === new Date(now * 1000).getUTCDate();
  if (sameDay || (t >= now - 20 * 3600 && t <= now + 20 * 3600)) {
    return d.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Box-Muller using a tiny LCG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
