import { createMockAdapter } from '../chains/mock';
import type { ChainAdapter, EventInfo, EventQuote, Outcome } from '../chains/types';

let demo: ChainAdapter | null = null;

export function getDemoEventsAdapter(): ChainAdapter {
  return (demo ??= createMockAdapter('demo'));
}

/** Prefer the live adapter when it implements listEvents; otherwise the mock demo events. */
export function eventSource(adapter: ChainAdapter | null): { adapter: ChainAdapter; demo: boolean } {
  if (adapter && typeof adapter.listEvents === 'function') {
    return { adapter, demo: adapter.meta.id === 'mock' };
  }
  return { adapter: getDemoEventsAdapter(), demo: true };
}

export async function ensureConnected(adapter: ChainAdapter): Promise<string> {
  const existing = adapter.address();
  if (existing) return existing;
  return adapter.connect();
}

export function yesAsk(e: EventInfo): number | undefined {
  return e.bestAsk ?? e.lastPrice;
}

export function noAsk(e: EventInfo): number | undefined {
  if (e.bestBid != null) return Math.max(0.01, Math.min(0.99, 1 - e.bestBid));
  if (e.lastPrice != null) return Math.max(0.01, Math.min(0.99, 1 - e.lastPrice));
  return undefined;
}

export type { EventInfo, EventQuote, Outcome };
