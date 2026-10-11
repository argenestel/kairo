/**
 * Horizontal ruler/timeline with a fixed centre playhead. Canvas-drawn ticks on a gentle curve,
 * labels, and optional markers (icons) under selectable stops. Drag with inertia, wheel/trackpad,
 * arrow keys (prev/next stop), PageUp/Down, Home/End. ARIA: role="slider".
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { haptic, useReducedMotion } from '../lib/hooks';

export interface RulerTick { x: number; h: number; label?: string; strong?: boolean; dim?: boolean }
export interface RulerMarker { x: number; kind: 'live' | 'new'; }

export interface RulerProps {
  length: number;
  ticks: RulerTick[];
  stops: number[];
  index: number;
  onChange: (i: number) => void;
  markers?: RulerMarker[];
  height?: number;
  /** Upward bend at the edges, px. */
  curve?: number;
  ariaLabel: string;
  valueText: (i: number) => string;
  pageStep?: number;
  /** Rendered under the playhead (e.g. "Weekly expiry"). */
  playheadLabel?: ReactNode;
  className?: string;
  autoFocus?: boolean;
}

function tickRgb(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ruler-tick').trim();
  return v || '220,228,240';
}
function markerRgb(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ruler-marker').trim();
  return v || '190,205,230';
}

export function Ruler(p: RulerProps) {
  const { stops, index, onChange } = p;
  const height = p.height ?? 120;
  const curve = p.curve ?? 26;
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef(p);
  dataRef.current = p;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const st = useRef({
    scroll: stops[index] ?? 0, target: stops[index] ?? 0, dragging: false, startX: 0, startScroll: 0, moved: 0,
    samples: [] as { t: number; x: number }[], raf: 0, last: 0, emitted: index, w: 0, h: 0, dpr: 1,
    wheelTimer: 0 as unknown as ReturnType<typeof setTimeout>, wheeling: false,
  });

  const nearest = useCallback((x: number) => {
    const s = dataRef.current.stops;
    if (!s.length) return 0;
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= x) lo = mid; else hi = mid;
    }
    return Math.abs(s[lo] - x) <= Math.abs(s[hi] - x) ? lo : hi;
  }, []);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const { w, h, dpr, scroll } = st.current;
    const d = dataRef.current;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const baseY = h * 0.62;
    const maxTick = Math.min(30, h * 0.26);
    const half = Math.max(1, w / 2);
    const yAt = (sx: number) => {
      const u = (sx - cx) / half;
      return baseY - curve * u * u;
    };
    const edgeAlpha = (sx: number) => {
      const u = Math.abs((sx - cx) / half);
      return Math.max(0, 1 - Math.pow(u, 2.6));
    };
    g.lineCap = 'round';
    g.textAlign = 'center';
    // ticks
    for (const t of d.ticks) {
      const sx = cx + (t.x - scroll);
      if (sx < -30 || sx > w + 30) continue;
      const a = edgeAlpha(sx);
      if (a <= 0.01) continue;
      const y = yAt(sx);
      const u = (sx - cx) / half;
      const tilt = Math.atan((2 * curve * u) / half);
      const len = 6 + t.h * maxTick;
      const near = Math.max(0, 1 - Math.abs(sx - cx) / 90);
      const alpha = (t.dim ? 0.28 : 0.42 + t.h * 0.35 + near * 0.25) * a;
      g.strokeStyle = `rgba(${tickRgb()},${alpha.toFixed(3)})`;
      g.lineWidth = t.h > 0.6 ? 1.6 : 1.2;
      g.beginPath();
      g.moveTo(sx, y);
      g.lineTo(sx + Math.sin(tilt) * len, y - Math.cos(tilt) * len);
      g.stroke();
      if (t.label) {
        g.font = `${t.strong ? 600 : 500} ${t.strong ? 12.5 : 12}px Geist, ui-sans-serif, system-ui, sans-serif`;
        g.fillStyle = `rgba(${tickRgb()},${((t.strong ? 0.92 : 0.7) * a).toFixed(3)})`;
        g.fillText(t.label, sx + Math.sin(tilt) * (len + 12), y - Math.cos(tilt) * (len + 10));
      }
    }
    // markers
    if (d.markers) {
      for (const m of d.markers) {
        const sx = cx + (m.x - scroll);
        if (sx < -20 || sx > w + 20) continue;
        const a = edgeAlpha(sx);
        if (a <= 0.02) continue;
        const y = yAt(sx) + 16;
        const atHead = Math.abs(sx - cx) < 3;
        if (atHead) continue; // the DOM playhead badge covers it
        g.globalAlpha = a * (m.kind === 'live' ? 0.85 : 0.55);
        if (m.kind === 'live') {
          g.fillStyle = `rgba(${markerRgb()},0.9)`;
          g.beginPath();
          g.moveTo(sx, y - 4); g.lineTo(sx + 4, y); g.lineTo(sx, y + 4); g.lineTo(sx - 4, y); g.closePath();
          g.fill();
        } else {
          g.strokeStyle = `rgba(${markerRgb()},0.9)`;
          g.lineWidth = 1.1;
          g.beginPath();
          g.moveTo(sx, y - 3.5); g.lineTo(sx + 3.5, y); g.lineTo(sx, y + 3.5); g.lineTo(sx - 3.5, y); g.closePath();
          g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
  }, [curve]);

  const emit = useCallback((i: number) => {
    const s = st.current;
    if (i === s.emitted) return;
    s.emitted = i;
    haptic(3);
    onChangeRef.current(i);
  }, []);

  const loop = useCallback((ts: number) => {
    const s = st.current;
    const dt = s.last ? Math.min(0.05, (ts - s.last) / 1000) : 0.016;
    s.last = ts;
    if (!s.dragging) {
      const k = reduced ? 1 : 1 - Math.exp(-dt * 13);
      s.scroll += (s.target - s.scroll) * k;
      if (Math.abs(s.target - s.scroll) < 0.25) s.scroll = s.target;
    }
    draw();
    if (s.dragging || s.scroll !== s.target) s.raf = requestAnimationFrame(loop);
    else { s.raf = 0; s.last = 0; }
  }, [draw, reduced]);

  const kick = useCallback(() => {
    const s = st.current;
    if (!s.raf) s.raf = requestAnimationFrame(loop);
  }, [loop]);

  const goTo = useCallback((i: number) => {
    const s = st.current;
    const st0 = dataRef.current.stops;
    if (!st0.length) return;
    const c = Math.max(0, Math.min(st0.length - 1, i));
    s.target = st0[c];
    emit(c);
    kick();
  }, [emit, kick]);

  // size
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return;
    const resize = () => {
      const s = st.current;
      s.w = wrap.clientWidth;
      s.h = height;
      s.dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(s.w * s.dpr);
      c.height = Math.round(s.h * s.dpr);
      c.style.width = `${s.w}px`;
      c.style.height = `${s.h}px`;
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    document.fonts?.ready.then(() => draw()).catch(() => {});
    return () => ro.disconnect();
  }, [height, draw]);

  // external index / model changes
  useLayoutEffect(() => {
    const s = st.current;
    if (s.dragging || s.wheeling) return;
    const x = stops[index];
    if (x === undefined) return;
    s.emitted = index;
    if (Math.abs(s.target - x) > 0.5) {
      s.target = x;
      if (Math.abs(s.scroll - x) > 4000) s.scroll = x + Math.sign(s.scroll - x) * 600;
      kick();
    } else draw();
  }, [index, stops, kick, draw]);

  useEffect(() => { draw(); }, [p.ticks, p.markers, draw]);
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);
  useEffect(() => {
    if (p.autoFocus) wrapRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = st.current;
      const st0 = dataRef.current.stops;
      if (!st0.length) return;
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const delta = Math.max(-60, Math.min(60, raw * unit * 0.6));
      const lo = st0[0] - 30;
      const hi = st0[st0.length - 1] + 30;
      s.target = Math.max(lo, Math.min(hi, s.target + delta));
      s.wheeling = true;
      emit(nearest(s.target));
      kick();
      clearTimeout(s.wheelTimer);
      s.wheelTimer = setTimeout(() => {
        s.wheeling = false;
        const i = nearest(s.target);
        s.target = st0[i];
        emit(i);
        kick();
      }, 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [emit, kick, nearest]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const s = st.current;
    s.dragging = true;
    s.startX = e.clientX;
    s.startScroll = s.scroll;
    s.moved = 0;
    s.samples = [{ t: performance.now(), x: s.scroll }];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    kick();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = st.current;
    if (!s.dragging) return;
    const st0 = dataRef.current.stops;
    const dx = e.clientX - s.startX;
    s.moved = Math.max(s.moved, Math.abs(dx));
    let x = s.startScroll - dx;
    const lo = st0[0] ?? 0;
    const hi = st0[st0.length - 1] ?? 0;
    if (x < lo) x = lo - (lo - x) * 0.35;
    if (x > hi) x = hi + (x - hi) * 0.35;
    s.scroll = x;
    const now = performance.now();
    s.samples.push({ t: now, x });
    while (s.samples.length > 2 && now - s.samples[0].t > 90) s.samples.shift();
    emit(nearest(x));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = st.current;
    if (!s.dragging) return;
    s.dragging = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const st0 = dataRef.current.stops;
    let i: number;
    if (s.moved < 5) {
      // tap: jump towards the tapped position
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      i = nearest(s.scroll + (e.clientX - rect.left - rect.width / 2));
    } else {
      const a = s.samples[0];
      const b = s.samples[s.samples.length - 1];
      const v = b && a && b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0;
      i = nearest(s.scroll + v * 0.22);
    }
    s.target = st0[i] ?? s.scroll;
    emit(i);
    kick();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = st.current.emitted;
    const page = p.pageStep ?? 5;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': next = cur - 1; break;
      case 'ArrowRight': case 'ArrowUp': next = cur + 1; break;
      case 'PageUp': next = cur + page; break;
      case 'PageDown': next = cur - page; break;
      case 'Home': next = 0; break;
      case 'End': next = stops.length - 1; break;
    }
    if (next != null) {
      e.preventDefault();
      goTo(next);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`ruler ${p.className ?? ''}`}
      style={{ height }}
      tabIndex={0}
      role="slider"
      aria-label={p.ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, stops.length - 1)}
      aria-valuenow={index}
      aria-valuetext={p.valueText(index)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="ruler__canvas" aria-hidden />
      <div className="ruler__playhead" style={{ top: height * 0.62 - Math.min(30, height * 0.26) - 14, height: Math.min(30, height * 0.26) + 22 }} aria-hidden />
      {p.playheadLabel && <div className="ruler__label" style={{ top: height * 0.62 + 10 }}>{p.playheadLabel}</div>}
    </div>
  );
}
