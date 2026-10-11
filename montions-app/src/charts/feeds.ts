/** Oracle feed registry for charts — deployments + Solana Pyth accounts + KeeperFeed hub. */
import type { Address } from 'viem';
import type { ChainKey } from '../chains';
import type { AssetCategory } from '../chains/types';
import baseDep from '@montions/base-deployments/84532.json';
import arbDep from '@montions/base-deployments/421614.json';
import solCfg from '@montions/sol-config/assets.devnet.json';

export type FeedKind = 'chainlink' | 'keeper' | 'pyth' | 'synthetic';

export interface EvmFeed {
  kind: 'chainlink' | 'keeper';
  chainId: number;
  rpc: string;
  rpcs: string[];
  address: Address;
  decimals: number;
  symbol: string;
}

export interface PythFeed {
  kind: 'pyth';
  rpc: string;
  priceAccount: string;
  symbol: string;
}

interface DepAsset { symbol: string; feed?: string; decimals?: number; oracle?: string }
interface DepFile {
  chainId: number;
  rpc?: string;
  contracts?: { keeperFeedHub?: string };
  assets?: DepAsset[];
}

const MC3 = '0xca11bde05977b3631167028862be2a173976ca11' as Address;

const RPC: Record<number, string[]> = {
  84532: [
    (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_BASE_RPC) || '',
    (baseDep as DepFile).rpc || '',
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com',
  ].filter(Boolean),
  421614: [
    (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_ARB_RPC) || '',
    'https://arbitrum-sepolia-rpc.publicnode.com',
    (arbDep as DepFile).rpc || '',
    'https://sepolia-rollup.arbitrum.io/rpc',
  ].filter(Boolean),
};

const SOL_RPC =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_SOLANA_RPC) ||
  'https://api.devnet.solana.com';

function mapDep(dep: DepFile, extraRpcs: string[]): Map<string, EvmFeed> {
  const out = new Map<string, EvmFeed>();
  const rpcs = RPC[dep.chainId] ?? extraRpcs;
  for (const a of dep.assets ?? []) {
    if (!a.feed || !a.feed.startsWith('0x')) continue;
    const kind: EvmFeed['kind'] = a.oracle === 'keeper' || /keeper/i.test(a.oracle ?? '') ? 'keeper' : 'chainlink';
    out.set(a.symbol.toUpperCase(), {
      kind,
      chainId: dep.chainId,
      rpc: rpcs[0]!,
      rpcs,
      address: a.feed as Address,
      decimals: a.decimals ?? 8,
      symbol: a.symbol.toUpperCase(),
    });
  }
  return out;
}

const BASE_FEEDS = mapDep(baseDep as DepFile, RPC[84532]!);
const ARB_FEEDS = mapDep(arbDep as DepFile, RPC[421614]!);

const PYTH: Record<string, string> = Object.fromEntries(
  ((solCfg as { assets?: { symbol: string; priceAccount: string }[] }).assets ?? []).map((a) => [
    a.symbol.toUpperCase(),
    a.priceAccount,
  ]),
);

export const KEEPER_HUB: Partial<Record<ChainKey, Address>> = {
  base: ((baseDep as DepFile).contracts?.keeperFeedHub as Address | undefined) ?? undefined,
};

export const MULTICALL3 = MC3;

export function evmRpcs(chainId: number): string[] {
  return RPC[chainId] ?? [];
}

export function evmFeed(chain: ChainKey, symbol: string): EvmFeed | null {
  const s = symbol.toUpperCase();
  if (chain === 'base') return BASE_FEEDS.get(s) ?? null;
  if (chain === 'arbitrum') return ARB_FEEDS.get(s) ?? null;
  return null;
}

export function pythFeed(symbol: string): PythFeed | null {
  const account = PYTH[symbol.toUpperCase()];
  if (!account) return null;
  return { kind: 'pyth', rpc: SOL_RPC, priceAccount: account, symbol: symbol.toUpperCase() };
}

export function lookbackSec(category?: AssetCategory | string): number {
  if (category === 'stock' || category === 'etf' || category === 'commodity') return 5 * 86400;
  return 24 * 3600;
}

export function keeperHub(chain: ChainKey): Address | null {
  return KEEPER_HUB[chain] ?? null;
}

export function chainIdOf(chain: ChainKey): number | null {
  if (chain === 'base') return 84532;
  if (chain === 'arbitrum') return 421614;
  return null;
}
