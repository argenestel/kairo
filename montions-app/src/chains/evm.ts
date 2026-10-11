/**
 * Shared EVM ChainAdapter for Base Sepolia (Chainlink), Arbitrum Sepolia (Chainlink) and
 * HyperEVM testnet (HyperCore oraclePx precompile). One wallet layer (EIP-6963 + burner) is
 * shared across all three; the burner key is the same on every EVM chain and we switch/add
 * the chain on demand.
 *
 * chains.json + deployments/<chainId>.json are loaded lazily. A chain without a manifest still
 * constructs, serves live oracle prices, and fails trading with "Not deployed on <chain> yet".
 * Hyperliquid is paused for deploy: prices only until a 998 manifest exists.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  getAddress,
  hexToBigInt,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseSignature,
  stringToHex,
  type Account,
  type Address,
  type Hash,
  type Hex,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  MontionsClient,
  TICKS,
  TICK_UNIT,
  UNIT,
  chainById,
  chainForId,
  chainlinkAggregatorAbi,
  chainlinkOracleAbi,
  chainlinkSettlementResolverAbi,
  encodeDepositWithPermit,
  encodePlaceOrder,
  erc20Abi,
  montionsBookAbi,
  parseChainsConfig,
  parseDeployment,
  parseUsdc,
  priceOracleAbi,
  type ChainAssetConfig,
  type Deployment,
  type PlaceOrderParams,
  type QuoterSnapshot,
} from '@montions/base-sdk';
import { probAbove } from '../lib/model';
import type { AssetCategory,
  AssetInfo,
  Balances,
  BookLevel,
  BuyParams,
  BuyResult,
  ChainAdapter,
  ChainMeta,
  Direction,
  EventCategory,
  EventInfo,
  EventQuote,
  ExpiryOption,
  MarketInfo,
  Outcome,
  Position,
  Quote,
  TxResult,
  WalletOption,
  EvmChainId,
} from './types';

// ───────────────────────────── options / constants ─────────────────────────────

export interface EvmAdapterOptions {
  /** HTTP RPC (default: per-chain VITE_*_RPC or the chains.json RPC). */
  rpcUrl?: string;
  /** Extra RPCs used as viem fallbacks. */
  rpcs?: string[];
  /** localStorage key of the burner private key (shared across EVM chains by default). */
  burnerStorageKey?: string;
}

/** @deprecated use EvmAdapterOptions */
export type BaseAdapterOptions = EvmAdapterOptions;

interface OracleAsset {
  symbol: string;
  name: string;
  strikeStep: number;
  vol: number;
  feed?: Address;
  decimals?: number;
  perpIndex?: number;
  szDecimals?: number;
  /** chains.json `tier`: 'major' | 'alt' | 'stock' | 'etf' | 'commodity' … */
  tier?: string;
}

interface ChainSeed {
  numericId: number;
  label: string;
  network: string;
  chainName: string;
  nativeName: string;
  nativeSymbol: string;
  oracleName: string;
  oracleKind: 'chainlink' | 'hypercore';
  explorer: string;
  rpc: string;
  settlementNote: string;
  assets: OracleAsset[];
  oraclePrecompile?: Address;
}

const HYPERCORE_PRECOMPILE = '0x0000000000000000000000000000000000000807' as Address;
const SHARED_BURNER_KEY = 'montions:evm:burner';
const LEGACY_BURNER_KEY = 'montions:base:burner';

const SEED: Record<EvmChainId, ChainSeed> = {
  'base-sepolia': {
    numericId: 84532,
    label: 'Base',
    network: 'Sepolia',
    chainName: 'Base Sepolia',
    nativeName: 'Ether',
    nativeSymbol: 'ETH',
    oracleName: 'Chainlink',
    oracleKind: 'chainlink',
    explorer: 'https://sepolia.basescan.org',
    rpc: 'https://sepolia.base.org',
    settlementNote:
      'Settles on the first Chainlink round at or after expiry, proven onchain; voids 50/50 if no round is recorded within the grace period',
    assets: [
      { symbol: 'ETH', name: 'Ethereum', feed: '0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1', decimals: 8, strikeStep: 25, vol: 0.6 },
      { symbol: 'BTC', name: 'Bitcoin', feed: '0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298', decimals: 8, strikeStep: 500, vol: 0.5 },
      { symbol: 'LINK', name: 'Chainlink', feed: '0xb113F5A928BCfF189C998ab20d753a47F9dE5A61', decimals: 8, strikeStep: 0.25, vol: 0.8 },
    ],
  },
  'arbitrum-sepolia': {
    numericId: 421614,
    label: 'Arbitrum',
    network: 'Sepolia',
    chainName: 'Arbitrum Sepolia',
    nativeName: 'Ether',
    nativeSymbol: 'ETH',
    oracleName: 'Chainlink',
    oracleKind: 'chainlink',
    explorer: 'https://sepolia.arbiscan.io',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    settlementNote:
      'Settles on the first Chainlink round at or after expiry, proven onchain; voids 50/50 if no round is recorded within the grace period',
    assets: [
      { symbol: 'ETH', name: 'Ethereum', feed: '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165', decimals: 8, strikeStep: 25, vol: 0.6 },
      { symbol: 'BTC', name: 'Bitcoin', feed: '0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69', decimals: 8, strikeStep: 500, vol: 0.5 },
      { symbol: 'LINK', name: 'Chainlink', feed: '0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298', decimals: 8, strikeStep: 0.25, vol: 0.8 },
    ],
  },
  'hyperevm-testnet': {
    numericId: 998,
    label: 'Hyperliquid',
    network: 'Testnet',
    chainName: 'HyperEVM Testnet',
    nativeName: 'HYPE',
    nativeSymbol: 'HYPE',
    oracleName: 'HyperCore',
    oracleKind: 'hypercore',
    explorer: 'https://explorer.hyperliquid-testnet.xyz',
    rpc: 'https://rpc.hyperliquid-testnet.xyz/evm',
    oraclePrecompile: HYPERCORE_PRECOMPILE,
    settlementNote:
      'Permissionless record() of the live HyperCore oraclePx inside [expiry, expiry+window] (first recorder wins; keeper typically records within seconds) — the precompile only exposes the current price, not a historical print; voids 50/50 if nothing is recorded within the grace period',
    assets: [
      { symbol: 'SOL', name: 'Solana', perpIndex: 0, szDecimals: 2, strikeStep: 1, vol: 0.8 },
      { symbol: 'BTC', name: 'Bitcoin', perpIndex: 3, szDecimals: 5, strikeStep: 500, vol: 0.5 },
      { symbol: 'ETH', name: 'Ethereum', perpIndex: 4, szDecimals: 4, strikeStep: 25, vol: 0.6 },
    ],
  },
};

const BURNER_ID = 'burner';
const KNOWN_WALLETS: { id: string; name: string }[] = [
  { id: 'io.metamask', name: 'MetaMask' },
  { id: 'com.coinbase.wallet', name: 'Coinbase Wallet' },
  { id: 'io.rabby', name: 'Rabby' },
];
const VOID_GRACE = 2 * 24 * 3600;
const WAD = 10n ** 18n;
const PRICE_SERIES = [
  { type: 'address' },
  { type: 'bytes32' },
  { type: 'uint256' },
  { type: 'bool' },
  { type: 'uint32' },
] as const;

const bookExtraAbi = parseAbi([
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function paused() view returns (bool)',
]);
const aggregatorProxyAbi = parseAbi(['function phaseId() view returns (uint16)']);
const hypercoreResolverAbi = parseAbi([
  'function record(bytes32 assetId, uint64 expiry)',
  'function isRecorded(bytes32 assetId, uint64 expiry) view returns (bool)',
  'function settlementOf(bytes32 assetId, uint64 expiry) view returns (bool recorded, uint256 priceWad, uint64 recordedAt)',
]);
const HYPER_SERIES = [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'bool' }] as const;
const EVENT_SERIES = [{ type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }] as const;
const SERIES_ID_PARAMS = [{ type: 'address' }, { type: 'bytes' }, { type: 'uint64' }] as const;
const eventResolverAbi = [
  { type: 'function', name: 'eventCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'eventKeyAt', stateMutability: 'view', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  {
    type: 'function',
    name: 'eventInfo',
    stateMutability: 'view',
    inputs: [{ name: 'eventKey', type: 'bytes32' }],
    outputs: [{
      name: 'view_',
      type: 'tuple',
      components: [
        { name: 'key', type: 'string' },
        { name: 'question', type: 'string' },
        { name: 'rules', type: 'string' },
        { name: 'source', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'icon', type: 'string' },
        { name: 'closeTime', type: 'uint64' },
        { name: 'rulesHash', type: 'bytes32' },
        { name: 'status', type: 'uint8' },
        { name: 'outcome', type: 'uint8' },
        { name: 'proposer', type: 'address' },
        { name: 'disputer', type: 'address' },
        { name: 'proposedAt', type: 'uint64' },
        { name: 'bond', type: 'uint256' },
      ],
    }],
  },
  { type: 'function', name: 'seriesData', stateMutability: 'view', inputs: [{ name: 'eventKey', type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'eventKeyOf', stateMutability: 'pure', inputs: [{ name: 'key', type: 'string' }], outputs: [{ type: 'bytes32' }] },
] as const;

const CONTRACT_ERRORS: Record<string, string> = {
  Paused: 'New trading is paused right now. You can still withdraw and redeem.',
  CollateralCapExceeded: 'The launch deposit limit has been reached. Try a smaller amount or come back later.',
  SeriesCapExceeded: 'This market has reached its launch size limit.',
  Expired: 'This market has expired and no longer accepts orders.',
  SeriesNotOpen: 'This market is closed.',
  SeriesUnknown: "This market doesn't exist.",
  InsufficientCash: 'Not enough balance to cover this order and its reserve.',
  InsufficientTokens: "You don't hold enough of that position.",
  WouldCross: 'Your order would have matched immediately; try again.',
  BadTick: 'That price is outside the allowed range.',
  BadQty: 'That size is outside the allowed range.',
  NotExpired: 'This market has not settled yet. Wait for the first oracle print after expiry.',
  AlreadySettled: 'This market is already settled.',
  RoundNotFound: 'No Chainlink round at or after expiry has been recorded yet. Try again in a few minutes.',
  AlreadyRecorded: 'The settlement print is already recorded.',
  FeedUnhealthy: 'The Chainlink feed is stale or unhealthy right now. Try again later.',
  UntrustedOracle: "This market is not using this chain's oracle.",
  NotInWindow: 'Not inside the HyperCore settlement window (or it has already closed).',
  WindowClosed: 'The HyperCore settlement window has closed. If nothing was recorded this market will void 50/50.',
  ZeroPrice: 'HyperCore oracle returned a zero price. Try again in a moment.',
};

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const nowS = () => Math.floor(Date.now() / 1000);
const usd = (base: bigint) => Number(base) / 1e6;

type Eip1193 = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on?: (ev: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (ev: string, cb: (...args: unknown[]) => void) => void;
};
interface DiscoveredWallet {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193;
}

interface PriceTick {
  price: number;
  time: number;
}

interface IndexedSeries {
  id: Hex;
  symbol: string;
  strike: number;
  strikeWad: bigint;
  expiry: number;
  above: boolean;
  status: MarketInfo['status'];
  outcome?: Outcome;
  yesId: bigint;
  noId: bigint;
  resolver: Address;
  data: Hex;
  assetId: Hex;
  snap?: QuoterSnapshot;
}

interface LoadedDep {
  deployment?: Deployment;
  book: Address;
  quoter: Address;
  collateral: Address;
  vault?: Address;
  oracle?: Address;
  resolver?: Address;
  eventResolver?: Address;
  client: MontionsClient;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function wadToUsd(wad: bigint): number {
  const sign = wad < 0n ? -1 : 1;
  const w = wad < 0n ? -wad : wad;
  const whole = Number(w / WAD);
  const frac = Number(w % WAD / 10n ** 10n) / 1e8;
  return sign * (whole + frac);
}

function usdToWad(usdN: number): bigint {
  if (!Number.isFinite(usdN) || usdN <= 0) return 0n;
  const s = usdN.toFixed(8);
  const [w, f = ''] = s.split('.');
  return BigInt(w) * WAD + BigInt((f + '00000000').slice(0, 8)) * 10n ** 10n;
}

function wadToProb(wad: bigint): number {
  if (wad <= 0n) return 0;
  return Number(wad / 10n ** 12n) / 1e6;
}

function sameStrike(a: bigint, b: bigint): boolean {
  const scale = 10n ** 10n;
  return a / scale === b / scale;
}

function clampTick(tick: number): number {
  if (!Number.isFinite(tick)) return 1;
  return Math.max(1, Math.min(99, Math.round(tick)));
}

function priceToLimitTick(price: number): number {
  if (!Number.isFinite(price)) return 99;
  return Math.max(1, Math.min(99, Math.floor(price * 100 + 1e-9)));
}

function assetIdOf(symbol: string): Hex {
  return keccak256(stringToHex(symbol));
}

function shortAddr(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function messageOf(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as { shortMessage?: unknown; message?: unknown };
    if (typeof o.shortMessage === 'string' && o.shortMessage) return o.shortMessage;
    if (typeof o.message === 'string' && o.message) return o.message;
  }
  return 'Something went wrong';
}

function revertName(e: unknown): string | undefined {
  if (e instanceof ContractFunctionRevertedError) return e.data?.errorName;
  if (e instanceof BaseError) {
    const inner = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (inner instanceof ContractFunctionRevertedError) return inner.data?.errorName;
  }
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
    const o = cur as { data?: { errorName?: string }; cause?: unknown };
    if (o.data?.errorName) return o.data.errorName;
    cur = o.cause;
  }
  return undefined;
}

function isUserRejection(e: unknown): boolean {
  if (e instanceof UserRejectedRequestError) return true;
  if (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError)) return true;
  const msg = messageOf(e);
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return code === 4001 || /user rejected|rejected the request|user denied|denied transaction|request rejected|cancell?ed|declined/i.test(msg);
}

function notDeployedMsg(label: string): string {
  return `Not deployed on ${label} yet`;
}

function makeFriendly(seed: ChainSeed, missing: string): (e: unknown) => string {
  const gas = `${seed.label} ${seed.network} ${seed.nativeSymbol}`;
  return (e: unknown): string => {
    if (isUserRejection(e)) return 'You cancelled the request in your wallet.';
    const named = revertName(e);
    if (named && CONTRACT_ERRORS[named]) return CONTRACT_ERRORS[named]!;
    const raw = messageOf(e).replace(/\s+/g, ' ').trim();
    if (raw.includes(missing) || /not deployed on /i.test(raw)) return missing;
    if (/insufficient funds|insufficient balance|gas required exceeds|exceeds the balance/i.test(raw)) {
      return `Not enough ${seed.nativeSymbol} for gas. Fund this wallet with ${gas} and try again.`;
    }
    if (new RegExp(`wrong network|wallet_switchEthereumChain|chain mismatch|expected ${seed.numericId}`, 'i').test(raw)) {
      return `Your wallet is on the wrong network. Switch to ${seed.chainName} and retry.`;
    }
    if (/failed to fetch|networkerror|network request failed|econn|429|too many requests|timeout|timed out/i.test(raw)) {
      return `Could not reach ${seed.chainName} right now. Check your connection and retry.`;
    }
    if (/slippage|price moved|minfillnotmet|nothing filled/i.test(raw)) {
      return 'The price moved past your limit. Refresh the quote and try again.';
    }
    return raw.length > 180 ? `${raw.slice(0, 177)}…` : raw || 'Something went wrong';
  };
}

function gasPadded(inner: Transport, pct = 120): Transport {
  return (opts) => {
    const base = inner(opts);
    return custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        const out = await base.request({ method, params } as never);
        if (method === 'eth_estimateGas' && typeof out === 'string') {
          return `0x${((BigInt(out) * BigInt(pct)) / 100n).toString(16)}`;
        }
        return out;
      },
    })(opts);
  };
}

function decodeSeriesData(data: Hex): { oracle?: Address; assetId: Hex; strikeWad: bigint; above: boolean; window?: number } | null {
  try {
    const d = decodeAbiParameters(PRICE_SERIES, data);
    return { oracle: d[0], assetId: d[1], strikeWad: d[2], above: d[3], window: Number(d[4]) };
  } catch {
    /* HyperCore layout: (assetId, strikeWad, above) */
  }
  try {
    const d = decodeAbiParameters(HYPER_SERIES, data);
    return { assetId: d[0], strikeWad: d[1], above: d[2] };
  } catch {
    return null;
  }
}

function expiryTag(expiry: number): string | undefined {
  const d = new Date(expiry * 1000);
  const minutes = d.getUTCMinutes();
  const hours = d.getUTCHours();
  if (expiry % 900 === 0 && minutes !== 0) return '15-min';
  if (expiry % 3600 === 0 && hours !== 0 && hours !== 8 && hours !== 16) return 'Hourly';
  if (d.getUTCDay() === 5) {
    const next = new Date((expiry + 7 * 86400) * 1000);
    if (next.getUTCMonth() !== d.getUTCMonth()) return 'Monthly';
    return 'Weekly';
  }
  if (hours === 0 || hours === 8 || hours === 16) return 'Daily';
  return undefined;
}

function asSeriesId(id: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error('Market not found');
  return id as Hex;
}

function emptyQuote(outcome: Outcome, budget: number, chance: number, reason: string, needsMarket = false): Quote {
  return { outcome, budget, contracts: 0, avgPrice: 0, limitPrice: 0, cost: 0, payout: 0, chance, needsMarket, tradable: false, reason };
}

function emptyEventQuote(outcome: Outcome, budget: number, reason: string): EventQuote {
  return { outcome, budget, contracts: 0, avgPrice: 0, limitPrice: 0, cost: 0, payout: 0, tradable: false, reason };
}

function walkBudget(
  levels: { tick: number; qty: bigint }[],
  yes: boolean,
  budgetUsd: number,
  maxOutcomeTick: number,
): { contracts: bigint; cost: bigint; worstTick: number } {
  let remaining = 0n;
  try {
    remaining = parseUsdc(budgetUsd.toFixed(6));
  } catch {
    remaining = 0n;
  }
  let contracts = 0n;
  let cost = 0n;
  let worst = 0;
  for (const lvl of levels) {
    const ot = yes ? lvl.tick : TICKS - lvl.tick;
    if (ot < 1 || ot > 99 || ot > maxOutcomeTick) break;
    const px = BigInt(ot) * TICK_UNIT;
    if (px === 0n || lvl.qty === 0n) continue;
    const afford = remaining / px;
    const take = afford < lvl.qty ? afford : lvl.qty;
    if (take === 0n) break;
    contracts += take;
    const spend = take * px;
    cost += spend;
    remaining -= spend;
    worst = ot;
    if (take < lvl.qty) break;
  }
  return { contracts, cost, worstTick: worst };
}

function deploymentGlobs(): Record<string, () => Promise<unknown>> {
  const out: Record<string, () => Promise<unknown>> = {};
  try {
    Object.assign(out, import.meta.glob('../../../montions-base/deployments/*.json'));
  } catch {
    /* node / missing file */
  }
  try {
    Object.assign(out, import.meta.glob('/../montions-base/deployments/*.json'));
  } catch {
    /* node / missing file */
  }
  return out;
}

function chainsGlobs(): Record<string, () => Promise<unknown>> {
  const out: Record<string, () => Promise<unknown>> = {};
  try {
    Object.assign(out, import.meta.glob('../../../montions-base/config/chains.json'));
  } catch {
    /* node / missing file */
  }
  try {
    Object.assign(out, import.meta.glob('/../montions-base/config/chains.json'));
  } catch {
    /* node / missing file */
  }
  return out;
}

function isManifestPath(path: string, chainId: number): boolean {
  return path.replace(/\\/g, '/').endsWith(`/${chainId}.json`) && !path.includes('.contracts.') && !path.includes('.meta.');
}

async function readManifestJson(chainId: number): Promise<unknown | null> {
  const loaders = deploymentGlobs();
  const match = Object.entries(loaders).find(([p]) => isManifestPath(p, chainId));
  if (match) {
    try {
      const mod = await match[1]();
      const json = (mod as { default?: unknown }).default ?? mod;
      if (json && typeof json === 'object') return json;
    } catch {
      /* fall through */
    }
  }
  try {
    const spec = `@montions/base-deployments/${chainId}.json`;
    const mod = (await import(spec)) as { default?: unknown };
    const json = mod.default ?? mod;
    if (json && typeof json === 'object') return json;
  } catch {
    /* missing manifest is expected for undeployed chains */
  }
  return null;
}

let chainsJsonCache: unknown | null | undefined;
async function readChainsJson(): Promise<unknown | null> {
  if (chainsJsonCache !== undefined) return chainsJsonCache;
  const loaders = chainsGlobs();
  const load = Object.values(loaders)[0];
  if (load) {
    try {
      const mod = await load();
      const json = (mod as { default?: unknown }).default ?? mod;
      if (json && typeof json === 'object') {
        chainsJsonCache = json;
        return json;
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const spec = '../../../montions-base/config/chains.json';
    const mod = (await import(/* @vite-ignore */ spec)) as { default?: unknown };
    const json = mod.default ?? mod;
    if (json && typeof json === 'object') {
      chainsJsonCache = json;
      return json;
    }
  } catch {
    /* optional */
  }
  chainsJsonCache = null;
  return null;
}

function volFromWad(volWad: string | undefined, symbol: string): number {
  if (volWad && /^\d+$/.test(volWad)) {
    try {
      const n = wadToProb(BigInt(volWad));
      if (n > 0 && n < 5) return n;
    } catch {
      /* fall through */
    }
  }
  if (symbol === 'BTC') return 0.5;
  if (symbol === 'LINK' || symbol === 'SOL') return 0.8;
  if (symbol === 'HYPE') return 1;
  return 0.6;
}

function toOracleAsset(a: ChainAssetConfig, grids: Record<string, number>): OracleAsset {
  return {
    symbol: a.symbol,
    name: a.name ?? a.display ?? a.symbol,
    strikeStep: grids[a.symbol.toUpperCase()] ?? a.strikeStep,
    vol: volFromWad(a.volWad, a.symbol),
    ...(a.feed ? { feed: a.feed } : {}),
    ...(a.decimals !== undefined ? { decimals: a.decimals } : {}),
    ...(a.perpIndex !== undefined ? { perpIndex: a.perpIndex } : {}),
    ...(a.szDecimals !== undefined ? { szDecimals: a.szDecimals } : {}),
    ...(a.tier ? { tier: a.tier } : {}),
  };
}

/** Asset class from the chains.json tier (stocks/ETFs/commodities are keeper-reported on these testnets). */
function categoryOf(tier: string | undefined): AssetCategory {
  const t = (tier ?? '').toLowerCase();
  if (t === 'stock' || t === 'equity' || t === 'equities') return 'stock';
  if (t === 'etf') return 'etf';
  if (t === 'commodity' || t === 'commodities') return 'commodity';
  if (t === 'fx' || t === 'forex') return 'fx';
  return 'crypto';
}

function isKeeperTier(tier: string | undefined): boolean {
  const c = categoryOf(tier);
  return c === 'stock' || c === 'etf' || c === 'commodity';
}

function eventCategoryOf(raw: string): EventCategory {
  const t = raw.toLowerCase();
  if (t === 'crypto' || t === 'macro' || t === 'politics' || t === 'sports' || t === 'tech' || t === 'culture') return t;
  return 'other';
}

function eventStatusOf(n: number): EventInfo['status'] {
  if (n === 1) return 'open';
  if (n === 2) return 'closed';
  if (n === 3) return 'proposed';
  if (n === 4) return 'disputed';
  if (n === 5) return 'resolved';
  if (n === 6) return 'void';
  return 'closed';
}

/** US regular session (Mon–Fri 13:30–20:00 UTC, ignoring holidays/DST edge — conservative badge only). */
function usMarketClosed(nowMs = Date.now()): boolean {
  const d = new Date(nowMs);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m < 13 * 60 + 30 || m >= 20 * 60;
}

function scaleOraclePx(raw: bigint, szDecimals: number): number {
  const exp = 6 - szDecimals;
  if (raw <= 0n) return 0;
  if (exp >= 0) return Number(raw) / 10 ** exp;
  return Number(raw) * 10 ** -exp;
}

function pickAddr(contracts: Record<string, Address | undefined>, names: string[]): Address | undefined {
  for (const n of names) {
    const v = contracts[n];
    if (v && isAddress(v)) return getAddress(v);
  }
  const wanted = new Set(names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [n, v] of Object.entries(contracts)) {
    if (v && wanted.has(n.toLowerCase().replace(/[^a-z0-9]/g, ''))) return getAddress(v);
  }
  return undefined;
}

function addressesFromUnknown(raw: unknown): {
  book: Address;
  quoter: Address;
  collateral: Address;
  vault?: Address;
  oracle?: Address;
  resolver?: Address;
  eventResolver?: Address;
  deployment?: Deployment;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  let deployment: Deployment | undefined;
  try {
    deployment = parseDeployment(raw);
  } catch {
    deployment = undefined;
  }
  const contracts = (deployment?.contracts ?? (raw as { contracts?: Record<string, string> }).contracts ?? {}) as Record<
    string,
    Address | undefined
  >;
  const book = pickAddr(contracts, ['book', 'montionsBook']);
  const quoter = pickAddr(contracts, ['quoter']);
  const collateral = pickAddr(contracts, ['collateral', 'tusdc', 'usdc', 'testusdc']);
  if (!book || !quoter || !collateral) return null;
  const vault = pickAddr(contracts, ['vault', 'makerVault']);
  const oracle = pickAddr(contracts, ['chainlinkOracle', 'hypercoreOracle', 'oracle', 'oracleHub']);
  const resolver = pickAddr(contracts, [
    'chainlinkResolver',
    'chainlinkSettlementResolver',
    'hypercoreResolver',
    'hypercoreSettlementResolver',
    'resolver',
  ]);
  const eventResolver = pickAddr(contracts, ['eventResolver', 'optimisticEventResolver']);
  return {
    book,
    quoter,
    collateral,
    ...(vault ? { vault } : {}),
    ...(oracle ? { oracle } : {}),
    ...(resolver ? { resolver } : {}),
    ...(eventResolver ? { eventResolver } : {}),
    ...(deployment ? { deployment } : {}),
  };
}

function ceilBps(amount: bigint, bps: number): bigint {
  if (bps <= 0 || amount === 0n) return 0n;
  return (amount * BigInt(bps) + 9_999n) / 10_000n;
}

async function findRoundLocal(publicClient: PublicClient, feed: Address, expiry: number): Promise<bigint | null> {
  const expiryB = BigInt(expiry);
  let phase: number;
  let latest: readonly [bigint, bigint, bigint, bigint, bigint];
  try {
    const [p, l] = await Promise.all([
      publicClient.readContract({ address: feed, abi: aggregatorProxyAbi, functionName: 'phaseId' }),
      publicClient.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: 'latestRoundData' }),
    ]);
    phase = Number(p);
    latest = l;
  } catch {
    return null;
  }
  const latestId = latest[0];
  const latestUpdatedAt = latest[3];
  if (Number(latestId >> 64n) !== phase || latestUpdatedAt < expiryB) return null;
  const base = BigInt(phase) << 64n;
  const mask = (1n << 64n) - 1n;
  let hi = latestId & mask;
  let lo = 0n;
  let step = 1n;
  const updatedAt = async (agg: bigint): Promise<bigint> => {
    const row = await publicClient.readContract({
      address: feed,
      abi: chainlinkAggregatorAbi,
      functionName: 'getRoundData',
      args: [base | agg],
    });
    return row[3];
  };
  while (true) {
    if (hi <= step) break;
    const probe = hi - step;
    const t = await updatedAt(probe);
    if (t !== 0n && t < expiryB) {
      lo = probe;
      break;
    }
    hi = probe;
    if (step < 1n << 32n) step <<= 1n;
  }
  while (hi - lo > 1n) {
    const mid = lo + (hi - lo) / 2n;
    const t = await updatedAt(mid);
    if (t !== 0n && t < expiryB) lo = mid;
    else hi = mid;
  }
  if (hi === 1n && phase > 1) return null;
  return base | hi;
}

// ───────────────────────────── shared EVM wallet (EIP-6963 + one burner) ─────────────────────────────

type SharedWallet =
  | { kind: 'burner'; account: PrivateKeyAccount }
  | { kind: 'injected'; id: string; account: Address; provider: Eip1193; off?: () => void };

const walletHub = {
  discovered: new Map<string, DiscoveredWallet>(),
  discoveryStarted: false,
  current: null as SharedWallet | null,
  listeners: new Set<(address: string | null) => void>(),
};

function hubAddress(): string | null {
  const c = walletHub.current;
  if (!c) return null;
  return c.kind === 'burner' ? c.account.address : c.account;
}

function hubEmit() {
  const a = hubAddress();
  for (const cb of walletHub.listeners) {
    try {
      cb(a);
    } catch {
      /* ignore */
    }
  }
}

function hubStartDiscovery() {
  if (walletHub.discoveryStarted || typeof window === 'undefined') return;
  walletHub.discoveryStarted = true;
  window.addEventListener('eip6963:announceProvider', (ev: Event) => {
    const d = (ev as CustomEvent<{ info?: { uuid: string; name: string; icon?: string; rdns?: string }; provider?: Eip1193 }>).detail;
    if (!d?.info || !d.provider) return;
    const id = d.info.rdns || d.info.uuid;
    walletHub.discovered.set(id, { id, name: d.info.name, ...(d.info.icon ? { icon: d.info.icon } : {}), provider: d.provider });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function hubListInjected(): DiscoveredWallet[] {
  hubStartDiscovery();
  const out = [...walletHub.discovered.values()];
  const legacy = typeof globalThis !== 'undefined' ? (globalThis as { ethereum?: Eip1193 }).ethereum : undefined;
  if (legacy && !out.some((w) => w.provider === legacy)) {
    out.push({ id: 'window.ethereum', name: 'Browser wallet', provider: legacy });
  }
  return out;
}

function hubLoadBurner(storageKey: string): PrivateKeyAccount {
  const st = storage();
  let pk = st?.getItem(storageKey);
  if ((!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) && storageKey === SHARED_BURNER_KEY) {
    const legacy = st?.getItem(LEGACY_BURNER_KEY);
    if (legacy && /^0x[0-9a-fA-F]{64}$/.test(legacy)) {
      pk = legacy;
      st?.setItem(storageKey, pk);
    }
  }
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    pk = generatePrivateKey();
    st?.setItem(storageKey, pk);
  }
  return privateKeyToAccount(pk as Hex);
}

function hubBurnerPreview(storageKey: string): string | null {
  try {
    const pk = storage()?.getItem(storageKey);
    if (pk && /^0x[0-9a-fA-F]{64}$/.test(pk)) return privateKeyToAccount(pk as Hex).address;
    if (storageKey === SHARED_BURNER_KEY) {
      const legacy = storage()?.getItem(LEGACY_BURNER_KEY);
      if (legacy && /^0x[0-9a-fA-F]{64}$/.test(legacy)) return privateKeyToAccount(legacy as Hex).address;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ───────────────────────────── adapter ─────────────────────────────

export function createEvmAdapter(chainKey: EvmChainId, opts: EvmAdapterOptions = {}): ChainAdapter {
  if (chainKey !== 'base-sepolia' && chainKey !== 'arbitrum-sepolia' && chainKey !== 'hyperevm-testnet') {
    throw new Error(`Unsupported EVM chain: ${String(chainKey)}`);
  }
  const seed = SEED[chainKey];
  const numericId = seed.numericId;
  const missing = notDeployedMsg(seed.label);
  const friendly = makeFriendly(seed, missing);
  const envRpc =
    chainKey === 'base-sepolia'
      ? env.VITE_BASE_RPC
      : chainKey === 'arbitrum-sepolia'
        ? env.VITE_ARBITRUM_RPC ?? env.VITE_ARB_RPC
        : env.VITE_HYPEREVM_RPC ?? env.VITE_HYPER_RPC ?? env.VITE_HYPERLIQUID_RPC;
  const envRpcListKey =
    chainKey === 'base-sepolia' ? 'VITE_BASE_RPCS' : chainKey === 'arbitrum-sepolia' ? 'VITE_ARBITRUM_RPCS' : 'VITE_HYPEREVM_RPCS';
  const rpcUrl = opts.rpcUrl ?? envRpc ?? seed.rpc;
  const extraRpcs = (opts.rpcs ?? String(env[envRpcListKey] ?? '').split(','))
    .map((u) => u.trim())
    .filter((u) => /^https:\/\//.test(u) && u !== rpcUrl);
  const burnerKey = opts.burnerStorageKey ?? SHARED_BURNER_KEY;
  const sdkChain = chainForId(numericId);
  const chain = sdkChain as unknown as Chain;
  const rpcList = [...new Set([rpcUrl, ...extraRpcs])];
  const transport: Transport =
    rpcList.length > 1
      ? fallback(
          rpcList.map((u) => http(u, { retryCount: 2, timeout: 12_000 })),
          { retryCount: 1 },
        )
      : http(rpcList[0], { retryCount: 2, timeout: 12_000 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const chainHex = `0x${numericId.toString(16)}`;
  const explorer = seed.explorer.replace(/\/$/, '');
  const oracleKind = seed.oracleKind;
  let precompile: Address = seed.oraclePrecompile ?? HYPERCORE_PRECOMPILE;

  const meta: ChainMeta = {
    id: chainKey,
    label: seed.label,
    network: seed.network,
    collateralSymbol: 'tUSDC',
    nativeSymbol: seed.nativeSymbol,
    evmChainId: numericId,
    oracleName: seed.oracleName,
    settlementNote: seed.settlementNote,
    explorerTx: (sig) => `${explorer}/tx/${sig}`,
    explorerAddress: (addr) => `${explorer}/address/${addr}`,
  };

  let assets: OracleAsset[] = seed.assets.map((a) => ({ ...a }));
  const priceCache = new Map<string, PriceTick>();
  const feedBySymbol = new Map(assets.map((f) => [f.symbol, f]));
  const idToSymbol = new Map<string, string>(assets.map((f) => [assetIdOf(f.symbol).toLowerCase(), f.symbol]));

  function syncAssetMaps() {
    feedBySymbol.clear();
    for (const a of assets) {
      feedBySymbol.set(a.symbol, a);
      idToSymbol.set(assetIdOf(a.symbol).toLowerCase(), a.symbol);
    }
  }

  let configLoaded = false;
  async function loadConfig(): Promise<void> {
    if (configLoaded) return;
    configLoaded = true;
    try {
      const json = await readChainsJson();
      if (!json) return;
      const cfg = parseChainsConfig(json);
      const entry = chainById(cfg, numericId);
      const picked = entry.assets
        .filter((a) => (a.quote ?? 'USD').toUpperCase() === 'USD' && (a.ladder || isKeeperTier(a.tier)))
        // stocks/ETFs/commodities appear only once their KeeperFeed is deployed (feed address in chains.json)
        .filter((a) => !isKeeperTier(a.tier) || Boolean(a.feed))
        .map((a) => toOracleAsset(a, cfg.strikeGrids));
      if (picked.length) assets = picked;
      for (const a of entry.assets) idToSymbol.set(assetIdOf(a.symbol).toLowerCase(), a.symbol);
      if (entry.oraclePrecompile) precompile = entry.oraclePrecompile;
      syncAssetMaps();
    } catch {
      /* keep seed assets */
    }
  }

  let loaded: LoadedDep | null = null;
  let loadingDep: Promise<LoadedDep | null> | null = null;
  const seriesCache = { at: 0, list: [] as IndexedSeries[] };

  async function loadDep(): Promise<LoadedDep | null> {
    if (loaded) return loaded;
    if (loadingDep) return loadingDep;
    loadingDep = (async () => {
      const json = await readManifestJson(numericId);
      if (!json) return null;
      const addrs = addressesFromUnknown(json);
      if (!addrs) return null;
      if (addrs.deployment) {
        for (const a of addrs.deployment.assets) {
          idToSymbol.set(a.assetId.toLowerCase(), a.symbol);
          const existing = assets.find((x) => x.symbol.toUpperCase() === a.symbol.toUpperCase());
          if (existing) {
            if (a.feed) existing.feed = a.feed;
            if (a.decimals !== undefined) existing.decimals = a.decimals;
            if (a.tier) existing.tier = a.tier;
            if (a.strikeStep) existing.strikeStep = a.strikeStep;
          } else if (a.tier && isKeeperTier(a.tier)) {
            assets.push({
              symbol: a.symbol,
              name: a.name ?? a.symbol,
              strikeStep: a.strikeStep ?? 1,
              vol: 0.3,
              ...(a.feed ? { feed: a.feed } : {}),
              decimals: a.decimals ?? 8,
              tier: a.tier,
            });
          }
        }
        syncAssetMaps();
      }
      const client = new MontionsClient({
        ...(addrs.deployment ? { deployment: addrs.deployment } : {}),
        addresses: {
          book: addrs.book,
          quoter: addrs.quoter,
          collateral: addrs.collateral,
          ...(addrs.vault ? { vault: addrs.vault } : {}),
          ...(addrs.oracle ? { oracle: addrs.oracle } : {}),
          ...(addrs.resolver ? { resolver: addrs.resolver } : {}),
        },
        chain: sdkChain,
        rpcUrl,
      });
      loaded = {
        ...addrs,
        client,
      };
      return loaded;
    })().finally(() => {
      loadingDep = null;
    });
    return loadingDep;
  }

  async function requireDep(): Promise<LoadedDep> {
    const d = await loadDep();
    if (!d) throw new Error(missing);
    return d;
  }

  async function readChainlinkPrices(): Promise<PriceTick[]> {
    const feeds = assets.filter((a) => a.feed);
    if (!feeds.length) return assets.map((a) => priceCache.get(a.symbol) ?? { price: 0, time: 0 });
    const contracts = feeds.map((f) => ({
      address: f.feed!,
      abi: chainlinkAggregatorAbi,
      functionName: 'latestRoundData' as const,
    }));
    let rows: ({ status: 'success'; result: readonly [bigint, bigint, bigint, bigint, bigint] } | { status: 'failure' } | undefined)[];
    try {
      rows = (await publicClient.multicall({ contracts, allowFailure: true })) as typeof rows;
    } catch {
      rows = [];
      for (const f of feeds) {
        try {
          const result = await publicClient.readContract({
            address: f.feed!,
            abi: chainlinkAggregatorAbi,
            functionName: 'latestRoundData',
          });
          rows.push({ status: 'success', result });
        } catch {
          rows.push({ status: 'failure' });
        }
      }
    }
    const bySymbol = new Map<string, PriceTick>();
    feeds.forEach((f, i) => {
      const prev = priceCache.get(f.symbol);
      const r = rows[i];
      if (!r || r.status !== 'success') {
        bySymbol.set(f.symbol, prev ?? { price: 0, time: 0 });
        return;
      }
      const answer = r.result[1];
      const updatedAt = r.result[3];
      if (answer <= 0n || updatedAt === 0n) {
        bySymbol.set(f.symbol, prev ?? { price: 0, time: 0 });
        return;
      }
      const price = Number(answer) / 10 ** (f.decimals ?? 8);
      if (!Number.isFinite(price) || price <= 0) {
        bySymbol.set(f.symbol, prev ?? { price: 0, time: 0 });
        return;
      }
      const tick = { price, time: Number(updatedAt) };
      priceCache.set(f.symbol, tick);
      bySymbol.set(f.symbol, tick);
    });
    return assets.map((a) => bySymbol.get(a.symbol) ?? priceCache.get(a.symbol) ?? { price: 0, time: 0 });
  }

  async function readHypercorePrices(): Promise<PriceTick[]> {
    const now = nowS();
    const oracleAddr = loaded?.oracle;
    const ticks: PriceTick[] = [];
    for (const a of assets) {
      const prev = priceCache.get(a.symbol) ?? { price: 0, time: 0 };
      let next = prev;
      if (a.perpIndex !== undefined && a.szDecimals !== undefined) {
        try {
          // HyperCore 0x…0807 takes ABI-encoded uint32 calldata with NO function selector.
          const data = encodeAbiParameters([{ type: 'uint32' }], [a.perpIndex]);
          const ret = await publicClient.call({ to: precompile, data });
          const raw = ret.data && ret.data !== '0x' ? hexToBigInt(ret.data) : 0n;
          const price = scaleOraclePx(raw, a.szDecimals);
          if (price > 0 && Number.isFinite(price)) {
            next = { price, time: now };
            priceCache.set(a.symbol, next);
            ticks.push(next);
            continue;
          }
        } catch {
          /* try HyperCoreOracle */
        }
      }
      if (oracleAddr) {
        try {
          const row = (await publicClient.readContract({
            address: oracleAddr,
            abi: priceOracleAbi,
            functionName: 'latestPrice',
            args: [assetIdOf(a.symbol)],
          })) as readonly [bigint, bigint];
          const price = wadToUsd(row[0]);
          const time = Number(row[1]) || now;
          if (price > 0 && Number.isFinite(price)) {
            next = { price, time };
            priceCache.set(a.symbol, next);
          }
        } catch {
          /* keep prev */
        }
      }
      ticks.push(next);
    }
    return ticks;
  }

  async function readOraclePrices(): Promise<PriceTick[]> {
    await loadConfig();
    if (oracleKind === 'hypercore') return readHypercorePrices();
    return readChainlinkPrices();
  }

  async function indexSeries(force = false): Promise<IndexedSeries[]> {
    const dep = await loadDep();
    if (!dep) return [];
    if (!force && seriesCache.list.length && nowS() - seriesCache.at < 20) return seriesCache.list;
    const out: IndexedSeries[] = [];
    try {
      for (let offset = 0; offset < 10_000; offset += 50) {
        const page = await dep.client.snapshots(offset, 50);
        for (const s of page) {
          if (!s.info || s.info.status === 0) continue;
          const decoded = decodeSeriesData(s.info.data);
          if (!decoded) continue;
          const symbol = idToSymbol.get(decoded.assetId.toLowerCase()) ?? '?';
          const status: MarketInfo['status'] = s.info.status === 2 ? 'resolved' : s.info.status === 3 ? 'void' : 'open';
          out.push({
            id: s.seriesId,
            symbol,
            strike: wadToUsd(decoded.strikeWad),
            strikeWad: decoded.strikeWad,
            expiry: Number(s.info.expiry),
            above: decoded.above,
            status,
            ...(status === 'resolved' ? { outcome: (s.info.yes ? 'yes' : 'no') as Outcome } : {}),
            yesId: s.info.yesId,
            noId: s.info.noId,
            resolver: s.info.resolver,
            data: s.info.data,
            assetId: decoded.assetId,
            snap: s,
          });
        }
        if (page.length < 50) break;
      }
    } catch {
      const count = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'seriesCount' }).catch(() => 0n);
      const n = Number(count);
      for (let offset = 0; offset < n; offset += 100) {
        const ids = await publicClient.readContract({
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'seriesIds',
          args: [BigInt(offset), 100n],
        });
        for (const id of ids) {
          const info = await dep.client.seriesInfo(id).catch(() => null);
          if (!info || info.status === 0) continue;
          const decoded = decodeSeriesData(info.data);
          if (!decoded) continue;
          const symbol = idToSymbol.get(decoded.assetId.toLowerCase()) ?? '?';
          const status: MarketInfo['status'] = info.status === 2 ? 'resolved' : info.status === 3 ? 'void' : 'open';
          out.push({
            id,
            symbol,
            strike: wadToUsd(decoded.strikeWad),
            strikeWad: decoded.strikeWad,
            expiry: Number(info.expiry),
            above: decoded.above,
            status,
            ...(status === 'resolved' ? { outcome: (info.yes ? 'yes' : 'no') as Outcome } : {}),
            yesId: info.yesId,
            noId: info.noId,
            resolver: info.resolver,
            data: info.data,
            assetId: decoded.assetId,
          });
        }
      }
    }
    seriesCache.list = out;
    seriesCache.at = nowS();
    return out;
  }

  function pickSeries(list: IndexedSeries[], symbol: string, strike: number, expiry: number): IndexedSeries | undefined {
    const wad = usdToWad(strike);
    const hits = list.filter((s) => s.symbol === symbol && s.expiry === expiry && (sameStrike(s.strikeWad, wad) || Math.abs(s.strike - strike) < 1e-8 * Math.max(1, strike)));
    return hits.find((s) => s.above) ?? hits[0];
  }

  async function seriesOf(symbol: string, strike: number, expiry: number): Promise<IndexedSeries | undefined> {
    return pickSeries(await indexSeries(), symbol, strike, expiry);
  }

  function chanceOf(s: IndexedSeries | undefined, symbol: string, strike: number, expiry: number, outcome: Outcome): number {
    const now = nowS();
    const tte = expiry - now;
    if (s?.snap && s.snap.probWad > 0n) {
      const p = wadToProb(s.snap.probWad);
      const yes = s.above ? p : 1 - p;
      return outcome === 'yes' ? yes : 1 - yes;
    }
    const a = feedBySymbol.get(symbol);
    const spot = priceCache.get(symbol)?.price ?? 0;
    const vol = a?.vol ?? 0.6;
    const fair = spot > 0 && strike > 0 ? probAbove(spot, strike, vol, tte) : 0.5;
    return outcome === 'yes' ? fair : 1 - fair;
  }

  // ── wallets (shared across EVM adapters; switch/add this chain on demand) ──

  function currentAddress(): string | null {
    return hubAddress();
  }

  function startDiscovery() {
    hubStartDiscovery();
  }

  function listInjected(): DiscoveredWallet[] {
    return hubListInjected();
  }

  function loadBurner(): PrivateKeyAccount {
    return hubLoadBurner(burnerKey);
  }

  function burnerPreview(): string | null {
    return hubBurnerPreview(burnerKey);
  }

  async function ensureChain(provider: Eip1193): Promise<void> {
    try {
      const id = await provider.request({ method: 'eth_chainId' });
      const n = typeof id === 'string' ? parseInt(id, 16) : Number(id);
      if (n === numericId) return;
    } catch {
      /* try switch anyway */
    }
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
    } catch (e) {
      if (isUserRejection(e)) throw e;
      const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
      if (code === 4902 || /unrecognized chain|chain not added|4902/i.test(messageOf(e))) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainHex,
              chainName: seed.chainName,
              nativeCurrency: { name: seed.nativeName, symbol: seed.nativeSymbol, decimals: 18 },
              rpcUrls: rpcList,
              blockExplorerUrls: [explorer],
            },
          ],
        });
        return;
      }
      throw e;
    }
  }

  async function ensureInjected(): Promise<void> {
    const cur = walletHub.current;
    if (cur?.kind === 'injected') await ensureChain(cur.provider);
  }

  function requireWallet(): { address: Address; walletClient: WalletClient; account: Account | Address } {
    const cur = walletHub.current;
    if (!cur) throw new Error('Connect a wallet first');
    if (cur.kind === 'burner') {
      const walletClient = createWalletClient({
        account: cur.account,
        chain,
        transport: gasPadded(http(rpcUrl, { retryCount: 2, timeout: 20_000 })),
      });
      return { address: cur.account.address, walletClient, account: cur.account };
    }
    const walletClient = createWalletClient({
      account: cur.account,
      chain,
      transport: custom(cur.provider as never),
    });
    return { address: cur.account, walletClient, account: cur.account };
  }

  async function waitOk(hash: Hash): Promise<Hash> {
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (rc.status !== 'success') throw new Error('Transaction reverted');
    return hash;
  }

  async function write(
    walletClient: WalletClient,
    account: Account | Address,
    args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] },
  ): Promise<Hash> {
    try {
      const hash = await walletClient.writeContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        ...(args.args ? { args: args.args } : {}),
        account,
        chain,
      } as never);
      return await waitOk(hash);
    } catch (e) {
      throw new Error(friendly(e));
    }
  }

  const permitTypes = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  } as const;

  async function signPermit(
    token: Address,
    spender: Address,
    owner: Address,
    amount: bigint,
    walletClient: WalletClient,
    account: Account | Address,
  ): Promise<{ deadline: bigint; v: number; r: Hex; s: Hex }> {
    const deadline = BigInt(nowS() + 3600);
    const name = (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' })) as string;
    const nonce = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'nonces',
      args: [owner],
    })) as bigint;
    let version = '1';
    try {
      version = String(
        await publicClient.readContract({
          address: token,
          abi: parseAbi(['function version() view returns (string)']),
          functionName: 'version',
        }),
      );
    } catch {
      version = '1';
    }
    const signature = await walletClient.signTypedData({
      account,
      domain: { name, version, chainId: numericId, verifyingContract: token },
      types: permitTypes,
      primaryType: 'Permit',
      message: { owner, spender, value: amount, nonce, deadline },
    });
    const parsed = parseSignature(signature);
    const v = Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27));
    return { deadline, v, r: parsed.r, s: parsed.s };
  }

  function placeCall(order: PlaceOrderParams): Hex {
    return encodePlaceOrder(order);
  }

  async function hintRound(dep: LoadedDep, feed: Address, expiry: number): Promise<bigint | null> {
    if (dep.resolver) {
      try {
        const [roundId, found] = await publicClient.readContract({
          address: dep.resolver,
          abi: chainlinkSettlementResolverAbi,
          functionName: 'findRound',
          args: [feed, BigInt(expiry)],
        });
        if (found && roundId > 0n) return roundId;
      } catch {
        /* local search */
      }
    }
    return findRoundLocal(publicClient, feed, expiry);
  }

  async function feedOf(dep: LoadedDep, assetId: Hex, symbol: string): Promise<Address | undefined> {
    const known = feedBySymbol.get(symbol)?.feed;
    if (known) return known;
    const fromManifest = dep.deployment?.assets.find((a) => a.assetId.toLowerCase() === assetId.toLowerCase())?.feed;
    if (fromManifest) return fromManifest;
    if (!dep.oracle) return undefined;
    try {
      const f = await publicClient.readContract({ address: dep.oracle, abi: chainlinkOracleAbi, functionName: 'feedOf', args: [assetId] });
      return f && f !== '0x0000000000000000000000000000000000000000' ? f : undefined;
    } catch {
      return undefined;
    }
  }

  const txResult = (signature: string): TxResult => ({ signature, explorerUrl: meta.explorerTx(signature) });

  interface EventRow {
    eventKey: Hex;
    seriesId: Hex;
    yesId: bigint;
    noId: bigint;
    bookStatus: number;
    info: EventInfo;
  }

  const eventCache = { at: 0, list: [] as EventRow[] };

  async function loadEventRows(force = false): Promise<EventRow[]> {
    const dep = await loadDep();
    if (!dep?.eventResolver) return [];
    if (!force && eventCache.list.length && nowS() - eventCache.at < 20) return eventCache.list;
    const resolver = dep.eventResolver;
    let count = 0n;
    try {
      count = await publicClient.readContract({ address: resolver, abi: eventResolverAbi, functionName: 'eventCount' });
    } catch {
      return [];
    }
    const n = Number(count);
    const out: EventRow[] = [];
    for (let i = 0; i < n; i++) {
      try {
        const eventKey = await publicClient.readContract({ address: resolver, abi: eventResolverAbi, functionName: 'eventKeyAt', args: [BigInt(i)] });
        const view = await publicClient.readContract({ address: resolver, abi: eventResolverAbi, functionName: 'eventInfo', args: [eventKey] });
        const data = await publicClient.readContract({ address: resolver, abi: eventResolverAbi, functionName: 'seriesData', args: [eventKey] });
        const closeTime = Number(view.closeTime);
        const seriesId = keccak256(encodeAbiParameters(SERIES_ID_PARAMS, [resolver, data, BigInt(closeTime)]));
        let yesId = 0n;
        let noId = 0n;
        let bookStatus = 0;
        let volume = 0;
        let bestBid: number | undefined;
        let bestAsk: number | undefined;
        let lastPrice: number | undefined;
        try {
          const info = await dep.client.seriesInfo(seriesId);
          yesId = info.yesId;
          noId = info.noId;
          bookStatus = info.status;
        } catch {
          /* series not created */
        }
        if (bookStatus !== 0) {
          try {
            const bba = await dep.client.bestBidAsk(seriesId);
            if (bba.bidTick > 0) bestBid = bba.bidTick / TICKS;
            if (bba.askTick > 0) bestAsk = bba.askTick / TICKS;
          } catch {
            /* empty */
          }
          try {
            const tick = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'lastTradeTick', args: [seriesId] });
            if (tick > 0) lastPrice = tick / TICKS;
          } catch {
            /* ignore */
          }
          try {
            const v = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'volumeOf', args: [seriesId] });
            volume = Number(v);
          } catch {
            /* 0 */
          }
        }
        const status = eventStatusOf(Number(view.status));
        const outcome: Outcome | undefined = view.outcome === 1 ? 'yes' : view.outcome === 2 ? 'no' : undefined;
        out.push({
          eventKey,
          seriesId,
          yesId,
          noId,
          bookStatus,
          info: {
            id: seriesId,
            key: view.key,
            question: view.question,
            category: eventCategoryOf(view.category),
            rules: view.rules,
            resolutionSource: view.source,
            closeTime,
            status,
            ...(outcome ? { outcome } : {}),
            ...(bestBid !== undefined ? { bestBid } : {}),
            ...(bestAsk !== undefined ? { bestAsk } : {}),
            ...(lastPrice !== undefined ? { lastPrice } : {}),
            volume,
            ...(view.icon ? { icon: view.icon } : {}),
          },
        });
      } catch {
        /* skip one */
      }
    }
    eventCache.list = out;
    eventCache.at = nowS();
    return out;
  }

  async function eventRowOf(eventId: string): Promise<EventRow | undefined> {
    const rows = await loadEventRows();
    const lower = eventId.toLowerCase();
    return rows.find((r) => r.seriesId.toLowerCase() === lower || r.info.key.toLowerCase() === lower || r.eventKey.toLowerCase() === lower);
  }

  const adapter: ChainAdapter = {
    meta,

    async listAssets(): Promise<AssetInfo[]> {
      await loadConfig();
      const ticks = await readOraclePrices().catch(() => assets.map((f) => priceCache.get(f.symbol) ?? { price: 0, time: 0 }));
      return assets.map((f, i) => {
        const t = ticks[i] ?? priceCache.get(f.symbol) ?? { price: 0, time: 0 };
        const category = categoryOf(f.tier);
        const offchain = category !== 'crypto';
        if (offchain && !(t.price > 0)) return null; // feed deployed but no price pushed yet
        return {
          symbol: f.symbol, name: f.name, price: t.price, priceTime: t.time, strikeStep: f.strikeStep, vol: f.vol,
          category,
          ...(offchain ? { oracleNote: 'Keeper-reported demo oracle · US market hours', marketClosed: usMarketClosed() } : {}),
        };
      }).filter((a): a is NonNullable<typeof a> => a !== null);
    },

    subscribePrices(onPrice) {
      let stopped = false;
      const last = new Map<string, PriceTick>();
      const poll = async () => {
        if (stopped) return;
        try {
          const ticks = await readOraclePrices();
          assets.forEach((f, i) => {
            const t = ticks[i];
            if (!t || !(t.price > 0)) return;
            const prev = last.get(f.symbol);
            if (prev && prev.price === t.price && prev.time === t.time) return;
            last.set(f.symbol, t);
            onPrice(f.symbol, t.price, t.time);
          });
        } catch {
          /* keep last */
        }
      };
      void poll();
      const timer = setInterval(() => void poll(), 10_000);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },

    async strikes(symbol) {
      const list = await indexSeries();
      const now = nowS();
      const ks = [
        ...new Set(
          list.filter((s) => s.symbol === symbol && s.status === 'open' && s.expiry > now).map((s) => s.strike),
        ),
      ].sort((a, b) => a - b);
      return ks;
    },

    async expiries(symbol): Promise<ExpiryOption[]> {
      const list = await indexSeries();
      const now = nowS();
      const map = new Map<number, ExpiryOption>();
      for (const s of list) {
        if (s.symbol !== symbol || s.status !== 'open' || s.expiry <= now) continue;
        const tag = expiryTag(s.expiry);
        map.set(s.expiry, { expiry: s.expiry, hasMarkets: true, ...(tag ? { tag } : {}) });
      }
      return [...map.values()].sort((a, b) => a.expiry - b.expiry);
    },

    async getMarket(symbol, strike, expiry): Promise<MarketInfo | null> {
      const s = await seriesOf(symbol, strike, expiry);
      if (!s) return null;
      const dep = await requireDep();
      let bids: BookLevel[] = [];
      let asks: BookLevel[] = [];
      let lastPrice: number | undefined;
      let volume = 0;
      if (s.status === 'open') {
        try {
          const depth = await dep.client.orderBookDepth(s.id, 12);
          bids = depth.bids.map((l) => ({ price: l.tick / TICKS, qty: Number(l.qty) }));
          asks = depth.asks.map((l) => ({ price: l.tick / TICKS, qty: Number(l.qty) }));
        } catch {
          /* empty book */
        }
      }
      try {
        const tick = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'lastTradeTick', args: [s.id] });
        if (tick > 0) lastPrice = tick / TICKS;
      } catch {
        if (s.snap?.lastTick) lastPrice = s.snap.lastTick / TICKS;
      }
      try {
        const v = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'volumeOf', args: [s.id] });
        volume = Number(v);
      } catch {
        /* 0 */
      }
      let settlePrice: number | undefined;
      if ((s.status === 'resolved' || s.status === 'void') && dep.resolver) {
        try {
          if (oracleKind === 'hypercore') {
            const rec = (await publicClient.readContract({
              address: dep.resolver,
              abi: hypercoreResolverAbi,
              functionName: 'settlementOf',
              args: [s.assetId, BigInt(s.expiry)],
            })) as readonly [boolean, bigint, bigint];
            if (rec[0] && rec[1] > 0n) settlePrice = wadToUsd(rec[1]);
          } else {
            const rec = await publicClient.readContract({
              address: dep.resolver,
              abi: chainlinkSettlementResolverAbi,
              functionName: 'settlementOf',
              args: [s.assetId, BigInt(s.expiry)],
            });
            if (rec[0] && rec[1] > 0n) settlePrice = wadToUsd(rec[1]);
          }
        } catch {
          /* ignore */
        }
      }
      return {
        id: s.id,
        symbol,
        strike: s.strike,
        expiry: s.expiry,
        status: s.status,
        ...(s.outcome ? { outcome: s.outcome } : {}),
        ...(settlePrice !== undefined ? { settlePrice } : {}),
        bids,
        asks,
        ...(lastPrice !== undefined ? { lastPrice } : {}),
        volume,
      };
    },

    async quote(symbol, strike, expiry, direction, budget): Promise<Quote> {
      const outcome: Outcome = direction === 'above' ? 'yes' : 'no';
      const now = nowS();
      const chance0 = chanceOf(undefined, symbol, strike, expiry, outcome);
      if (!(await loadDep())) return emptyQuote(outcome, budget, chance0, missing, true);
      let s: IndexedSeries | undefined;
      try {
        s = await seriesOf(symbol, strike, expiry);
      } catch (e) {
        const msg = friendly(e);
        return emptyQuote(outcome, budget, chance0, msg, msg.includes(missing));
      }
      const chance = chanceOf(s, symbol, strike, expiry, outcome);
      if (!(budget > 0)) return emptyQuote(outcome, budget, chance, 'Enter an amount');
      if (expiry <= now) return emptyQuote(outcome, budget, chance, 'Market closed');
      if (!s || s.status !== 'open') {
        return emptyQuote(outcome, budget, chance, 'No market at this strike yet', true);
      }
      const dep = await requireDep();
      try {
        const paused = await publicClient.readContract({ address: dep.book, abi: bookExtraAbi, functionName: 'paused' }).catch(() => false);
        if (paused) return emptyQuote(outcome, budget, chance, 'Trading is paused');
        const depth = await dep.client.orderBookDepth(s.id, 99);
        const levels = outcome === 'yes' ? depth.asks : depth.bids;
        const walked = walkBudget(levels, outcome === 'yes', budget, 99);
        if (walked.contracts === 0n) {
          const first = levels[0];
          const p = first ? (outcome === 'yes' ? first.tick : TICKS - first.tick) / TICKS : 0;
          return emptyQuote(
            outcome,
            budget,
            chance,
            first ? `Budget is below one contract (${Math.round(p * 100)}¢)` : 'No liquidity at this strike yet',
          );
        }
        const contracts = Number(walked.contracts);
        const cost = usd(walked.cost);
        const avgPrice = contracts > 0 ? cost / contracts : 0;
        const limitPrice = walked.worstTick / TICKS;
        return {
          outcome,
          budget,
          contracts,
          avgPrice,
          limitPrice,
          cost,
          payout: contracts,
          chance,
          needsMarket: false,
          tradable: true,
        };
      } catch (e) {
        return emptyQuote(outcome, budget, chance, friendly(e));
      }
    },

    walletOptions(): WalletOption[] {
      const found = listInjected().map((w) => ({ id: w.id, name: w.name, ...(w.icon ? { icon: w.icon } : {}), installed: true }));
      const missing = KNOWN_WALLETS.filter(
        (k) => !found.some((f) => f.id.toLowerCase().includes(k.id) || f.name.toLowerCase().includes(k.name.toLowerCase().split(' ')[0]!)),
      ).map((k) => ({ id: k.id, name: k.name, installed: false }));
      const addr = burnerPreview();
      const fundHint = `${seed.chainName} ${seed.nativeSymbol}`;
      const burnerName = addr ? `Burner ${shortAddr(addr)} · fund with ${fundHint}` : `Burner · fund with ${fundHint}`;
      return [...found, { id: BURNER_ID, name: burnerName, installed: true }, ...missing];
    },

    async connect(walletId?: string) {
      startDiscovery();
      const injected = listInjected();
      const id = walletId ?? injected[0]?.id ?? BURNER_ID;
      if (walletHub.current?.kind === 'injected') walletHub.current.off?.();
      if (id === BURNER_ID) {
        const account = loadBurner();
        walletHub.current = { kind: 'burner', account };
        hubEmit();
        return account.address;
      }
      const w = injected.find((x) => x.id === id || x.name === id);
      if (!w) throw new Error(`${id} wallet not found in this browser`);
      await ensureChain(w.provider);
      const accounts = (await w.provider.request({ method: 'eth_requestAccounts' })) as string[];
      const raw = accounts[0];
      if (!raw || !isAddress(raw)) throw new Error(`${w.name} returned no account`);
      const account = getAddress(raw);
      await ensureChain(w.provider);
      const onAccounts = (...a: unknown[]) => {
        const list = (a[0] as string[] | undefined) ?? [];
        if (!list.length) {
          walletHub.current = null;
          hubEmit();
          return;
        }
        const next = list[0];
        if (!next || !isAddress(next) || walletHub.current?.kind !== 'injected' || walletHub.current.id !== w.id) return;
        const addr = getAddress(next);
        walletHub.current = { ...walletHub.current, account: addr };
        hubEmit();
      };
      const onChain = () => hubEmit();
      w.provider.on?.('accountsChanged', onAccounts);
      w.provider.on?.('chainChanged', onChain);
      const off = () => {
        w.provider.removeListener?.('accountsChanged', onAccounts);
        w.provider.removeListener?.('chainChanged', onChain);
      };
      walletHub.current = { kind: 'injected', id: w.id, account, provider: w.provider, off };
      hubEmit();
      return account;
    },

    async disconnect() {
      if (walletHub.current?.kind === 'injected') walletHub.current.off?.();
      walletHub.current = null;
      hubEmit();
    },

    address: () => currentAddress(),

    onAccountChange(cb) {
      walletHub.listeners.add(cb);
      return () => walletHub.listeners.delete(cb);
    },

    async balances(): Promise<Balances> {
      const a = currentAddress();
      if (!a) return { native: 0, collateral: 0 };
      const addr = getAddress(a);
      const native = await publicClient.getBalance({ address: addr }).catch(() => 0n);
      const dep = await loadDep();
      if (!dep) return { native: Number(native) / 1e18, collateral: 0 };
      const [erc20, cash] = await Promise.all([
        dep.client.collateralBalance(addr).catch(() => 0n),
        dep.client.cashBalances(addr).catch(() => ({ free: 0n, locked: 0n })),
      ]);
      return { native: Number(native) / 1e18, collateral: usd(erc20 + cash.free) };
    },

    async faucet(): Promise<TxResult> {
      const dep = await requireDep();
      const w = requireWallet();
      await ensureInjected();
      const native = await publicClient.getBalance({ address: w.address }).catch(() => 0n);
      if (native === 0n) {
        throw new Error(
          `Not enough ${seed.nativeSymbol} for gas. Fund ${shortAddr(w.address)} with ${seed.chainName} ${seed.nativeSymbol}, then retry.`,
        );
      }
      const hash = await write(w.walletClient, w.account, {
        address: dep.collateral,
        abi: erc20Abi,
        functionName: 'faucet',
      });
      return txResult(hash);
    },

    async buy(p: BuyParams): Promise<BuyResult> {
      const dep = await requireDep();
      const w = requireWallet();
      await ensureInjected();
      const outcome: Outcome = p.direction === 'above' ? 'yes' : 'no';
      const s = await seriesOf(p.symbol, p.strike, p.expiry);
      if (!s || s.status !== 'open') throw new Error('No market at this strike yet');
      if (s.expiry <= nowS()) throw new Error('This market is closed for trading.');
      const client = dep.client;
      const maxTick = priceToLimitTick(p.maxPrice);
      const depth = await client.orderBookDepth(s.id, 99);
      const levels = outcome === 'yes' ? depth.asks : depth.bids;
      const walked = walkBudget(levels, outcome === 'yes', p.budget, maxTick);
      if (walked.contracts === 0n) throw new Error('The price moved past your limit. Refresh the quote and try again.');
      const qty = walked.contracts;
      const yesTick = outcome === 'yes' ? maxTick : Math.max(1, TICKS - maxTick);
      const escrow = outcome === 'yes' ? qty * BigInt(yesTick) * TICK_UNIT : qty * BigInt(TICKS - yesTick) * TICK_UNIT;
      const feeBps = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'takerFeeBps' }).catch(() => 0);
      const need = escrow + ceilBps(escrow, Number(feeBps)) + 1n;
      const [native, erc20, cash, allowance] = await Promise.all([
        publicClient.getBalance({ address: w.address }),
        client.collateralBalance(w.address),
        client.cashBalances(w.address),
        publicClient.readContract({
          address: dep.collateral,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [w.address, dep.book],
        }),
      ]);
      if (native === 0n) {
        throw new Error(`Not enough ${seed.nativeSymbol} for gas. Fund ${shortAddr(w.address)} with ${seed.chainName} ${seed.nativeSymbol}, then retry.`);
      }
      const deposit = need > cash.free ? need - cash.free : 0n;
      if (erc20 + cash.free < need) {
        throw new Error(
          `Insufficient tUSDC: this order escrows $${usd(need).toFixed(2)} (you have $${usd(erc20 + cash.free).toFixed(2)}). Use the faucet.`,
        );
      }
      const order: PlaceOrderParams = {
        seriesId: s.id,
        side: outcome === 'yes' ? 'bid' : 'ask',
        tick: yesTick,
        qty,
        fromHeld: false,
        tif: 'ioc',
        maxFills: 0,
      };
      const before = await client.positions(s.id, w.address);
      let hash: Hash;
      const orderCall = placeCall(order);
      if (deposit === 0n) {
        hash = await write(w.walletClient, w.account, {
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'placeOrder',
          args: [{ seriesId: order.seriesId, side: outcome === 'yes' ? 0 : 1, tick: yesTick, qty, fromHeld: false, tif: 1, maxFills: 0 }],
        });
      } else if (allowance >= deposit) {
        hash = await write(w.walletClient, w.account, {
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'multicall',
          args: [[encodeFunctionData({ abi: montionsBookAbi, functionName: 'deposit', args: [deposit] }), orderCall]],
        });
      } else {
        try {
          const permit = await signPermit(dep.collateral, dep.book, w.address, deposit, w.walletClient, w.account);
          hash = await write(w.walletClient, w.account, {
            address: dep.book,
            abi: montionsBookAbi,
            functionName: 'multicall',
            args: [[encodeDepositWithPermit(deposit, permit), orderCall]],
          });
        } catch (e) {
          if (isUserRejection(e)) throw e;
          await write(w.walletClient, w.account, {
            address: dep.collateral,
            abi: erc20Abi,
            functionName: 'approve',
            args: [dep.book, deposit],
          });
          hash = await write(w.walletClient, w.account, {
            address: dep.book,
            abi: montionsBookAbi,
            functionName: 'multicall',
            args: [[encodeFunctionData({ abi: montionsBookAbi, functionName: 'deposit', args: [deposit] }), orderCall]],
          });
        }
      }
      seriesCache.at = 0;
      const after = await client.positions(s.id, w.address).catch(() => null);
      let contracts = Number(qty);
      let cost = usd(walked.cost);
      if (after) {
        contracts = Number(outcome === 'yes' ? after.yes - before.yes : after.no - before.no);
        const spent = before.cash + deposit - after.cash;
        if (spent > 0n) cost = usd(spent);
      }
      if (contracts <= 0) {
        throw new Error('Nothing filled: the price moved beyond your limit. You were not charged.');
      }
      return { ...txResult(hash), marketId: s.id, contracts, cost };
    },

    async positions(): Promise<Position[]> {
      const a = currentAddress();
      if (!a) return [];
      const dep = await loadDep();
      if (!dep) return [];
      const owner = getAddress(a);
      const list = await indexSeries().catch(() => [] as IndexedSeries[]);
      if (!list.length) return [];
      const qtyById = new Map<string, { yes: bigint; no: bigint }>();
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const ids = chunk.flatMap((s) => [s.yesId, s.noId]);
        let bals: readonly bigint[];
        try {
          bals = await publicClient.readContract({
            address: dep.book,
            abi: bookExtraAbi,
            functionName: 'balanceOfBatch',
            args: [ids.map(() => owner), ids],
          });
        } catch {
          bals = await Promise.all(
            ids.map((id) =>
              publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'balanceOf', args: [owner, id] }).catch(() => 0n),
            ),
          );
        }
        chunk.forEach((s, j) => {
          qtyById.set(s.id, { yes: bals[2 * j] ?? 0n, no: bals[2 * j + 1] ?? 0n });
        });
      }
      const out: Position[] = [];
      for (const s of list) {
        const q = qtyById.get(s.id);
        const yesQty = q?.yes ?? 0n;
        const noQty = q?.no ?? 0n;
        if (yesQty === 0n && noQty === 0n) continue;
        let yesMark: number;
        let noMark: number;
        if (s.status === 'resolved') {
          yesMark = s.outcome === 'yes' ? 1 : 0;
          noMark = s.outcome === 'no' ? 1 : 0;
        } else if (s.status === 'void') {
          yesMark = 0.5;
          noMark = 0.5;
        } else {
          const bid = s.snap?.bidTick ?? 0;
          const ask = s.snap?.askTick ?? 0;
          const model = chanceOf(s, s.symbol, s.strike, s.expiry, 'yes');
          yesMark = bid > 0 ? bid / TICKS : model;
          noMark = ask > 0 ? (TICKS - ask) / TICKS : 1 - model;
        }
        const push = (outcome: Outcome, contracts: bigint, mark: number) => {
          if (contracts <= 0n) return;
          const n = Number(contracts);
          const won = s.status === 'resolved' ? (outcome === 'yes') === (s.outcome === 'yes') : undefined;
          const claimable =
            s.status === 'resolved' ? (won ? n : 0) : s.status === 'void' ? n * 0.5 : 0;
          out.push({
            marketId: s.id,
            symbol: s.symbol,
            strike: s.strike,
            expiry: s.expiry,
            outcome,
            contracts: n,
            mark,
            status: s.status,
            claimable,
            ...(won !== undefined ? { won } : {}),
          });
        };
        if (s.status === 'open' && (!s.snap || (s.snap.bidTick === 0 && s.snap.askTick === 0))) {
          try {
            const bba = await dep.client.bestBidAsk(s.id);
            if (s.status === 'open') {
              if (bba.bidTick > 0) yesMark = bba.bidTick / TICKS;
              if (bba.askTick > 0) noMark = (TICKS - bba.askTick) / TICKS;
            }
          } catch {
            /* keep model */
          }
        }
        push('yes', yesQty, yesMark);
        push('no', noQty, noMark);
      }
      try {
        const events = await loadEventRows();
        for (const ev of events) {
          if (ev.yesId === 0n && ev.noId === 0n) continue;
          let yes = 0n;
          let no = 0n;
          try {
            const bals = await publicClient.readContract({
              address: dep.book,
              abi: bookExtraAbi,
              functionName: 'balanceOfBatch',
              args: [[owner, owner], [ev.yesId, ev.noId]],
            });
            yes = bals[0] ?? 0n;
            no = bals[1] ?? 0n;
          } catch {
            continue;
          }
          if (yes === 0n && no === 0n) continue;
          const st = ev.info.status === 'resolved' ? 'resolved' : ev.info.status === 'void' ? 'void' : ev.info.status === 'open' ? 'open' : 'open';
          const yesMark = ev.info.bestBid ?? (ev.info.status === 'resolved' ? (ev.info.outcome === 'yes' ? 1 : 0) : 0.5);
          const noMark = ev.info.bestAsk !== undefined ? 1 - ev.info.bestAsk : 1 - yesMark;
          const pushEv = (outcome: Outcome, contracts: bigint, mark: number) => {
            if (contracts <= 0n) return;
            const n = Number(contracts);
            const won = ev.info.status === 'resolved' ? (outcome === 'yes') === (ev.info.outcome === 'yes') : undefined;
            const claimable = ev.info.status === 'resolved' ? (won ? n : 0) : ev.info.status === 'void' ? n * 0.5 : 0;
            out.push({
              kind: 'event',
              question: ev.info.question,
              marketId: ev.seriesId,
              symbol: ev.info.key,
              strike: 0,
              expiry: ev.info.closeTime,
              outcome,
              contracts: n,
              mark,
              status: st,
              claimable,
              ...(won !== undefined ? { won } : {}),
            });
          };
          pushEv('yes', yes, yesMark);
          pushEv('no', no, noMark);
        }
      } catch {
        /* events optional */
      }
      return out;
    },

    async claim(marketId: string): Promise<TxResult> {
      const dep = await requireDep();
      const w = requireWallet();
      await ensureInjected();
      const id = asSeriesId(marketId);
      const client = dep.client;
      const info = await client.seriesInfo(id);
      if (info.status === 0) throw new Error('Market not found');
      if (info.status === 1) {
        if (nowS() <= Number(info.expiry)) throw new Error('This market has not expired yet.');
        const decoded = decodeSeriesData(info.data);
        const symbol = decoded ? idToSymbol.get(decoded.assetId.toLowerCase()) ?? '?' : '?';
        if (oracleKind === 'hypercore' && dep.resolver && decoded) {
          const recorded = await publicClient
            .readContract({
              address: dep.resolver,
              abi: hypercoreResolverAbi,
              functionName: 'isRecorded',
              args: [decoded.assetId, info.expiry],
            })
            .catch(() => false);
          if (!recorded) {
            try {
              await write(w.walletClient, w.account, {
                address: dep.resolver,
                abi: hypercoreResolverAbi,
                functionName: 'record',
                args: [decoded.assetId, info.expiry],
              });
            } catch (e) {
              if (revertName(e) !== 'AlreadyRecorded' && nowS() < Number(info.expiry) + VOID_GRACE) {
                throw new Error(friendly(e));
              }
            }
          }
        } else {
          const feed = decoded ? await feedOf(dep, decoded.assetId, symbol) : undefined;
          if (dep.resolver && feed) {
            const recorded = await publicClient
              .readContract({ address: dep.resolver, abi: chainlinkSettlementResolverAbi, functionName: 'isRecorded', args: [feed, info.expiry] })
              .catch(() => false);
            if (!recorded) {
              const hint = await hintRound(dep, feed, Number(info.expiry));
              if (hint != null) {
                try {
                  await write(w.walletClient, w.account, {
                    address: dep.resolver,
                    abi: chainlinkSettlementResolverAbi,
                    functionName: 'record',
                    args: [feed, info.expiry, hint],
                  });
                } catch (e) {
                  if (revertName(e) !== 'AlreadyRecorded') {
                    const named = revertName(e);
                    if (named !== 'AlreadyRecorded' && nowS() < Number(info.expiry) + VOID_GRACE) {
                      throw new Error(friendly(e));
                    }
                  }
                }
              } else if (nowS() < Number(info.expiry) + VOID_GRACE) {
                throw new Error('Waiting for the first Chainlink round at or after expiry. Try again in a few minutes.');
              }
            }
          }
        }
      }
      const fresh = await client.seriesInfo(id);
      if (fresh.status === 1) {
        try {
          await write(w.walletClient, w.account, { address: dep.book, abi: montionsBookAbi, functionName: 'resolve', args: [id] });
        } catch (e) {
          throw new Error(friendly(e));
        }
      }
      const settled = await client.seriesInfo(id);
      if (settled.status === 1) throw new Error('This market has not settled yet.');
      const after = await client.positions(id, w.address);
      const yesQty = after.yes;
      const noQty = after.no;
      const cash = await client.cashBalances(w.address);
      let payout = 0n;
      if (settled.status === 3) payout = ((yesQty + noQty) * UNIT) / 2n;
      else payout = (settled.yes ? yesQty : 0n) * UNIT + (settled.yes ? 0n : noQty) * UNIT;
      if (yesQty === 0n && noQty === 0n && cash.free === 0n) throw new Error('Nothing to claim for this market yet');
      const calls: Hex[] = [];
      if (yesQty > 0n || noQty > 0n) {
        calls.push(encodeFunctionData({ abi: montionsBookAbi, functionName: 'redeem', args: [id, yesQty, noQty] }));
      }
      const withdrawAmt = cash.free + payout;
      if (withdrawAmt > 0n) {
        calls.push(encodeFunctionData({ abi: montionsBookAbi, functionName: 'withdraw', args: [withdrawAmt] }));
      }
      if (!calls.length) throw new Error('Nothing to claim for this market yet');
      const hash = await write(w.walletClient, w.account, {
        address: dep.book,
        abi: montionsBookAbi,
        functionName: 'multicall',
        args: [calls],
      });
      seriesCache.at = 0;
      return txResult(hash);
    },

    async sell(marketId, outcome, contracts, minPrice): Promise<TxResult> {
      const dep = await requireDep();
      const w = requireWallet();
      await ensureInjected();
      if (!(contracts > 0)) throw new Error('Nothing to sell');
      const id = asSeriesId(marketId);
      const client = dep.client;
      const info = await client.seriesInfo(id);
      if (info.status !== 1) throw new Error('This market is closed for trading.');
      const qty = BigInt(Math.floor(contracts));
      const minTick = priceToLimitTick(minPrice);
      const pos = await client.positions(id, w.address);
      const held = outcome === 'yes' ? pos.yes : pos.no;
      if (held < qty) throw new Error("You don't hold enough of that position.");
      const order: PlaceOrderParams =
        outcome === 'yes'
          ? { seriesId: id, side: 'ask', tick: minTick, qty, fromHeld: true, tif: 'ioc', maxFills: 0 }
          : { seriesId: id, side: 'bid', tick: Math.max(1, TICKS - minTick), qty, fromHeld: true, tif: 'ioc', maxFills: 0 };
      let hash: Hash;
      try {
        if (outcome === 'no') {
          const yesTick = Math.max(1, TICKS - minTick);
          const escrow = qty * BigInt(yesTick) * TICK_UNIT;
          const feeBps = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'takerFeeBps' }).catch(() => 0);
          const need = escrow + ceilBps(escrow, Number(feeBps)) + 1n;
          const [erc20, cash] = await Promise.all([client.collateralBalance(w.address), client.cashBalances(w.address)]);
          const deposit = need > cash.free ? need - cash.free : 0n;
          if (deposit > 0n) {
            if (erc20 < deposit) {
              throw new Error(
                `Selling NO temporarily locks $${usd(need).toFixed(2)} of tUSDC (you have $${usd(erc20 + cash.free).toFixed(2)}). Use the faucet.`,
              );
            }
            const allowance = await publicClient.readContract({
              address: dep.collateral,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [w.address, dep.book],
            });
            if (allowance < deposit) {
              await write(w.walletClient, w.account, {
                address: dep.collateral,
                abi: erc20Abi,
                functionName: 'approve',
                args: [dep.book, deposit],
              });
            }
            await write(w.walletClient, w.account, {
              address: dep.book,
              abi: montionsBookAbi,
              functionName: 'deposit',
              args: [deposit],
            });
          }
        }
        hash = await write(w.walletClient, w.account, {
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'placeOrder',
          args: [
            {
              seriesId: order.seriesId,
              side: outcome === 'yes' ? 1 : 0,
              tick: order.tick,
              qty,
              fromHeld: true,
              tif: 1,
              maxFills: 0,
            },
          ],
        });
      } catch (e) {
        throw new Error(friendly(e));
      }
      const after = await client.positions(id, w.address).catch(() => null);
      if (after) {
        const sold = Number((outcome === 'yes' ? pos.yes : pos.no) - (outcome === 'yes' ? after.yes : after.no));
        if (sold <= 0) throw new Error('The price moved past your limit. Refresh and try again.');
      }
      return txResult(hash);
    },

    async getBook(marketId) {
      const dep = await requireDep();
      const id = asSeriesId(marketId);
      let bids: BookLevel[] = [];
      let asks: BookLevel[] = [];
      try {
        const depth = await dep.client.orderBookDepth(id, 24);
        bids = depth.bids.map((l) => ({ price: l.tick / TICKS, qty: Number(l.qty) }));
        asks = depth.asks.map((l) => ({ price: l.tick / TICKS, qty: Number(l.qty) }));
      } catch {
        /* empty */
      }
      const trades: { time: number; price: number; qty: number; takerBuy: boolean }[] = [];
      try {
        const tick = await publicClient.readContract({
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'lastTradeTick',
          args: [id],
        });
        if (tick > 0) {
          trades.push({ time: nowS(), price: tick / TICKS, qty: 0, takerBuy: true });
        }
      } catch {
        /* no last trade */
      }
      return { bids, asks, trades };
    },

    async listEvents(): Promise<EventInfo[]> {
      const rows = await loadEventRows();
      return rows.map((r) => r.info);
    },

    async quoteEvent(eventId, outcome, budget): Promise<EventQuote> {
      const row = await eventRowOf(eventId);
      if (!row) return emptyEventQuote(outcome, budget, 'Event not listed on this chain');
      if (row.info.status !== 'open' || row.info.closeTime <= nowS()) {
        return emptyEventQuote(outcome, budget, 'This event is closed for trading');
      }
      if (!(budget > 0)) return emptyEventQuote(outcome, budget, 'Enter an amount');
      const dep = await requireDep();
      try {
        const depth = await dep.client.orderBookDepth(row.seriesId, 99);
        const levels = outcome === 'yes' ? depth.asks : depth.bids;
        const walked = walkBudget(levels, outcome === 'yes', budget, 99);
        if (walked.contracts === 0n) {
          const first = levels[0];
          return emptyEventQuote(
            outcome,
            budget,
            first ? `Budget is below one contract` : 'No liquidity on this event yet',
          );
        }
        const contracts = Number(walked.contracts);
        const cost = usd(walked.cost);
        return {
          outcome,
          budget,
          contracts,
          avgPrice: contracts > 0 ? cost / contracts : 0,
          limitPrice: walked.worstTick / TICKS,
          cost,
          payout: contracts,
          tradable: true,
        };
      } catch (e) {
        return emptyEventQuote(outcome, budget, friendly(e));
      }
    },

    async buyEvent(eventId, outcome, budget, maxPrice): Promise<BuyResult> {
      const row = await eventRowOf(eventId);
      if (!row || row.info.status !== 'open') throw new Error('Event not listed on this chain');
      if (row.info.closeTime <= nowS()) throw new Error('This event is closed for trading');
      const dep = await requireDep();
      const w = requireWallet();
      await ensureInjected();
      const maxTick = priceToLimitTick(maxPrice);
      const depth = await dep.client.orderBookDepth(row.seriesId, 99);
      const levels = outcome === 'yes' ? depth.asks : depth.bids;
      const walked = walkBudget(levels, outcome === 'yes', budget, maxTick);
      if (walked.contracts === 0n) throw new Error('The price moved past your limit. Refresh the quote and try again.');
      const qty = walked.contracts;
      const yesTick = outcome === 'yes' ? maxTick : Math.max(1, TICKS - maxTick);
      const escrow = outcome === 'yes' ? qty * BigInt(yesTick) * TICK_UNIT : qty * BigInt(TICKS - yesTick) * TICK_UNIT;
      const feeBps = await publicClient.readContract({ address: dep.book, abi: montionsBookAbi, functionName: 'takerFeeBps' }).catch(() => 0);
      const need = escrow + ceilBps(escrow, Number(feeBps)) + 1n;
      const [native, erc20, cash, allowance] = await Promise.all([
        publicClient.getBalance({ address: w.address }),
        dep.client.collateralBalance(w.address),
        dep.client.cashBalances(w.address),
        publicClient.readContract({ address: dep.collateral, abi: erc20Abi, functionName: 'allowance', args: [w.address, dep.book] }),
      ]);
      if (native === 0n) {
        throw new Error(`Not enough ${seed.nativeSymbol} for gas. Fund ${shortAddr(w.address)} with ${seed.chainName} ${seed.nativeSymbol}, then retry.`);
      }
      const deposit = need > cash.free ? need - cash.free : 0n;
      if (erc20 + cash.free < need) {
        throw new Error(`Insufficient tUSDC: this order escrows $${usd(need).toFixed(2)}. Use the faucet.`);
      }
      const order: PlaceOrderParams = {
        seriesId: row.seriesId,
        side: outcome === 'yes' ? 'bid' : 'ask',
        tick: yesTick,
        qty,
        fromHeld: false,
        tif: 'ioc',
        maxFills: 0,
      };
      const before = await dep.client.positions(row.seriesId, w.address);
      let hash: Hash;
      const orderCall = placeCall(order);
      if (deposit === 0n) {
        hash = await write(w.walletClient, w.account, {
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'placeOrder',
          args: [{ seriesId: order.seriesId, side: outcome === 'yes' ? 0 : 1, tick: yesTick, qty, fromHeld: false, tif: 1, maxFills: 0 }],
        });
      } else if (allowance >= deposit) {
        hash = await write(w.walletClient, w.account, {
          address: dep.book,
          abi: montionsBookAbi,
          functionName: 'multicall',
          args: [[encodeFunctionData({ abi: montionsBookAbi, functionName: 'deposit', args: [deposit] }), orderCall]],
        });
      } else {
        try {
          const permit = await signPermit(dep.collateral, dep.book, w.address, deposit, w.walletClient, w.account);
          hash = await write(w.walletClient, w.account, {
            address: dep.book,
            abi: montionsBookAbi,
            functionName: 'multicall',
            args: [[encodeDepositWithPermit(deposit, permit), orderCall]],
          });
        } catch (e) {
          if (isUserRejection(e)) throw e;
          await write(w.walletClient, w.account, {
            address: dep.collateral,
            abi: erc20Abi,
            functionName: 'approve',
            args: [dep.book, deposit],
          });
          hash = await write(w.walletClient, w.account, {
            address: dep.book,
            abi: montionsBookAbi,
            functionName: 'multicall',
            args: [[encodeFunctionData({ abi: montionsBookAbi, functionName: 'deposit', args: [deposit] }), orderCall]],
          });
        }
      }
      const after = await dep.client.positions(row.seriesId, w.address).catch(() => null);
      let contracts = Number(qty);
      let cost = usd(walked.cost);
      if (after) {
        contracts = Number(outcome === 'yes' ? after.yes - before.yes : after.no - before.no);
        const spent = before.cash + deposit - after.cash;
        if (spent > 0n) cost = usd(spent);
      }
      if (contracts <= 0) throw new Error('Nothing filled: the price moved beyond your limit. You were not charged.');
      return { ...txResult(hash), marketId: row.seriesId, contracts, cost };
    },
  };

  return adapter;
}

export function createBaseAdapter(opts: EvmAdapterOptions = {}): ChainAdapter {
  return createEvmAdapter('base-sepolia', opts);
}

export default createEvmAdapter;
