/**
 * Chain-generic Chainlink keeper.
 *
 * One `--once` pass records each newly available first Chainlink round,
 * resolves settled series, redeems vault inventory, refreshes open quotes and
 * rolls the shared ETH/BTC/LINK (and SOL, when present) ladder forward.
 *
 * Refresh is gated: batched eth_calls compare Quoter fair ticks to the vault's
 * own quotes and only send MakerVault.refresh when the book is new, one-sided
 * or ≥ EVM_REFRESH_MIN_TICKS off fair. A daily ETH budget skips refresh/create
 * once exceeded so record/resolve/redeem still run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Address, Hex } from "viem";
import { chainlinkAggregatorAbi, chainlinkOracleAbi, chainlinkSettlementResolverAbi, makerVaultAbi, montionsBookAbi, quoterAbi } from "../../sdk/src/abi/index.js";
import { findFirstRoundAfterExpiry, parseChainlinkRound } from "./baseChainlink.js";
import { ladderAssets, loadChain, loadChainsConfig, logsDir, strikeStepFor } from "./chains.js";
import { plannedSeries, type LadderAsset } from "./ladder.js";
import {
  addressAt,
  envFlag,
  envInt,
  guardedWriteContract,
  hasFlag,
  isDryRun,
  loadBotContext,
  logLine,
  sendAndWait,
  SerialTx,
  sleep,
  withRpcRetry,
} from "./runtime.js";
import {
  CREATE_BATCH_SIZE,
  SERIES_STATUS,
  chunk,
  createSeriesCalldata,
  decodePriceSeriesData,
  encodePlannedSeries,
  readAllSeries,
  selectMissingSeries,
  tupleField,
  type OnchainSeries,
} from "./seriesOps.js";

const VOID_GRACE_SECONDS = 2n * 24n * 60n * 60n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MULTICALL_CHUNK = 80;

/** Matches MakerVault `MIN_QUOTE_LIFE = 10 minutes`. */
export const VAULT_MIN_QUOTE_LIFE_SECONDS = 10 * 60;
export const DEFAULT_REFRESH_LIMIT = 4;
export const DEFAULT_REFRESH_MIN_TICKS = 2;
export const DEFAULT_MAX_ETH_PER_DAY = "0.01";
/** Job-measured MakerVault.refresh cost on Base Sepolia (mostly L1 data fee). */
export const DEFAULT_REFRESH_WEI = 70_000_000_000_000n;

const trackedOrdersAbi = [
  {
    type: "function",
    name: "trackedOrders",
    stateMutability: "view",
    inputs: [{ name: "seriesId", type: "bytes32" }],
    outputs: [{ name: "ids", type: "uint64[]" }],
  },
] as const;

export interface SeriesQuoteState {
  id: Hex;
  expiry: bigint;
  fairTick: number;
  tracked: boolean;
  vaultBidTick: number;
  vaultAskTick: number;
}

export type RefreshReason = "stale" | "missing_side" | "new";

export interface RefreshPick {
  id: Hex;
  reason: RefreshReason;
  deviation: number;
  expiry: bigint;
}

export interface RefreshSelectOptions {
  now: bigint;
  minTicks: number;
  limit: number;
  minQuoteLifeSeconds?: number;
}

export interface DailyGasState {
  day: string;
  spentWei: bigint;
}

export interface RefreshStats {
  refreshed: number;
  needed: number;
  stale: number;
  missingSide: number;
  fresh: number;
  skippedBudget: number;
}

interface KeeperConfig {
  create: boolean;
  resolve: boolean;
  refreshLimit: number;
  refreshMinTicks: number;
  redeemLimit: number;
  intervalMs: number;
  once: boolean;
  dryRun: boolean;
  maxWeiPerDay: bigint;
  minQuoteLifeSeconds: number;
}

interface KeeperClients {
  context: ReturnType<typeof loadBotContext>;
  tx: SerialTx;
  book: Address;
  oracle: Address;
  resolver: Address;
  vault?: Address;
  quoter?: Address;
  redeemCursor: number;
  redeemed: Set<string>;
  gasStatePath: string;
  gasState: DailyGasState;
  tickWei: bigint;
}

const REASON_RANK: Record<RefreshReason, number> = { missing_side: 0, new: 1, stale: 2 };

export function parseEthToWei(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("EVM_MAX_ETH_PER_DAY must be a non-negative ETH decimal");
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded);
}

export function formatWeiAsEth(wei: bigint): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  const text = frac.length === 0 ? `${whole}` : `${whole}.${frac}`;
  return negative ? `-${text}` : text;
}

export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function rollDailyGas(state: DailyGasState | undefined, nowMs: number): DailyGasState {
  const day = utcDayKey(nowMs);
  if (!state || state.day !== day) return { day, spentWei: 0n };
  return state;
}

export function wouldExceedDailyBudget(spentWei: bigint, maxWei: bigint): boolean {
  return spentWei >= maxWei;
}

export function estimateTxWei(functionName: string): bigint {
  switch (functionName) {
    case "refresh":
      return DEFAULT_REFRESH_WEI;
    case "record":
      return 50_000_000_000_000n;
    case "resolve":
      return 40_000_000_000_000n;
    case "redeemSeries":
      return 40_000_000_000_000n;
    case "multicall":
      return 80_000_000_000_000n;
    default:
      return 50_000_000_000_000n;
  }
}

export function vaultQuoteMidpoint(bid: number, ask: number): number {
  return (bid + ask) / 2;
}

export function quoteStateFrom(
  series: { id: Hex; expiry: bigint },
  fairTick: number,
  tracked: boolean,
  orders: readonly { open: boolean; side: number; tick: number; qty?: bigint }[],
): SeriesQuoteState {
  let vaultBidTick = 0;
  let vaultAskTick = 0;
  for (const order of orders) {
    if (!order.open) continue;
    if (order.qty !== undefined && order.qty === 0n) continue;
    if (order.tick < 1 || order.tick > 99) continue;
    if (order.side === 0) {
      if (order.tick > vaultBidTick) vaultBidTick = order.tick;
    } else if (order.side === 1) {
      if (vaultAskTick === 0 || order.tick < vaultAskTick) vaultAskTick = order.tick;
    }
  }
  return { id: series.id, expiry: series.expiry, fairTick, tracked, vaultBidTick, vaultAskTick };
}

export function refreshReasonFor(
  item: SeriesQuoteState,
  now: bigint,
  minTicks: number,
  minQuoteLifeSeconds: number,
): RefreshReason | undefined {
  if (item.expiry <= now) return undefined;
  if (item.expiry - now < BigInt(minQuoteLifeSeconds)) return undefined;
  if (item.fairTick <= 0 || item.fairTick > 99) return undefined;
  const hasBid = item.vaultBidTick > 0;
  const hasAsk = item.vaultAskTick > 0;
  if (!hasBid && !hasAsk && !item.tracked) return "new";
  if (!hasBid || !hasAsk) return "missing_side";
  const deviation = Math.abs(item.fairTick - vaultQuoteMidpoint(item.vaultBidTick, item.vaultAskTick));
  if (deviation >= minTicks) return "stale";
  return undefined;
}

export function selectRefreshTargets(
  series: readonly SeriesQuoteState[],
  options: RefreshSelectOptions,
): RefreshPick[] {
  const minLife = options.minQuoteLifeSeconds ?? VAULT_MIN_QUOTE_LIFE_SECONDS;
  const picks: RefreshPick[] = [];
  for (const item of series) {
    const reason = refreshReasonFor(item, options.now, options.minTicks, minLife);
    if (!reason) continue;
    const deviation =
      item.vaultBidTick > 0 && item.vaultAskTick > 0
        ? Math.abs(item.fairTick - vaultQuoteMidpoint(item.vaultBidTick, item.vaultAskTick))
        : Number.POSITIVE_INFINITY;
    picks.push({ id: item.id, reason, deviation, expiry: item.expiry });
  }
  picks.sort((a, b) => {
    const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (rank !== 0) return rank;
    if (a.reason === "stale") {
      const delta = b.deviation - a.deviation;
      if (delta !== 0) return delta;
    }
    if (a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return picks.slice(0, Math.max(0, options.limit));
}

export function isKeeperEntrypoint(argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  return /(?:^|[/\\])(?:evm-keeper|base-keeper)(?:\.[cm]?[jt]s)?$/.test(argv1);
}

function envFlagEither(primary: string, alias: string, defaultOn: boolean): boolean {
  if (process.env[primary] !== undefined && process.env[primary] !== "") return envFlag(primary, defaultOn);
  return envFlag(alias, defaultOn);
}

function envIntEither(primary: string, alias: string, fallback: number, min?: number): number {
  if (process.env[primary] !== undefined && process.env[primary] !== "") return envInt(primary, fallback, min);
  return envInt(alias, fallback, min);
}

function envEthEither(primary: string, alias: string, fallback: string): bigint {
  const raw = process.env[primary] !== undefined && process.env[primary] !== "" ? process.env[primary] : process.env[alias];
  return parseEthToWei(raw === undefined || raw === "" ? fallback : raw);
}

function config(): KeeperConfig {
  return {
    create: envFlagEither("EVM_KEEPER_CREATE", "BASE_KEEPER_CREATE", true),
    resolve: envFlagEither("EVM_KEEPER_RESOLVE", "BASE_KEEPER_RESOLVE", true),
    refreshLimit: envIntEither("EVM_REFRESH_LIMIT", "BASE_REFRESH_LIMIT", DEFAULT_REFRESH_LIMIT, 0),
    refreshMinTicks: envIntEither("EVM_REFRESH_MIN_TICKS", "BASE_REFRESH_MIN_TICKS", DEFAULT_REFRESH_MIN_TICKS, 0),
    redeemLimit: envIntEither("EVM_REDEEM_LIMIT", "BASE_REDEEM_LIMIT", 40, 0),
    intervalMs: envIntEither("EVM_KEEPER_INTERVAL_MS", "BASE_KEEPER_INTERVAL_MS", 15_000, 250),
    once: hasFlag("--once"),
    dryRun: isDryRun(),
    maxWeiPerDay: envEthEither("EVM_MAX_ETH_PER_DAY", "BASE_MAX_ETH_PER_DAY", DEFAULT_MAX_ETH_PER_DAY),
    minQuoteLifeSeconds: envIntEither("EVM_MIN_QUOTE_LIFE_SECONDS", "BASE_MIN_QUOTE_LIFE_SECONDS", VAULT_MIN_QUOTE_LIFE_SECONDS, 0),
  };
}

function optionalAddress(deployment: KeeperClients["context"]["deployment"], ...names: string[]): Address | undefined {
  for (const name of names) {
    const value = deployment.contracts[name];
    if (value) return value;
  }
  return undefined;
}

function gasStatePathFor(chainId: number): string {
  const configured = process.env.EVM_GAS_STATE_FILE;
  if (configured && configured !== "") {
    return configured.startsWith("/") ? configured : resolve(process.cwd(), configured);
  }
  return resolve(logsDir(chainId), "evm-keeper-gas.json");
}

export function readGasStateFile(path: string, nowMs: number): DailyGasState {
  try {
    if (!existsSync(path)) return rollDailyGas(undefined, nowMs);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { day?: unknown; spentWei?: unknown };
    const day = typeof raw.day === "string" ? raw.day : "";
    const spentWei =
      typeof raw.spentWei === "bigint"
        ? raw.spentWei
        : typeof raw.spentWei === "string" || typeof raw.spentWei === "number"
          ? BigInt(raw.spentWei)
          : 0n;
    return rollDailyGas({ day, spentWei }, nowMs);
  } catch {
    return rollDailyGas(undefined, nowMs);
  }
}

export function writeGasStateFile(path: string, state: DailyGasState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ day: state.day, spentWei: state.spentWei.toString() }, null, 2)}\n`);
}

function addSpend(clients: KeeperClients, wei: bigint, persist: boolean): void {
  clients.tickWei += wei;
  if (!persist || wei === 0n) return;
  clients.gasState = { day: clients.gasState.day, spentWei: clients.gasState.spentWei + wei };
  writeGasStateFile(clients.gasStatePath, clients.gasState);
}

function extractL1Fee(receipt: Record<string, unknown>): bigint {
  const fee = receipt.l1Fee;
  if (typeof fee === "bigint") return fee;
  if (typeof fee === "string" && fee !== "") {
    try {
      return BigInt(fee);
    } catch {
      return 0n;
    }
  }
  if (typeof fee === "number" && Number.isFinite(fee)) return BigInt(Math.trunc(fee));
  return 0n;
}

function receiptCostWei(receipt: { gasUsed: bigint; effectiveGasPrice?: bigint } & Record<string, unknown>, estimate: bigint, chainId: number): bigint {
  const l2 = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
  const l1 = extractL1Fee(receipt);
  const actual = l2 + l1;
  // Base/Arb receipts often omit L1 (or equivalent) data fees; never count below the measured floor.
  if ((chainId === 84532 || chainId === 421614) && actual < estimate) return estimate;
  return actual > 0n ? actual : estimate;
}

async function measureSpend(clients: KeeperClients, hash: Hex | undefined, functionName: string): Promise<bigint> {
  const estimate = estimateTxWei(functionName);
  if (!hash) return estimate;
  try {
    const receipt = await clients.context.publicClient.getTransactionReceipt({ hash });
    return receiptCostWei(receipt as { gasUsed: bigint; effectiveGasPrice?: bigint } & Record<string, unknown>, estimate, clients.context.deployment.chainId);
  } catch {
    return estimate;
  }
}

async function send(
  clients: KeeperClients,
  cfg: KeeperConfig,
  label: string,
  parameters: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] },
): Promise<boolean> {
  const estimate = estimateTxWei(parameters.functionName);
  if (cfg.dryRun) {
    logLine("evm-keeper", { event: "dry_run", label, eth_est: formatWeiAsEth(estimate) });
    addSpend(clients, estimate, false);
    return true;
  }
  if (!clients.context.walletClient || !clients.context.account) throw new Error("keeper needs BOT_PRIVATE_KEY or BOT_ADDRESS");
  let lastHash: Hex | undefined;
  await clients.tx.run(async () => {
    let hash: Hex | undefined;
    await withRpcRetry(async () => {
      if (!hash) {
        hash = await guardedWriteContract(clients.context, {
          ...parameters,
          account: clients.context.account!,
          chain: undefined,
        });
      }
      await sendAndWait(clients.context, hash, label);
    }, { label });
    lastHash = hash;
  });
  addSpend(clients, await measureSpend(clients, lastHash, parameters.functionName), true);
  return true;
}

async function batchedCalls(
  clients: KeeperClients,
  contracts: readonly { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }[],
): Promise<unknown[]> {
  const out: unknown[] = [];
  const multicall = clients.context.publicClient.multicall as unknown as (args: {
    contracts: readonly unknown[];
    allowFailure: boolean;
  }) => Promise<readonly { status: string; result?: unknown }[]>;
  for (const group of chunk(contracts, MULTICALL_CHUNK)) {
    const rows = await withRpcRetry(() => multicall({ contracts: group, allowFailure: true }), { label: "multicall" });
    for (const row of rows) out.push(row.status === "success" ? row.result : undefined);
  }
  return out;
}

function parseFairTick(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (Array.isArray(raw)) return Number(raw[0] ?? 0);
  if (typeof raw === "object" && "fairTick" in raw) return Number((raw as { fairTick: unknown }).fairTick);
  return 0;
}

function parseHexIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
}

function parseUint64Ids(raw: unknown): bigint[] {
  if (!Array.isArray(raw)) return [];
  const ids: bigint[] = [];
  for (const item of raw) {
    try {
      const id = typeof item === "bigint" ? item : BigInt(item as string | number);
      if (id !== 0n) ids.push(id);
    } catch {
      // skip undecodable ids
    }
  }
  return ids;
}

function parseOrderView(raw: unknown): { open: boolean; side: number; tick: number; qty: bigint } | undefined {
  if (raw === undefined || raw === null) return undefined;
  const qtyRaw = tupleField(raw, 6, "qty");
  let qty = 0n;
  try {
    qty = typeof qtyRaw === "bigint" ? qtyRaw : BigInt((qtyRaw as string | number | undefined) ?? 0);
  } catch {
    qty = 0n;
  }
  return {
    open: Boolean(tupleField(raw, 9, "open")),
    side: Number(tupleField(raw, 3, "side")),
    tick: Number(tupleField(raw, 4, "tick")),
    qty,
  };
}

async function readRound(clients: KeeperClients, feed: Address, roundId: bigint) {
  const raw = await withRpcRetry(
    () => clients.context.publicClient.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "getRoundData", args: [roundId] }),
    { label: "Chainlink getRoundData" },
  );
  return parseChainlinkRound(raw);
}

async function firstRound(clients: KeeperClients, feed: Address, expiry: bigint): Promise<bigint | undefined> {
  const raw = await withRpcRetry(
    () => clients.context.publicClient.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "latestRoundData" }),
    { label: "Chainlink latestRoundData" },
  );
  const latest = parseChainlinkRound(raw);
  if (latest.updatedAt < expiry) return undefined;
  return findFirstRoundAfterExpiry(latest.roundId, expiry, { getRoundData: (roundId) => readRound(clients, feed, roundId) });
}

async function settleExpired(clients: KeeperClients, cfg: KeeperConfig, now: bigint, all: readonly OnchainSeries[]): Promise<number> {
  if (!cfg.resolve) return 0;
  const expired = all.filter((item) => item.status === SERIES_STATUS.Open && now > item.expiry);
  if (expired.length === 0) return 0;
  const groups = new Map<string, { feed: Address; expiry: bigint; series: OnchainSeries[] }>();
  for (const item of expired) {
    const decoded = decodePriceSeriesData(item.data);
    if (!decoded) continue;
    const feed = await withRpcRetry(
      () => clients.context.publicClient.readContract({ address: clients.oracle, abi: chainlinkOracleAbi, functionName: "feedOf", args: [decoded.assetId] }),
      { label: "Chainlink feedOf" },
    );
    if (!feed || feed === ZERO_ADDRESS) continue;
    const key = `${feed.toLowerCase()}:${item.expiry}`;
    const existing = groups.get(key);
    if (existing) existing.series.push(item);
    else groups.set(key, { feed, expiry: item.expiry, series: [item] });
  }

  let resolved = 0;
  for (const group of groups.values()) {
    let recorded = await withRpcRetry(
      () => clients.context.publicClient.readContract({ address: clients.resolver, abi: chainlinkSettlementResolverAbi, functionName: "isRecorded", args: [group.feed, group.expiry] }),
      { label: "Chainlink isRecorded" },
    );
    if (!recorded) {
      const hint = await firstRound(clients, group.feed, group.expiry);
      if (hint === undefined) {
        logLine("evm-keeper", {
          event: now >= group.expiry + VOID_GRACE_SECONDS ? "round_missing_void_pending" : "round_pending",
          feed: group.feed,
          expiry: group.expiry,
        });
      } else {
        try {
          await send(clients, cfg, "Chainlink record first round", {
            address: clients.resolver,
            abi: chainlinkSettlementResolverAbi,
            functionName: "record",
            args: [group.feed, group.expiry, hint],
          });
          recorded = true;
          logLine("evm-keeper", { event: "round_recorded", feed: group.feed, expiry: group.expiry, round: hint });
        } catch (error) {
          logLine("evm-keeper", { event: "record_skip", feed: group.feed, expiry: group.expiry, round: hint, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    for (const series of group.series) {
      if (!recorded && now < series.expiry + VOID_GRACE_SECONDS) continue;
      try {
        await send(clients, cfg, "series resolve", {
          address: clients.book,
          abi: montionsBookAbi,
          functionName: "resolve",
          args: [series.id],
        });
        resolved++;
      } catch (error) {
        logLine("evm-keeper", { event: "resolve_pending", series: series.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return resolved;
}

async function readAssets(clients: KeeperClients): Promise<LadderAsset[]> {
  const chain = loadChain(clients.context.deployment.chainId);
  const config = loadChainsConfig();
  const wanted = ladderAssets(chain);
  const deploymentBySymbol = new Map(clients.context.deployment.assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  const assets: LadderAsset[] = [];
  for (const spec of wanted) {
    const deployed = deploymentBySymbol.get(spec.symbol.toUpperCase());
    if (!deployed || deployed.settleDelay === undefined) continue;
    try {
      const latest = await withRpcRetry(
        () => clients.context.publicClient.readContract({ address: clients.oracle, abi: chainlinkOracleAbi, functionName: "latestPrice", args: [deployed.assetId] }),
        { label: `${spec.symbol} latestPrice` },
      );
      if (latest[0] <= 0n) continue;
      assets.push({
        symbol: spec.symbol,
        assetId: deployed.assetId,
        spotWad: latest[0],
        settleDelay: deployed.settleDelay,
        strikeStep: strikeStepFor(config, spec.symbol, spec),
      });
    } catch (error) {
      logLine("evm-keeper", { event: "spot_skip", asset: spec.symbol, error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Unable to read a healthy Chainlink spot for ${spec.symbol}`, { cause: error });
    }
  }
  return assets;
}

async function rollLadder(clients: KeeperClients, cfg: KeeperConfig, now: bigint): Promise<number> {
  if (!cfg.create) return 0;
  const assets = await readAssets(clients);
  if (assets.length === 0) return 0;
  const strikeCount = Number(process.env.EVM_STRIKE_COUNT ?? process.env.BASE_STRIKE_COUNT ?? loadChainsConfig().strikeCount);
  const plan = plannedSeries(now, assets, { strikeCount });
  const encoded = plan.map((item) => encodePlannedSeries(item, clients.oracle, clients.resolver));
  const missing = await selectMissingSeries(clients.context, clients.book, encoded);
  if (missing.length === 0) return 0;
  let created = 0;
  for (const batch of chunk(missing, CREATE_BATCH_SIZE)) {
    if (wouldExceedDailyBudget(clients.gasState.spentWei, cfg.maxWeiPerDay)) break;
    const calls = batch.map((item) => createSeriesCalldata(clients.resolver, item.data, item.expiry));
    await send(clients, cfg, "rolling series batch", {
      address: clients.book,
      abi: montionsBookAbi,
      functionName: "multicall",
      args: [calls],
    });
    created += batch.length;
  }
  return created;
}

async function loadQuoteStates(
  clients: KeeperClients,
  eligible: readonly OnchainSeries[],
): Promise<SeriesQuoteState[]> {
  if (!clients.vault || !clients.quoter || eligible.length === 0) return [];
  const vault = clients.vault;
  const quoter = clients.quoter;
  const head = await batchedCalls(clients, [
    { address: vault, abi: makerVaultAbi, functionName: "activeSeries" },
    ...eligible.map((item) => ({ address: quoter, abi: quoterAbi, functionName: "fair" as const, args: [item.id] as readonly unknown[] })),
    ...eligible.map((item) => ({ address: vault, abi: trackedOrdersAbi, functionName: "trackedOrders" as const, args: [item.id] as readonly unknown[] })),
  ]);
  const trackedIds = new Set(parseHexIds(head[0]));
  const fairs = head.slice(1, 1 + eligible.length);
  const orderIdLists = head.slice(1 + eligible.length, 1 + 2 * eligible.length);
  const orderCalls: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[]; seriesIndex: number }[] = [];
  const idsBySeries: bigint[][] = [];
  for (let i = 0; i < eligible.length; i++) {
    const ids = parseUint64Ids(orderIdLists[i]);
    idsBySeries.push(ids);
    for (const id of ids) {
      orderCalls.push({ address: clients.book, abi: montionsBookAbi, functionName: "orderInfo", args: [id], seriesIndex: i });
    }
  }
  const orderRaws = orderCalls.length === 0 ? [] : await batchedCalls(
    clients,
    orderCalls.map((call) => ({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args })),
  );
  const ordersBySeries: { open: boolean; side: number; tick: number; qty: bigint }[][] = eligible.map(() => []);
  for (let i = 0; i < orderCalls.length; i++) {
    const parsed = parseOrderView(orderRaws[i]);
    const seriesIndex = orderCalls[i]?.seriesIndex;
    if (parsed && seriesIndex !== undefined) ordersBySeries[seriesIndex]?.push(parsed);
  }
  return eligible.map((item, index) =>
    quoteStateFrom(item, parseFairTick(fairs[index]), trackedIds.has(item.id.toLowerCase()), ordersBySeries[index] ?? []),
  );
}

async function refreshVault(clients: KeeperClients, cfg: KeeperConfig, now: bigint, all: readonly OnchainSeries[]): Promise<RefreshStats> {
  const empty: RefreshStats = { refreshed: 0, needed: 0, stale: 0, missingSide: 0, fresh: 0, skippedBudget: 0 };
  if (!clients.vault || !clients.quoter || cfg.refreshLimit <= 0) return empty;
  if (wouldExceedDailyBudget(clients.gasState.spentWei, cfg.maxWeiPerDay)) {
    return { ...empty, skippedBudget: 1 };
  }
  const minLife = BigInt(cfg.minQuoteLifeSeconds);
  const eligible = all.filter((item) => item.status === SERIES_STATUS.Open && item.expiry > now && item.expiry - now >= minLife);
  const states = await loadQuoteStates(clients, eligible);
  const picks = selectRefreshTargets(states, {
    now,
    minTicks: cfg.refreshMinTicks,
    limit: cfg.refreshLimit,
    minQuoteLifeSeconds: cfg.minQuoteLifeSeconds,
  });
  const needed = selectRefreshTargets(states, {
    now,
    minTicks: cfg.refreshMinTicks,
    limit: Number.MAX_SAFE_INTEGER,
    minQuoteLifeSeconds: cfg.minQuoteLifeSeconds,
  });
  const stats: RefreshStats = {
    refreshed: 0,
    needed: needed.length,
    stale: needed.filter((item) => item.reason === "stale").length,
    missingSide: needed.filter((item) => item.reason === "missing_side").length,
    fresh: needed.filter((item) => item.reason === "new").length,
    skippedBudget: 0,
  };
  for (const pick of picks) {
    if (wouldExceedDailyBudget(clients.gasState.spentWei, cfg.maxWeiPerDay)) {
      stats.skippedBudget++;
      continue;
    }
    try {
      logLine("evm-keeper", {
        event: "refresh_select",
        series: pick.id,
        reason: pick.reason,
        deviation: Number.isFinite(pick.deviation) ? pick.deviation : "inf",
      });
      await send(clients, cfg, "vault refresh", { address: clients.vault, abi: makerVaultAbi, functionName: "refresh", args: [pick.id] });
      stats.refreshed++;
    } catch (error) {
      logLine("evm-keeper", { event: "refresh_skip", series: pick.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return stats;
}

async function redeemVault(clients: KeeperClients, cfg: KeeperConfig, all: readonly OnchainSeries[]): Promise<number> {
  if (!clients.vault || cfg.redeemLimit <= 0) return 0;
  const settled = all
    .filter((item) => (item.status === SERIES_STATUS.Resolved || item.status === SERIES_STATUS.Void) && !clients.redeemed.has(item.id.toLowerCase()))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.id < b.id ? -1 : 1));
  const count = Math.min(cfg.redeemLimit, settled.length);
  const start = settled.length === 0 ? 0 : clients.redeemCursor % settled.length;
  const targets = Array.from({ length: count }, (_, index) => settled[(start + index) % settled.length]!);
  clients.redeemCursor = settled.length === 0 ? 0 : (start + count) % settled.length;
  let redeemed = 0;
  for (const item of targets) {
    try {
      await send(clients, cfg, "vault redeem", { address: clients.vault, abi: makerVaultAbi, functionName: "redeemSeries", args: [item.id] });
      clients.redeemed.add(item.id.toLowerCase());
      redeemed++;
    } catch (error) {
      logLine("evm-keeper", { event: "redeem_skip", series: item.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return redeemed;
}

async function tick(clients: KeeperClients, cfg: KeeperConfig): Promise<void> {
  clients.tickWei = 0n;
  clients.gasState = rollDailyGas(clients.gasState, Date.now());
  const block = await withRpcRetry(() => clients.context.publicClient.getBlock(), { label: "getBlock" });
  const all = await readAllSeries(clients.context, clients.book);
  const resolved = await settleExpired(clients, cfg, block.timestamp, all);
  const redeemed = await redeemVault(clients, cfg, all);
  const budgetOk = !wouldExceedDailyBudget(clients.gasState.spentWei, cfg.maxWeiPerDay);
  let refresh: RefreshStats = { refreshed: 0, needed: 0, stale: 0, missingSide: 0, fresh: 0, skippedBudget: 0 };
  let created = 0;
  if (!budgetOk) {
    logLine("evm-keeper", {
      event: "budget_exhausted",
      eth_day: formatWeiAsEth(clients.gasState.spentWei),
      eth_budget: formatWeiAsEth(cfg.maxWeiPerDay),
    });
  } else {
    refresh = await refreshVault(clients, cfg, block.timestamp, all);
    if (!wouldExceedDailyBudget(clients.gasState.spentWei, cfg.maxWeiPerDay)) {
      created = await rollLadder(clients, cfg, block.timestamp);
    }
  }
  logLine("evm-keeper", {
    event: "tick",
    now: block.timestamp,
    series: all.length,
    resolved,
    redeemed,
    refreshed: refresh.refreshed,
    created,
    refresh_needed: refresh.needed,
    refresh_stale: refresh.stale,
    refresh_missing_side: refresh.missingSide,
    refresh_new: refresh.fresh,
    refresh_skipped_budget: refresh.skippedBudget,
    budget_ok: budgetOk,
    eth_spent_est: formatWeiAsEth(clients.tickWei),
    eth_day: formatWeiAsEth(clients.gasState.spentWei),
    eth_budget: formatWeiAsEth(cfg.maxWeiPerDay),
    dry_run: cfg.dryRun,
  });
}

async function main(): Promise<void> {
  const cfg = config();
  const context = loadBotContext(!cfg.dryRun);
  const chain = loadChain(context.deployment.chainId);
  if (chain.oracle !== "chainlink") throw new Error(`evm-keeper requires a Chainlink venue, got oracle=${chain.oracle}`);
  const gasPath = gasStatePathFor(context.deployment.chainId);
  const clients: KeeperClients = {
    context,
    tx: new SerialTx(),
    book: addressAt(context.deployment, "book"),
    oracle: addressAt(context.deployment, "chainlinkOracle", "oracle"),
    resolver: addressAt(context.deployment, "chainlinkResolver", "resolver"),
    vault: optionalAddress(context.deployment, "vault", "makerVault"),
    quoter: optionalAddress(context.deployment, "quoter"),
    redeemCursor: 0,
    redeemed: new Set<string>(),
    gasStatePath: gasPath,
    gasState: readGasStateFile(gasPath, Date.now()),
    tickWei: 0n,
  };
  logLine("evm-keeper", {
    event: "start",
    chain: context.deployment.chainId,
    create: cfg.create,
    refresh_limit: cfg.refreshLimit,
    refresh_min_ticks: cfg.refreshMinTicks,
    min_quote_life: cfg.minQuoteLifeSeconds,
    eth_budget: formatWeiAsEth(cfg.maxWeiPerDay),
    eth_day: formatWeiAsEth(clients.gasState.spentWei),
    interval_ms: cfg.intervalMs,
    once: cfg.once,
    dry_run: cfg.dryRun,
  });
  const shutdown = (): void => {
    logLine("evm-keeper", { event: "shutdown" });
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  do {
    const started = Date.now();
    try {
      await tick(clients, cfg);
    } catch (error) {
      logLine("evm-keeper", { event: "tick_error", error: error instanceof Error ? error.message : String(error) });
      if (cfg.once) throw error;
    }
    if (cfg.once) break;
    const elapsed = Date.now() - started;
    await sleep(Math.max(cfg.intervalMs - elapsed, 1_000));
  } while (!cfg.once);
}

if (isKeeperEntrypoint()) {
  main().catch((error: unknown) => {
    console.error(`EVM-KEEPER failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
