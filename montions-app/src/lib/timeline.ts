/**
 * Piecewise time → x mapping for the expiry scrubber, with zoom segments for short-dated expiries:
 *   [next hour: 5-min ticks] → [today: hourly ticks] → [days: one tick per day, week/month/year accents]
 */
import type { ExpiryOption } from '../chains/types';
import type { RulerMarker, RulerTick } from '../components/Ruler';
import { fmtClock, fmtMonth, fmtWeekdayShort, utcDayStart } from './format';

interface Segment { t0: number; t1: number; x0: number; pps: number; kind: 'min' | 'hour' | 'day' }

export interface TimelineModel {
  length: number;
  ticks: RulerTick[];
  stops: number[];
  markers: RulerMarker[];
  segments: Segment[];
  toX: (t: number) => number;
}

export function buildTimeline(expiries: ExpiryOption[], now: number, compact = false): TimelineModel {
  const segs: Segment[] = [];
  const pxMin = compact ? 3.2 : 4;          // per minute in the "next hour" zoom
  const pxHour = compact ? 18 : 22;         // per hour in the "today" zoom
  const pxDay = compact ? 14 : 17;          // per day
  const first = expiries[0]?.expiry ?? now + 7 * 86400;
  const last = expiries[expiries.length - 1]?.expiry ?? now + 30 * 86400;
  const hasMinutes = first < now + 3600;
  const hasHours = first < now + 36 * 3600;

  let x = 0;
  let t = now;
  if (hasMinutes) {
    const t1 = now + 3600;
    segs.push({ t0: t, t1, x0: x, pps: pxMin / 60, kind: 'min' });
    x += ((t1 - t) * pxMin) / 60;
    t = t1;
  }
  if (hasHours) {
    const t1 = Math.max(t + 3600, now + 24 * 3600);
    segs.push({ t0: t, t1, x0: x, pps: pxHour / 3600, kind: 'hour' });
    x += ((t1 - t) * pxHour) / 3600;
    t = t1;
  }
  const end = Math.max(last + 10 * 86400, now + 45 * 86400);
  segs.push({ t0: t, t1: end, x0: x, pps: pxDay / 86400, kind: 'day' });
  x += ((end - t) * pxDay) / 86400;
  const length = x;

  const toX = (tt: number) => {
    for (const s of segs) if (tt <= s.t1) return s.x0 + (Math.max(tt, s.t0) - s.t0) * s.pps;
    const s = segs[segs.length - 1];
    return s.x0 + (tt - s.t0) * s.pps;
  };

  const ticks: RulerTick[] = [{ x: 0, h: 0.55, label: 'Now', strong: true }];
  for (const s of segs) {
    if (s.kind === 'min') {
      const step = 300;
      for (let tt = Math.ceil((s.t0 + 1) / step) * step; tt < s.t1; tt += step) {
        const q = tt % 900 === 0;
        ticks.push({ x: toX(tt), h: q ? 0.32 : 0.12, label: tt % 1800 === 0 && toX(tt) > 26 ? fmtClock(tt) : undefined });
      }
    } else if (s.kind === 'hour') {
      for (let tt = Math.ceil((s.t0 + 1) / 3600) * 3600; tt < s.t1; tt += 3600) {
        const midnight = tt % 86400 === 0;
        const six = tt % (6 * 3600) === 0;
        ticks.push({
          x: toX(tt), h: midnight ? 0.75 : six ? 0.4 : 0.15,
          label: midnight ? fmtWeekdayShort(tt) : six && toX(tt) > 30 ? fmtClock(tt) : undefined,
          strong: midnight,
        });
      }
    } else {
      for (let tt = utcDayStart(s.t0) + 86400; tt < s.t1; tt += 86400) {
        const dt = new Date(tt * 1000);
        const dom = dt.getUTCDate();
        const jan1 = dom === 1 && dt.getUTCMonth() === 0;
        const monthStart = dom === 1;
        const monday = dt.getUTCDay() === 1;
        ticks.push({
          x: toX(tt),
          h: jan1 ? 1 : monthStart ? 0.85 : monday ? 0.42 : 0.18,
          label: jan1 ? String(dt.getUTCFullYear()) : monthStart ? fmtMonth(tt) : undefined,
          strong: monthStart,
        });
      }
    }
  }
  // Label the current month at the start of the day segment if no month boundary is close.
  const daySeg = segs[segs.length - 1];
  const firstDayTick = ticks.find((tk) => tk.x > daySeg.x0 + 4);
  if (firstDayTick && !firstDayTick.label) {
    const firstMonthTick = ticks.find((tk) => tk.x > daySeg.x0 && tk.strong && tk.label);
    if (!firstMonthTick || firstMonthTick.x - firstDayTick.x > 120) {
      firstDayTick.label = fmtMonth(daySeg.t0 + 86400);
      firstDayTick.h = Math.max(firstDayTick.h, 0.42);
    }
  }

  const stops = expiries.map((e) => toX(e.expiry));
  const markers: RulerMarker[] = expiries.map((e) => ({ x: toX(e.expiry), kind: e.hasMarkets ? 'live' : 'new' }));
  return { length, ticks, stops, markers, segments: segs, toX };
}

/** Budget ruler values: $1 … $1,000, denser at small amounts (log-ish). */
export const AMOUNTS: number[] = (() => {
  const out: number[] = [];
  for (let v = 1; v < 10; v += 1) out.push(v);
  for (let v = 10; v < 50; v += 5) out.push(v);
  for (let v = 50; v < 100; v += 10) out.push(v);
  for (let v = 100; v < 250; v += 10) out.push(v);
  for (let v = 250; v < 500; v += 25) out.push(v);
  for (let v = 500; v <= 1000; v += 50) out.push(v);
  return out;
})();

const MAJOR = new Set([1, 10, 25, 50, 100, 250, 500, 1000]);

export function amountModel(spacing: number): { ticks: RulerTick[]; stops: number[]; length: number } {
  const ticks: RulerTick[] = AMOUNTS.map((v) => ({
    x: Math.log(v) * spacing * 8,
    h: MAJOR.has(v) ? 0.75 : v % 50 === 0 || (v < 50 && v % 5 === 0) ? 0.32 : 0.16,
    label: MAJOR.has(v) ? (v >= 1000 ? '$1k' : `$${v}`) : undefined,
    strong: v === 100,
  }));
  return { ticks, stops: ticks.map((t) => t.x), length: Math.log(1000) * spacing * 8 };
}

export function nearestAmountIndex(v: number): number {
  let best = 0;
  for (let i = 1; i < AMOUNTS.length; i++) if (Math.abs(AMOUNTS[i] - v) < Math.abs(AMOUNTS[best] - v)) best = i;
  return best;
}
