import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Close } from './Icons';

/** Modal sheet: centred card on desktop, bottom sheet on mobile; `side` = right drawer on desktop. */
export function Sheet({ open, onClose, title, children, side = false, labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; side?: boolean; labelledBy?: string;
}) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ref = useRef<HTMLDivElement | null>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], button:not([disabled]), a[href], input');
      el?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex="0"]')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      prevFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const node = (
    <div className={`sheet-backdrop${side ? ' sheet-backdrop--side' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`sheet glass${side ? ' sheet--side' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}>
        <div className="sheet__head">
          <h2 id={labelledBy ?? titleId} className="sheet__title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Close size={16} /></button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
