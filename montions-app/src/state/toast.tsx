import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'ok' | 'error' | 'info' | 'wait';

export interface Toast {
  id: number;
  text: string;
  tone?: ToastTone;
  href?: string;
  hrefLabel?: string;
  sticky?: boolean;
}

export interface ToastApi {
  (t: Omit<Toast, 'id'>): number;
  update(id: number, patch: Partial<Omit<Toast, 'id'>>): void;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastApi>(Object.assign(() => 0, { update() {}, dismiss() {} }));

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback((id: number, tone: ToastTone | undefined, sticky?: boolean) => {
    const prev = timers.current.get(id);
    if (prev) { clearTimeout(prev); timers.current.delete(id); }
    if (sticky) return;
    const ms = tone === 'error' ? 7000 : tone === 'wait' ? 12000 : 4500;
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++idRef.current;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    schedule(id, t.tone, t.sticky);
    return id;
  }, [schedule]);

  const update = useCallback((id: number, patch: Partial<Omit<Toast, 'id'>>) => {
    setItems((xs) => {
      const next = xs.map((x) => (x.id === id ? { ...x, ...patch } : x));
      const hit = next.find((x) => x.id === id);
      if (hit) schedule(id, hit.tone, hit.sticky);
      return next;
    });
  }, [schedule]);

  const api = useMemo<ToastApi>(() => Object.assign(push, { update, dismiss }), [push, update, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone ?? 'info'}`}>
            <span className="toast__dot" aria-hidden />
            <span>{t.text}</span>
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="toast__link">{t.hrefLabel ?? 'View'}</a>
            )}
            {t.sticky && (
              <button type="button" className="toast__x" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
