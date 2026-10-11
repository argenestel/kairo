/**
 * Vertical 3D drum picker. Items sit on a cylinder; a fixed "lens" marks the selection.
 * Drag with inertia + snap, mouse wheel / trackpad, arrow keys, PageUp/Down, Home/End, type-to-search.
 * Per-frame work touches only transforms/opacity of visible items (no React renders while animating).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { haptic, useReducedMotion } from '../lib/hooks';

export interface WheelProps<T> {
  items: T[];
  index: number;
  onChange: (i: number) => void;
  itemKey: (t: T) => string;
  itemLabel: (t: T) => string;
  renderItem: (t: T, i: number) => ReactNode;
  /** Vertical distance between items at the lens, px. */
  spacing: number;
  /** Degrees between items on the drum. */
  angleStep?: number;
  /** Items rendered on each side of the selection. */
  range?: number;
  /** Fade per item of distance. */
  fade?: number;
  height: number;
  ariaLabel: string;
  role?: 'listbox' | 'slider';
  valueText?: (i: number) => string;
  searchable?: boolean;
  lens?: ReactNode;
  lensHeight?: number;
  /** Extra decoration (e.g. curved indicator) receiving the live position. */
  className?: string;
  autoFocus?: boolean;
  onPos?: (pos: number) => void;
}

export function Wheel<T>(p: WheelProps<T>) {
  const { items, index, onChange, spacing, height } = p;
  const angleStep = p.angleStep ?? 22;
  const range = p.range ?? 3;
  const fade = p.fade ?? 0.3;
  const reduced = useReducedMotion();
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lensRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const n = items.length;

  const st = useRef({
    pos: index, target: index, dragging: false, startY: 0, startPos: 0, moved: 0,
    samples: [] as { t: number; pos: number }[], raf: 0, last: 0, emitted: index, wheelTimer: 0 as unknown as ReturnType<typeof setTimeout>,
  });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPosRef = useRef(p.onPos);
  onPosRef.current = p.onPos;
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const R = spacing / (2 * Math.sin((angleStep * Math.PI) / 360));

  const apply = useCallback(() => {
    const s = st.current;
    const els = itemRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const d = i - s.pos;
      const ad = Math.abs(d);
      if (ad > range + 0.6) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      const th = Math.max(-80, Math.min(80, d * angleStep));
      const rad = (th * Math.PI) / 180;
      const y = R * Math.sin(rad);
      const z = R * (Math.cos(rad) - 1);
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${(-th).toFixed(2)}deg)`;
      el.style.opacity = String(Math.max(0, 1 - ad * fade).toFixed(3));
      el.style.setProperty('--ad', Math.min(1, ad).toFixed(3));
      el.style.zIndex = String(100 - Math.round(ad * 10));
    }
    onPosRef.current?.(s.pos);
  }, [R, angleStep, fade, range]);

  const emit = useCallback((i: number) => {
    const s = st.current;
    if (i === s.emitted) return;
    s.emitted = i;
    haptic(3);
    const lens = lensRef.current;
    if (lens && !reduced) lens.animate([{ transform: 'scale(1.015)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    onChangeRef.current(i);
  }, [reduced]);

  const loop = useCallback((ts: number) => {
    const s = st.current;
    const dt = s.last ? Math.min(0.05, (ts - s.last) / 1000) : 0.016;
    s.last = ts;
    if (!s.dragging) {
      const k = reduced ? 1 : 1 - Math.exp(-dt * 16);
      s.pos += (s.target - s.pos) * k;
      if (Math.abs(s.target - s.pos) < 0.002) s.pos = s.target;
    }
    apply();
    if (s.dragging || s.pos !== s.target) s.raf = requestAnimationFrame(loop);
    else { s.raf = 0; s.last = 0; }
  }, [apply, reduced]);

  const kick = useCallback(() => {
    const s = st.current;
    if (!s.raf) s.raf = requestAnimationFrame(loop);
  }, [loop]);

  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));

  const goTo = useCallback((i: number) => {
    const s = st.current;
    const c = Math.max(0, Math.min(n - 1, Math.round(i)));
    s.target = c;
    emit(c);
    kick();
  }, [emit, kick, n]);

  // external index changes
  useLayoutEffect(() => {
    const s = st.current;
    if (s.dragging) return;
    if (index === s.emitted) return; // echo of our own emission
    {
      s.emitted = index;
      s.target = index;
      if (Math.abs(s.pos - index) > range + 2) s.pos = index + Math.sign(s.pos - index) * (range + 1);
      kick();
    }
  }, [index, kick, range]);

  useLayoutEffect(() => { apply(); }, [apply, n]);
  useEffect(() => {
    if (p.autoFocus) rootRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);

  // wheel (non-passive so we can prevent page scroll)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = st.current;
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
      const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const delta = Math.max(-1, Math.min(1, (dy * unit) / 90));
      s.target = Math.max(-0.35, Math.min(n - 1 + 0.35, s.target + delta));
      emit(clamp(Math.round(s.target)));
      kick();
      clearTimeout(s.wheelTimer);
      s.wheelTimer = setTimeout(() => {
        s.target = clamp(Math.round(s.target));
        emit(s.target);
        kick();
      }, 130);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, emit, kick]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const s = st.current;
    s.dragging = true;
    s.startY = e.clientY;
    s.startPos = s.pos;
    s.moved = 0;
    s.samples = [{ t: performance.now(), pos: s.pos }];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    kick();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = st.current;
    if (!s.dragging) return;
    const dy = e.clientY - s.startY;
    s.moved = Math.max(s.moved, Math.abs(dy));
    let pos = s.startPos - dy / spacing;
    if (pos < 0) pos = pos * 0.35;
    if (pos > n - 1) pos = n - 1 + (pos - (n - 1)) * 0.35;
    s.pos = pos;
    const now = performance.now();
    s.samples.push({ t: now, pos });
    while (s.samples.length > 2 && now - s.samples[0].t > 90) s.samples.shift();
    emit(clamp(Math.round(pos)));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = st.current;
    if (!s.dragging) return;
    s.dragging = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (s.moved < 5) {
      // tap: select the item under the pointer
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-wheel-i]') as HTMLElement | null;
      const i = hit ? Number(hit.dataset.wheelI) : NaN;
      s.target = clamp(Number.isFinite(i) ? i : Math.round(s.pos));
    } else {
      const a = s.samples[0];
      const b = s.samples[s.samples.length - 1];
      const v = b && a && b.t > a.t ? (b.pos - a.pos) / ((b.t - a.t) / 1000) : 0;
      s.target = clamp(Math.round(s.pos + v * 0.18));
    }
    emit(s.target);
    kick();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = st.current;
    const cur = clamp(Math.round(s.target));
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp': case 'ArrowLeft': next = cur - 1; break;
      case 'ArrowDown': case 'ArrowRight': next = cur + 1; break;
      case 'PageUp': next = cur - 5; break;
      case 'PageDown': next = cur + 5; break;
      case 'Home': next = 0; break;
      case 'End': next = n - 1; break;
    }
    if (next != null) {
      e.preventDefault();
      goTo(next);
      return;
    }
    if (!p.searchable) return;
    if (e.key === 'Backspace' && search) {
      e.preventDefault();
      e.stopPropagation();
      updateSearch(search.slice(0, -1));
      return;
    }
    if (e.key === 'Escape' && search) {
      e.preventDefault();
      e.stopPropagation();
      updateSearch('');
      return;
    }
    if (e.key.length === 1 && /[a-z ]/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      updateSearch(search + e.key);
    }
  };

  function updateSearch(q: string) {
    setSearch(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) return;
    const needle = q.trim().toLowerCase();
    const scored = items.map((it, i) => {
      const label = p.itemLabel(it).toLowerCase();
      const key = p.itemKey(it).toLowerCase();
      const score = key === needle ? 0 : key.startsWith(needle) ? 1 : label.startsWith(needle) ? 2 : label.includes(needle) ? 3 : 9;
      return { i, score };
    }).filter((x) => x.score < 9).sort((a, b) => a.score - b.score);
    if (scored.length) goTo(scored[0].i);
    searchTimer.current = setTimeout(() => setSearch(''), 1400);
  }

  const activeId = `${id}-opt-${index}`;
  const isSlider = p.role === 'slider';

  return (
    <div
      ref={rootRef}
      className={`wheel ${p.className ?? ''}`}
      style={{ height, ['--spacing' as string]: `${spacing}px` }}
      tabIndex={0}
      role={isSlider ? 'slider' : 'listbox'}
      aria-label={p.ariaLabel}
      aria-activedescendant={isSlider ? undefined : activeId}
      aria-valuemin={isSlider ? 0 : undefined}
      aria-valuemax={isSlider ? n - 1 : undefined}
      aria-valuenow={isSlider ? index : undefined}
      aria-valuetext={isSlider ? p.valueText?.(index) : undefined}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {p.lens && <div ref={lensRef} className="wheel__lens" style={{ height: p.lensHeight ?? spacing }}>{p.lens}</div>}
      <div className="wheel__drum">
        {items.map((it, i) => (
          <div
            key={p.itemKey(it)}
            ref={(el) => { itemRefs.current[i] = el; }}
            id={`${id}-opt-${i}`}
            role={isSlider ? undefined : 'option'}
            aria-selected={isSlider ? undefined : i === index}
            className={`wheel__item${i === index ? ' is-active' : ''}`}
            data-wheel-i={i}
            style={{ height: spacing, marginTop: -spacing / 2 }}
          >
            {p.renderItem(it, i)}
          </div>
        ))}
      </div>
      {p.searchable && search && (
        <div className="wheel__search" aria-live="polite">
          <span>Search</span> <b>{search}</b>
        </div>
      )}
    </div>
  );
}
