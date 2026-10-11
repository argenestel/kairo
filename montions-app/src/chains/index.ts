/**
 * Chain registry — the only place the UI learns which venues exist.
 *
 * Holds Base, Arbitrum, Hyperliquid, Solana and Demo. Real adapters are loaded lazily so the
 * app builds even when solana.ts / base.ts / evm.ts are missing or broken. Arbitrum and
 * Hyperliquid point at the mock (badged "coming online") until `createEvmAdapter` exists.
 * Cross-chain quote comparison / best-venue routing slots in on top of this list.
 */
import type { ChainAdapter, EvmChainId } from './types';
import { createMockAdapter, type MockFlavor } from './mock';

export type ChainKey = 'base' | 'arbitrum' | 'hyperliquid' | 'solana' | 'mock';
export type ChainStatus = 'live' | 'coming-online' | 'demo';

export interface ChainEntry {
  key: ChainKey;
  label: string;
  /** "Sepolia", "Devnet", "Testnet", "Offline" */
  network: string;
  short: string;
  status: ChainStatus;
  /** CSS accent used by the picker. */
  accent: string;
  oracleName: string;
  /** EVM numeric id when this is an EVM venue. */
  evmChainId?: number;
  /** True when the venue is paused (visible but not selectable / not routable). */
  paused?: boolean;
  load: () => Promise<ChainAdapter>;
}

type AdapterModule = {
  createSolanaAdapter?: () => ChainAdapter | Promise<ChainAdapter>;
  createBaseAdapter?: () => ChainAdapter | Promise<ChainAdapter>;
  createEvmAdapter?: (id: EvmChainId) => ChainAdapter | Promise<ChainAdapter>;
};

const KEYS: ChainKey[] = ['base', 'arbitrum', 'hyperliquid', 'solana', 'mock'];

export function isChainKey(s: string | null | undefined): s is ChainKey {
  return !!s && (KEYS as string[]).includes(s);
}

export const DEFAULT_CHAIN: ChainKey = 'base';

// import.meta.glob tolerates files that don't exist yet (it simply returns no entry).
const modules = import.meta.glob<AdapterModule>(['./solana.ts', './base.ts', './evm.ts']);

async function loadReal(path: string, factory: keyof AdapterModule, label: string): Promise<ChainAdapter> {
  const loader = modules[path];
  if (!loader) throw new Error(`${label} adapter is not built yet`);
  const mod = await loader();
  const create = mod[factory];
  if (typeof create !== 'function') throw new Error(`${label} adapter does not export ${factory}()`);
  return await (create as () => ChainAdapter | Promise<ChainAdapter>)();
}

async function loadEvm(id: EvmChainId, label: string): Promise<ChainAdapter> {
  const loader = modules['./evm.ts'];
  if (!loader) throw new Error(`${label} adapter is not built yet`);
  const mod = await loader();
  if (typeof mod.createEvmAdapter !== 'function') throw new Error(`${label} adapter does not export createEvmAdapter()`);
  return await mod.createEvmAdapter(id);
}

async function loadEvmOrBase(): Promise<ChainAdapter> {
  if (modules['./evm.ts']) {
    try { return await loadEvm('base-sepolia', 'Base'); } catch { /* dedicated base adapter still ships */ }
  }
  return loadReal('./base.ts', 'createBaseAdapter', 'Base');
}

const hasEvm = './evm.ts' in modules;
const hasBase = './base.ts' in modules || hasEvm;
const hasSolana = './solana.ts' in modules;

export const CHAINS: ChainEntry[] = [
  {
    key: 'base',
    label: 'Base',
    network: 'Sepolia',
    short: 'Base',
    status: hasBase ? 'live' : 'coming-online',
    accent: '#2f6bff',
    oracleName: 'Chainlink',
    evmChainId: 84532,
    load: loadEvmOrBase,
  },
  {
    key: 'arbitrum',
    label: 'Arbitrum',
    network: 'Sepolia',
    short: 'Arb',
    status: hasEvm ? 'live' : 'coming-online',
    accent: '#28a0f0',
    oracleName: 'Chainlink',
    evmChainId: 421614,
    load: () => loadEvm('arbitrum-sepolia', 'Arbitrum'),
  },
  {
    key: 'hyperliquid',
    label: 'Hyperliquid',
    network: 'Testnet',
    short: 'HL',
    status: 'coming-online',
    paused: true,
    accent: '#50eed0',
    oracleName: 'HyperCore',
    evmChainId: 998,
    load: () => loadEvm('hyperevm-testnet', 'Hyperliquid'),
  },
  {
    key: 'solana',
    label: 'Solana',
    network: 'Devnet',
    short: 'Sol',
    status: hasSolana ? 'live' : 'coming-online',
    accent: '#9945ff',
    oracleName: 'Pyth',
    load: () => loadReal('./solana.ts', 'createSolanaAdapter', 'Solana'),
  },
  {
    key: 'mock',
    label: 'Demo',
    network: 'Offline',
    short: 'Demo',
    status: 'demo',
    accent: '#ffd23f',
    oracleName: 'Mock feed',
    load: async () => createMockAdapter('demo'),
  },
];

/** Real venues (everything except the explicit Demo entry). Used by later best-venue routing. */
export const VENUES = CHAINS.filter((c) => c.key !== 'mock');

/** Venues the UI can actually route a ticket to (paused chains like Hyperliquid are visible-only). */
export const ROUTABLE = CHAINS.filter((c) => c.key !== 'mock' && !c.paused);

export const registry: Record<ChainKey, () => Promise<ChainAdapter>> = Object.fromEntries(
  CHAINS.map((c) => [c.key, c.load]),
) as Record<ChainKey, () => Promise<ChainAdapter>>;

export function chainEntry(key: ChainKey): ChainEntry {
  return CHAINS.find((c) => c.key === key) ?? CHAINS[0];
}

export function flavorFor(key: ChainKey): MockFlavor {
  return key === 'mock' ? 'demo' : key;
}

export function fallbackFor(key: ChainKey): ChainAdapter {
  return createMockAdapter(flavorFor(key));
}

export function hasRealAdapter(key: ChainKey): boolean {
  return chainEntry(key).status === 'live';
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
