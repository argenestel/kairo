/**
 * The whole ticket flow as one reducer: steps, the sentence draft, and the ticket lifecycle.
 *   asset → direction → strike → expiry → amount → ticket(printing → ready → signing → placed | error)
 */
import type { BuyResult, Direction } from '../chains/types';
import type { ChainKey } from '../chains';

export const STEPS = ['asset', 'direction', 'strike', 'expiry', 'amount', 'ticket'] as const;
export type StepId = (typeof STEPS)[number];
export const S = { asset: 0, direction: 1, strike: 2, expiry: 3, amount: 4, ticket: 5 } as const;

export interface Draft {
  symbol: string | null;
  direction: Direction;
  strike: number | null;
  expiry: number | null;
  budget: number;
}

export type TicketPhase = 'printing' | 'ready' | 'signing' | 'placed' | 'error';

export interface TicketState {
  phase: TicketPhase;
  result?: BuyResult;
  error?: string;
  /** Set while signing: what the wallet is doing ("Confirm in your wallet…"). */
  note?: string;
}

export interface FlowState {
  step: number;
  /** Highest step the user has visited (controls which sentence pills are filled). */
  reached: number;
  /** +1 forward, -1 back (drives the slide direction). */
  nav: 1 | -1;
  draft: Draft;
  /** Strike/expiry were picked by the user (not just defaulted). */
  touched: { strike: boolean; expiry: boolean; budget: boolean };
  ticket: TicketState;
}

export type FlowAction =
  | { type: 'set'; patch: Partial<Draft>; user?: boolean }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; step: number }
  | { type: 'ticket'; patch: Partial<TicketState> }
  | { type: 'chainChanged' }
  | { type: 'reset'; keepSymbol?: boolean };

export const DEFAULT_BUDGET = 100;

export function initialFlow(): FlowState {
  const shared = parseShare();
  if (shared) {
    return {
      step: S.ticket, reached: S.ticket, nav: 1, draft: shared,
      touched: { strike: true, expiry: true, budget: true }, ticket: { phase: 'printing' },
    };
  }
  return {
    step: 0, reached: 0, nav: 1,
    draft: { symbol: null, direction: 'above', strike: null, expiry: null, budget: DEFAULT_BUDGET },
    touched: { strike: false, expiry: false, budget: false },
    ticket: { phase: 'printing' },
  };
}

export function canContinue(s: FlowState, assetsReady: boolean): boolean {
  const d = s.draft;
  switch (s.step) {
    case S.asset: return assetsReady && !!d.symbol;
    case S.direction: return !!d.direction;
    case S.strike: return d.strike != null;
    case S.expiry: return d.expiry != null;
    case S.amount: return d.budget >= 1 && d.strike != null && d.expiry != null;
    default: return false;
  }
}

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  if (s.ticket.phase === 'signing' && a.type !== 'ticket') return s;
  switch (a.type) {
    case 'set': {
      const prev = s.draft;
      const draft = { ...prev, ...a.patch };
      if (a.patch.budget !== undefined) draft.budget = Number.isFinite(a.patch.budget) ? Math.max(1, Math.min(1000, a.patch.budget)) : prev.budget;
      const touched = { ...s.touched };
      if (a.patch.symbol !== undefined && a.patch.symbol !== prev.symbol) {
        draft.strike = null;
        draft.expiry = null;
        touched.strike = false;
        touched.expiry = false;
      }
      if (a.patch.direction !== undefined && a.patch.direction !== prev.direction && !touched.strike) draft.strike = null;
      if (a.user) {
        if (a.patch.strike !== undefined) touched.strike = true;
        if (a.patch.expiry !== undefined) touched.expiry = true;
        if (a.patch.budget !== undefined) touched.budget = true;
      }
      return { ...s, draft, touched };
    }
    case 'next': {
      if (s.step >= S.ticket) return s;
      const step = s.step + 1;
      return {
        ...s, step, nav: 1, reached: Math.max(s.reached, step),
        ticket: step === S.ticket ? { phase: 'printing' } : s.ticket,
      };
    }
    case 'back': {
      if (s.step <= 0) return s;
      if (s.step === S.ticket && s.ticket.phase === 'signing') return s;
      return { ...s, step: s.step - 1, nav: -1, ticket: { phase: 'printing' } };
    }
    case 'goto': {
      if (a.step === s.step || a.step < 0 || a.step > s.reached) return s;
      if (s.step === S.ticket && s.ticket.phase === 'signing') return s;
      return { ...s, step: a.step, nav: a.step > s.step ? 1 : -1, ticket: a.step === S.ticket ? { phase: 'printing' } : { phase: 'printing' } };
    }
    case 'ticket':
      return { ...s, ticket: { ...s.ticket, ...a.patch } };
    case 'chainChanged': {
      // Strike grids and expiries differ per chain: keep the idea, re-pick the numbers.
      const step = Math.min(s.step, S.strike);
      return {
        ...s, step, reached: Math.min(s.reached, S.strike), nav: -1,
        draft: { ...s.draft, strike: null, expiry: null },
        touched: { strike: false, expiry: false, budget: s.touched.budget },
        ticket: { phase: 'printing' },
      };
    }
    case 'reset': {
      const init = initialFlow();
      return {
        ...init, step: 0, reached: 0, nav: -1,
        draft: { ...init.draft, symbol: a.keepSymbol ? s.draft.symbol : null, budget: s.draft.budget },
        ticket: { phase: 'printing' },
      };
    }
  }
}

// ── share links ─────────────────────────────────────────────────────────

export function shareUrl(chain: ChainKey, d: Draft, mode?: string): string {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('chain', chain);
  if (mode && mode !== 'serious') url.searchParams.set('mode', mode);
  if (d.symbol && d.strike != null && d.expiry != null) {
    url.searchParams.set('t', [d.symbol, d.direction === 'above' ? 'a' : 'b', d.strike, d.expiry, d.budget].join('~'));
  }
  return url.toString();
}

function parseShare(): Draft | null {
  try {
    const t = new URLSearchParams(location.search).get('t');
    if (!t) return null;
    const [symbol, dir, k, e, b] = t.split('~');
    const strike = Number(k);
    const expiry = Number(e);
    const budget = Number(b);
    if (!symbol || !(strike > 0) || !(expiry > Date.now() / 1000) || !(budget >= 1)) return null;
    return { symbol: symbol.toUpperCase(), direction: dir === 'b' ? 'below' : 'above', strike, expiry, budget: Math.min(1000, budget) };
  } catch {
    return null;
  }
}

export function clearShareParam() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('t')) return;
    url.searchParams.delete('t');
    history.replaceState(history.state, '', url);
  } catch { /* ignore */ }
}
