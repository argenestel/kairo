import { getAddress, isAddress, type Address } from "viem";

/** Oracle family declared in `config/chains.json`. */
export type ChainOracleKind = "chainlink" | "hypercore";

export interface ChainNativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainL2Config {
  stack: string;
  gasOracle?: Address;
}

/** One asset in a chain entry. Chainlink assets have `feed`; HyperCore assets have `perpIndex` + `szDecimals`. */
export interface ChainAssetConfig {
  symbol: string;
  display?: string;
  name?: string;
  quote: string;
  ladder: boolean;
  strikeStep: number;
  tier?: string;
  settleDelay: number;
  feed?: Address;
  description?: string;
  decimals?: number;
  heartbeat?: number;
  maxStaleness?: number;
  volWad?: string;
  perpIndex?: number;
  szDecimals?: number;
}

export interface ChainEntry {
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  oracle: ChainOracleKind;
  network?: "local" | "testnet" | "mainnet";
  nativeCurrency: ChainNativeCurrency;
  budgetWei?: string;
  l2?: ChainL2Config;
  oraclePrecompile?: Address;
  infoUrl?: string;
  assets: ChainAssetConfig[];
}

export interface ExpirySchedule {
  hourUtc: number;
  minuteUtc: number;
  horizons: readonly string[];
}

export interface ChainsConfig {
  canonicalAssets: string[];
  strikeCount: number;
  strikeGrids: Record<string, number>;
  expirySchedule: ExpirySchedule;
  notes?: string;
  chains: ChainEntry[];
}

function invalid(message: string): never {
  throw new Error(`Invalid chains.json: ${message}`);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    invalid(`${field} must be a positive number`);
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${field} must be a non-empty string`);
  return value;
}

function optionalAddress(value: unknown, field: string): Address | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isAddress(value)) invalid(`${field} must be an EVM address`);
  return getAddress(value);
}

function parseAsset(value: unknown, index: string, oracle: ChainOracleKind): ChainAssetConfig {
  if (value === null || typeof value !== "object") invalid(`${index} must be an object`);
  const raw = value as Record<string, unknown>;
  const symbol = nonEmptyString(raw.symbol, `${index}.symbol`);
  const quote = typeof raw.quote === "string" && raw.quote.length > 0 ? raw.quote : "USD";
  const ladder = raw.ladder === undefined ? false : Boolean(raw.ladder);
  const strikeStep = positiveNumber(raw.strikeStep, `${index}.strikeStep`);
  const settleDelay = positiveInteger(raw.settleDelay, `${index}.settleDelay`);
  if (settleDelay === 0) invalid(`${index}.settleDelay must be positive`);
  const asset: ChainAssetConfig = {
    symbol,
    quote,
    ladder,
    strikeStep,
    settleDelay,
    ...(typeof raw.display === "string" ? { display: raw.display } : {}),
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(typeof raw.tier === "string" ? { tier: raw.tier } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(typeof raw.volWad === "string" ? { volWad: raw.volWad } : {}),
  };
  if (raw.decimals !== undefined) asset.decimals = positiveInteger(raw.decimals, `${index}.decimals`);
  if (raw.heartbeat !== undefined) asset.heartbeat = positiveInteger(raw.heartbeat, `${index}.heartbeat`);
  if (raw.maxStaleness !== undefined) asset.maxStaleness = positiveInteger(raw.maxStaleness, `${index}.maxStaleness`);
  const feed = optionalAddress(raw.feed, `${index}.feed`);
  if (feed) asset.feed = feed;
  if (raw.perpIndex !== undefined) asset.perpIndex = positiveInteger(raw.perpIndex, `${index}.perpIndex`);
  if (raw.szDecimals !== undefined) asset.szDecimals = positiveInteger(raw.szDecimals, `${index}.szDecimals`);
  const keeperTier = typeof raw.tier === "string"
    && ["stock", "etf", "commodity"].includes(raw.tier.toLowerCase());
  if (oracle === "chainlink") {
    // Equities are keeper-reported: feed is filled after KeeperFeedHub deploy.
    if (!asset.feed && !keeperTier) invalid(`${index}.feed is required for oracle "chainlink"`);
    if (asset.decimals === undefined) invalid(`${index}.decimals is required for oracle "chainlink"`);
  }
  if (oracle === "hypercore") {
    if (asset.perpIndex === undefined) invalid(`${index}.perpIndex is required for oracle "hypercore"`);
    if (asset.szDecimals === undefined) invalid(`${index}.szDecimals is required for oracle "hypercore"`);
  }
  return asset;
}

function parseChain(value: unknown, index: string): ChainEntry {
  if (value === null || typeof value !== "object") invalid(`${index} must be an object`);
  const raw = value as Record<string, unknown>;
  const chainId = positiveInteger(raw.chainId, `${index}.chainId`);
  if (chainId === 0) invalid(`${index}.chainId must be greater than zero`);
  const oracle = raw.oracle;
  if (oracle !== "chainlink" && oracle !== "hypercore") invalid(`${index}.oracle must be "chainlink" or "hypercore"`);
  if (!Array.isArray(raw.assets) || raw.assets.length === 0) invalid(`${index}.assets must be a non-empty array`);
  const nativeRaw = raw.nativeCurrency;
  if (nativeRaw === null || typeof nativeRaw !== "object") invalid(`${index}.nativeCurrency must be an object`);
  const native = nativeRaw as Record<string, unknown>;
  const nativeCurrency: ChainNativeCurrency = {
    name: nonEmptyString(native.name, `${index}.nativeCurrency.name`),
    symbol: nonEmptyString(native.symbol, `${index}.nativeCurrency.symbol`),
    decimals: positiveInteger(native.decimals, `${index}.nativeCurrency.decimals`),
  };
  const rpc = nonEmptyString(raw.rpc, `${index}.rpc`);
  try {
    new URL(rpc);
  } catch {
    invalid(`${index}.rpc must be a valid URL`);
  }
  const explorer = nonEmptyString(raw.explorer, `${index}.explorer`).replace(/\/$/, "");
  const network = raw.network === "local" || raw.network === "testnet" || raw.network === "mainnet" ? raw.network : undefined;
  const budgetWei = typeof raw.budgetWei === "string" ? raw.budgetWei : undefined;
  if (budgetWei !== undefined && !/^\d+$/.test(budgetWei)) invalid(`${index}.budgetWei must be a decimal wei string`);
  let l2: ChainL2Config | undefined;
  if (raw.l2 !== undefined) {
    if (raw.l2 === null || typeof raw.l2 !== "object") invalid(`${index}.l2 must be an object`);
    const l2Raw = raw.l2 as Record<string, unknown>;
    l2 = {
      stack: nonEmptyString(l2Raw.stack, `${index}.l2.stack`),
      ...(optionalAddress(l2Raw.gasOracle, `${index}.l2.gasOracle`)
        ? { gasOracle: optionalAddress(l2Raw.gasOracle, `${index}.l2.gasOracle`) }
        : {}),
    };
  }
  return {
    chainId,
    name: nonEmptyString(raw.name, `${index}.name`),
    rpc,
    explorer,
    oracle,
    ...(network ? { network } : {}),
    nativeCurrency,
    ...(budgetWei ? { budgetWei } : {}),
    ...(l2 ? { l2 } : {}),
    ...(optionalAddress(raw.oraclePrecompile, `${index}.oraclePrecompile`)
      ? { oraclePrecompile: optionalAddress(raw.oraclePrecompile, `${index}.oraclePrecompile`) }
      : {}),
    ...(typeof raw.infoUrl === "string" ? { infoUrl: raw.infoUrl } : {}),
    assets: raw.assets.map((asset, i) => parseAsset(asset, `${index}.assets[${i}]`, oracle)),
  };
}

/** Validates `config/chains.json`. Pure (no filesystem) so the browser SDK can reuse it. */
export function parseChainsConfig(value: unknown): ChainsConfig {
  if (value === null || typeof value !== "object") invalid("root must be an object");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.canonicalAssets) || raw.canonicalAssets.some((s) => typeof s !== "string" || s.length === 0)) {
    invalid("canonicalAssets must be a non-empty string array");
  }
  const strikeCount = positiveInteger(raw.strikeCount, "strikeCount");
  if (strikeCount < 5 || strikeCount > 7) invalid("strikeCount must be 5, 6 or 7");
  if (raw.strikeGrids === null || typeof raw.strikeGrids !== "object" || Array.isArray(raw.strikeGrids)) {
    invalid("strikeGrids must be an object");
  }
  const strikeGrids: Record<string, number> = {};
  for (const [symbol, step] of Object.entries(raw.strikeGrids as Record<string, unknown>)) {
    strikeGrids[symbol.toUpperCase()] = positiveNumber(step, `strikeGrids.${symbol}`);
  }
  if (raw.expirySchedule === null || typeof raw.expirySchedule !== "object") invalid("expirySchedule must be an object");
  const expiryRaw = raw.expirySchedule as Record<string, unknown>;
  const hourUtc = positiveInteger(expiryRaw.hourUtc, "expirySchedule.hourUtc");
  const minuteUtc = positiveInteger(expiryRaw.minuteUtc, "expirySchedule.minuteUtc");
  if (hourUtc > 23 || minuteUtc > 59) invalid("expirySchedule hour/minute out of range");
  if (!Array.isArray(expiryRaw.horizons) || expiryRaw.horizons.some((h) => typeof h !== "string")) {
    invalid("expirySchedule.horizons must be a string array");
  }
  if (!Array.isArray(raw.chains) || raw.chains.length === 0) invalid("chains must be a non-empty array");
  const chains = raw.chains.map((chain, i) => parseChain(chain, `chains[${i}]`));
  const seen = new Set<number>();
  for (const chain of chains) {
    if (seen.has(chain.chainId)) invalid(`duplicate chainId ${chain.chainId}`);
    seen.add(chain.chainId);
  }
  return {
    canonicalAssets: (raw.canonicalAssets as string[]).map((s) => s.toUpperCase()),
    strikeCount,
    strikeGrids,
    expirySchedule: {
      hourUtc,
      minuteUtc,
      horizons: expiryRaw.horizons as string[],
    },
    ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
    chains,
  };
}

export function chainById(config: ChainsConfig, chainId: number): ChainEntry {
  const found = config.chains.find((chain) => chain.chainId === chainId);
  if (!found) throw new Error(`chains.json has no entry for chainId ${chainId}`);
  return found;
}

/** Absolute strike spacing in quote units for `symbol`, falling back to the per-asset value. */
export function strikeStepFor(config: ChainsConfig, symbol: string, asset?: ChainAssetConfig): number {
  const shared = config.strikeGrids[symbol.toUpperCase()];
  if (shared !== undefined) return shared;
  if (asset?.strikeStep !== undefined) return asset.strikeStep;
  throw new Error(`No strike grid configured for ${symbol}`);
}

/**
 * Canonical cross-chain market key: the same (asset, strike, expiry) is the same
 * economic event on every venue. `strike` is the human quote-unit number (e.g. 2500).
 */
export function canonicalMarketKey(symbol: string, strike: string | number, expiry: number | bigint): string {
  return `${symbol.toUpperCase()}:${strike}:${expiry.toString()}`;
}
