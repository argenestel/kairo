/** Number + date formatting. All day-level dates are shown in UTC (expiries are defined in UTC). */

const MINUS = '−';

function withDp(n: number, dp: number): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Decimals needed to show a step exactly (0.005 → 3, 25 → 0). */
export function decimalsOf(step: number): number {
  if (!isFinite(step) || step <= 0) return 2;
  let dp = 0;
  while (dp < 8 && Math.abs(Math.round(step * 10 ** dp) - step * 10 ** dp) > 1e-9 * 10 ** dp) dp++;
  return dp;
}

/** Sensible decimals for a spot price: BTC $83,412 · SOL $109.42 · DOGE $0.0853. */
export function spotDp(n: number): number {
  const a = Math.abs(n);
  if (a >= 1000) return 0;
  if (a >= 1) return 2;
  if (a === 0) return 2;
  return Math.min(8, Math.ceil(-Math.log10(a)) + 2);
}

export function fmtPrice(n: number): string {
  if (!isFinite(n)) return '—';
  return `${n < 0 ? MINUS : ''}$${withDp(n, spotDp(n))}`;
}

/** Strike with enough decimals to tell neighbours apart: $120.00 · $83,000 · $0.085. */
export function fmtStrike(k: number, step: number): string {
  const base = Math.abs(k) >= 1000 ? 0 : Math.abs(k) >= 1 ? 2 : 0;
  return `$${withDp(k, Math.max(base, decimalsOf(step)))}`;
}

/** Strike without trailing zeros for compact titles: $120 · $0.085 · $83,000. */
export function fmtStrikeShort(k: number, step: number): string {
  const dp = Math.max(decimalsOf(step), 0);
  const s = withDp(k, dp);
  return `$${dp > 0 ? s.replace(/\.?0+$/, '') : s}`;
}

/** Money amounts: $100 · $97.20 · $1,250 */
export function fmtMoney(n: number, forceDp?: number): string {
  if (!isFinite(n)) return '—';
  const dp = forceDp ?? (Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);
  return `${n < 0 ? MINUS : ''}$${withDp(n, dp)}`;
}

export function fmtSignedMoney(n: number, forceDp?: number): string {
  return `${n >= 0 ? '+' : MINUS}${fmtMoney(Math.abs(n), forceDp)}`;
}

export function fmtSignedPrice(n: number, dp: number): string {
  return `${n >= 0 ? '+' : MINUS}$${withDp(n, dp)}`;
}

/** Contract price in cents: 37¢ · 37.4¢ · <1¢ */
export function fmtCents(p: number): string {
  if (!isFinite(p)) return '—';
  const c = p * 100;
  if (c > 0 && c < 1) return '<1¢';
  const r = Math.round(c * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}¢`;
}

export function fmtPct(x: number, dp = 0): string {
  if (!isFinite(x)) return '—';
  const v = x * 100;
  if (dp === 0 && v > 0 && v < 1) return '<1%';
  if (dp === 0 && v < 100 && v > 99) return '>99%';
  return `${v.toFixed(dp)}%`;
}

export function fmtSignedPct(x: number, dp = 1): string {
  return `${x >= 0 ? '+' : MINUS}${Math.abs(x * 100).toFixed(dp)}%`;
}

/** Notional / volume: $1.2k · $3.4M · $880 */
export function fmtVolume(n: number): string {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? MINUS : ''}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `${n < 0 ? MINUS : ''}$${(a / 1000).toFixed(0)}k`;
  if (a >= 1000) return `${n < 0 ? MINUS : ''}$${(a / 1000).toFixed(1)}k`;
  return fmtMoney(n, 0);
}

export function fmtContracts(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 100 || Number.isInteger(n)) return Math.round(n).toLocaleString('en-US');
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function fmtMultiple(x: number): string {
  if (!isFinite(x) || x <= 0) return '—';
  return `${x >= 10 ? x.toFixed(0) : x.toFixed(1)}x`;
}

export function shortAddr(a: string | null | undefined, head = 4, tail = 4): string {
  if (!a) return '';
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

// ── dates (UTC) ─────────────────────────────────────────────────────────

const d = (t: number) => new Date(t * 1000);
const fmt = (t: number, o: Intl.DateTimeFormatOptions) => d(t).toLocaleString('en-US', { timeZone: 'UTC', ...o });

export const nowSec = () => Date.now() / 1000;

export function utcDayStart(t: number): number {
  const x = d(t);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / 1000;
}

export function isSameUtcDay(a: number, b: number) {
  return utcDayStart(a) === utcDayStart(b);
}

/** "16:00" */
export const fmtClock = (t: number) => fmt(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "Friday, Oct 17" — or "Today, 17:00 UTC" for same-day expiries. */
export function fmtDayLong(t: number, now = nowSec()): string {
  if (isSameUtcDay(t, now)) return `Today, ${fmtClock(t)} UTC`;
  if (isSameUtcDay(t, now + 86400) && t - now < 30 * 3600) return `Tomorrow, ${fmtClock(t)} UTC`;
  return fmt(t, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Sentence pill: "Oct 18" or "17:00 UTC" when it is less than ~20 h away. */
export function fmtDayShort(t: number, now = nowSec()): string {
  if (t - now < 20 * 3600) return `${fmtClock(t)} UTC`;
  return fmt(t, { month: 'short', day: 'numeric' });
}

export const fmtDayFull = (t: number) => fmt(t, { month: 'long', day: 'numeric', year: 'numeric' });
export const fmtMonthDay = (t: number) => fmt(t, { month: 'short', day: 'numeric' });
export const fmtMMDD = (t: number) => fmt(t, { month: '2-digit', day: '2-digit' });
export const fmtMonth = (t: number) => fmt(t, { month: 'short' });
export const fmtWeekdayShort = (t: number) => fmt(t, { weekday: 'short', day: 'numeric' });

/** "Oct 18 (16:00 UTC)" */
export function fmtExpiryNote(t: number, now = nowSec()): string {
  if (isSameUtcDay(t, now)) return `today at ${fmtClock(t)} UTC`;
  return `${fmtMonthDay(t)} (${fmtClock(t)} UTC)`;
}

/** "in 6 days" · "in 5 hours" · "in 12 min" */
export function fmtIn(t: number, now = nowSec()): { n: string; unit: string; text: string } {
  const s = Math.max(0, t - now);
  let n: number;
  let unit: string;
  if (s >= 2 * 86400) { n = Math.round(s / 86400); unit = 'days'; }
  else if (s >= 86400) { n = Math.round(s / 3600); unit = 'hours'; }
  else if (s >= 2 * 3600) { n = Math.round(s / 3600); unit = 'hours'; }
  else if (s >= 120) { n = Math.round(s / 60); unit = 'min'; }
  else { n = Math.round(s); unit = 'sec'; }
  return { n: String(n), unit, text: `in ${n} ${unit}` };
}

/** Live countdown: "6d 4h" · "4h 12m" · "12m 30s" · "Expired" */
export function fmtCountdown(t: number, now = nowSec()): string {
  let s = Math.floor(t - now);
  if (s <= 0) return 'Expired';
  const days = Math.floor(s / 86400); s -= days * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (days > 0) return `${days}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
