/**
 * Visual mode. `data-mode` on <html> drives the token layer in styles/tokens.css.
 * Persist via ?mode= and localStorage. The header toggle + uwu copy/mascots come later;
 * this provider is the only thing components should read.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ModeId = 'serious' | 'uwu';

const LS = 'montions.mode';

export function isModeId(s: string | null | undefined): s is ModeId {
  return s === 'serious' || s === 'uwu';
}

export function initialMode(): ModeId {
  try {
    const q = new URLSearchParams(location.search).get('mode');
    if (isModeId(q)) return q;
    const s = localStorage.getItem(LS);
    if (isModeId(s)) return s;
  } catch { /* ignore */ }
  return 'serious';
}

function persistMode(mode: ModeId) {
  try {
    const url = new URL(location.href);
    if (mode === 'serious') url.searchParams.delete('mode');
    else url.searchParams.set('mode', mode);
    history.replaceState(history.state, '', url);
    localStorage.setItem(LS, mode);
  } catch { /* ignore */ }
}

function applyMode(mode: ModeId) {
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.style.colorScheme = mode === 'uwu' ? 'light' : 'dark';
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute('content', bg);
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', mode === 'uwu' ? 'light' : 'dark');
}

export interface ModeApi {
  mode: ModeId;
  setMode: (m: ModeId) => void;
}

const Ctx = createContext<ModeApi>({ mode: 'serious', setMode: () => {} });

export function useMode(): ModeApi {
  return useContext(Ctx);
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ModeId>(initialMode);

  useEffect(() => {
    applyMode(mode);
    persistMode(mode);
  }, [mode]);

  const setMode = useCallback((m: ModeId) => setModeState(m), []);
  const value = useMemo<ModeApi>(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
