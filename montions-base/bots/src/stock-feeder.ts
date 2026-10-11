/**
 * Kairo equity feeder: public market data → KeeperFeedHub.push.
 *
 * DEMO ORACLE. Prices are reported by a trusted keeper from free public sources.
 * Settlement on KeeperFeed assets inherits that trust. Upgrade path = Pyth
 * (Hermes key) or Chainlink Data Streams.
 *
 *   pnpm exec tsx src/stock-feeder.ts --once --dry-run
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  hasFlag,
  isDryRun,
  loadBotContext,
  logLine,
  sleep,
} from "./runtime.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UA = "Mozilla/5.0 (compatible; KairoStockFeeder/1.0; keeper-reported demo oracle)";

export const DEFAULT_MAX_ETH_PER_DAY = "0.01";
/** Conservative Base-Sepolia L1-data guess for a 29-symbol hub push. */
export const DEFAULT_PUSH_WEI = 200_000_000_000_000n;
/** In-session cadence. Job amendment: 15 minutes (was 5) to save L1 gas. */
export const SESSION_INTERVAL_MS = 15 * 60 * 1000;
/** Weekend / NYSE-holiday heartbeat: one push per UTC day. */
export const WEEKEND_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_DISAGREEMENT = 0.01;
export const NY_TZ = "America/New_York";

export const keeperFeedHubAbi = [
  {
    type: "function",
    name: "push",
    stateMutability: "nonpayable",
    inputs: [
      { name: "ids", type: "bytes32[]" },
      { name: "prices", type: "int256[]" },
      { name: "observedAts", type: "uint64[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "feedOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "heartbeat",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

/** NYSE full-day closures 2025–2027 (observed dates). */
export const NYSE_HOLIDAYS: ReadonlySet<string> = new Set([
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** 13:00 ET close. */
export const NYSE_EARLY_CLOSES: ReadonlySet<string> = new Set([
  "2025-07-03", "2025-11-28", "2025-12-24",
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

export type AssetCategory = "stock" | "etf" | "commodity";

export interface StockAsset {
  symbol: string;
  name: string;
  category: AssetCategory;
  stooq: string;
  yahoo: string;
  nasdaqAssetClass: "stocks" | "etf";
  vol: number;
  volWad: string;
  price: number;
  priceE8: string;
  strikeStep: number;
  strikeStepWad: string;
  strikes: number[];
}

export interface StocksConfig {
  priceObservedAt: number;
  priceAsOf?: string;
  oracle: { heartbeatSeconds: number; settleDelay: number; maxStaleness: number; maxDeviationBps: number };
  expirySchedule: { hourUtc: number; minuteUtc: number };
  priceSources: { maxDisagreement: number };
  assets: StockAsset[];
}

export interface QuotePrint {
  source: string;
  symbol: string;
  price: number;
  observedAt: number;
}

export type PushIntent = "session" | "close" | "weekend-heartbeat" | "holiday-heartbeat" | "idle";

export interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  ymd: string;
}

export interface DailyGasState {
  day: string;
  spentWei: bigint;
}

export function isStockFeederEntrypoint(argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  return /(?:^|[/\\])stock-feeder(?:\.[cm]?[jt]s)?$/.test(argv1);
}

export function stocksConfigPath(): string {
  const configured = process.env.STOCKS_CONFIG;
  if (!configured) return resolve(REPO_ROOT, "config/stocks.json");
  if (configured.startsWith("/")) return configured;
  const fromCwd = resolve(process.cwd(), configured);
  return existsSync(fromCwd) ? fromCwd : resolve(REPO_ROOT, configured);
}

export function loadStocksConfig(path = stocksConfigPath()): StocksConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as StocksConfig;
  if (!Array.isArray(raw.assets) || raw.assets.length === 0) throw new Error("stocks.json: assets[] required");
  return raw;
}

export function assetId(symbol: string): Hex {
  return keccak256(toBytes(symbol));
}

/** The 12 most-liquid names; seeded first on a tight gas budget. */
export const LIQUID_12: readonly string[] = [
  "SPY", "QQQ", "NVDA", "TSLA", "AAPL", "MSFT",
  "AMZN", "META", "GOOGL", "COIN", "MSTR", "GLD",
];

/** Three catalog strikes closest to `spot` (identical keys across chains). */
export function threeAtmStrikes(strikes: readonly number[], spot: number): number[] {
  if (strikes.length < 3) throw new Error("need at least 3 catalog strikes");
  const ranked = [...strikes].sort((a, b) => {
    const da = Math.abs(a - spot);
    const db = Math.abs(b - spot);
    return da - db || a - b;
  });
  return ranked.slice(0, 3).sort((a, b) => a - b);
}

export function strikeToWad(strike: number): bigint {
  const text = String(strike).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new RangeError(`invalid strike: ${text}`);
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > 18) throw new RangeError("strike has more than 18 decimals");
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
}

export function waitMsForIntent(intent: PushIntent): number {
  if (intent === "session") return SESSION_INTERVAL_MS;
  if (intent === "weekend-heartbeat" || intent === "holiday-heartbeat") return WEEKEND_INTERVAL_MS;
  if (intent === "close") return 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

export function toE8(price: number): bigint {
  if (!Number.isFinite(price) || price <= 0) throw new Error(`price must be positive, got ${price}`);
  return BigInt(Math.round(price * 1e8));
}

export function disagreement(a: number, b: number): number {
  const mid = (a + b) / 2;
  if (!(mid > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / mid;
}

export function sourcesAgree(a: number, b: number, max = MAX_DISAGREEMENT): boolean {
  return disagreement(a, b) <= max;
}

export function parseStooqCsv(csv: string, symbol: string): QuotePrint {
  const lines = csv.trim().split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith("<"));
  if (lines.length === 0) throw new Error(`stooq: empty CSV for ${symbol}`);
  const last = lines[lines.length - 1]!;
  if (/symbol/i.test(last) && lines.length < 2) throw new Error(`stooq: header-only CSV for ${symbol}`);
  const row = /symbol/i.test(lines[0]!) && lines.length > 1 ? lines[1]! : last;
  const cols = row.split(",");
  const close = Number(cols[6] ?? cols[1]);
  const date = (cols[1] ?? "").trim();
  const time = (cols[2] ?? "16:00:00").trim();
  if (!Number.isFinite(close) || close <= 0) throw new Error(`stooq: bad close in ${row}`);
  const iso = date.includes("-") ? `${date}T${time}Z` : "";
  const observedAt = iso ? Math.floor(Date.parse(iso) / 1000) : 0;
  return { source: "stooq", symbol, price: close, observedAt };
}

export function parseYahooChart(json: unknown, symbol: string): QuotePrint {
  const chart = json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }>; error?: unknown } };
  const meta = chart.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`yahoo: no result for ${symbol}`);
  const price = Number(meta.regularMarketPrice ?? meta.chartPreviousClose);
  const observedAt = Number(meta.regularMarketTime ?? 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`yahoo: bad price for ${symbol}`);
  return { source: "yahoo", symbol, price, observedAt };
}

export function parseNasdaqQuote(json: unknown, symbol: string): QuotePrint {
  const body = json as {
    data?: { primaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string } };
  };
  const raw = body.data?.primaryData?.lastSalePrice;
  if (!raw) throw new Error(`nasdaq: no lastSalePrice for ${symbol}`);
  const price = Number(String(raw).replace(/[$,]/g, ""));
  if (!Number.isFinite(price) || price <= 0) throw new Error(`nasdaq: bad lastSalePrice ${raw}`);
  return { source: "nasdaq", symbol, price, observedAt: 0 };
}

export function zonedParts(date: Date, timeZone = NY_TZ): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    year,
    month,
    day,
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: map.weekday ?? "",
    ymd,
  };
}

export function isWeekendEt(parts: EtParts): boolean {
  return parts.weekday === "Sat" || parts.weekday === "Sun";
}

export function isNyseHoliday(parts: EtParts, holidays = NYSE_HOLIDAYS): boolean {
  return holidays.has(parts.ymd);
}

export function pushIntent(
  now: Date,
  holidays = NYSE_HOLIDAYS,
  earlyCloses = NYSE_EARLY_CLOSES,
): PushIntent {
  const et = zonedParts(now);
  if (isWeekendEt(et)) return "weekend-heartbeat";
  if (isNyseHoliday(et, holidays)) return "holiday-heartbeat";
  const minutes = et.hour * 60 + et.minute;
  const closeMinute = earlyCloses.has(et.ymd) ? 13 * 60 : 16 * 60;
  const openMinute = 9 * 60 + 30;
  if (minutes >= openMinute && minutes < closeMinute) return "session";
  if (minutes >= closeMinute) return "close";
  return "idle";
}

function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function isNyseHolidayYmd(ymd: string, holidays = NYSE_HOLIDAYS): boolean {
  return holidays.has(ymd);
}

/** Friday 20:00 UTC on or after `now`; skip to next week if that close has already passed. */
export function nextFridayCloseUtc(now: Date, holidays = NYSE_HOLIDAYS): Date {
  const day = now.getUTCDay();
  const fridayOffset = (5 - day + 7) % 7;
  let close = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + fridayOffset, 20, 0, 0));
  if (close.getTime() <= now.getTime()) close = addUtcDays(close, 7);
  return skipHolidayFriday(close, holidays);
}

export function fridayAfter(now: Date, holidays = NYSE_HOLIDAYS): Date {
  return skipHolidayFriday(addUtcDays(nextFridayCloseUtc(now, holidays), 7), holidays);
}

function skipHolidayFriday(close: Date, holidays: ReadonlySet<string>): Date {
  let d = close;
  while (isNyseHolidayYmd(utcYmd(d), holidays) || d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d = addUtcDays(d, -1);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 0, 0));
}

export function parseEthToWei(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("EVM_MAX_ETH_PER_DAY must be a non-negative ETH decimal");
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded);
}

export function formatWeiAsEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function wouldExceedDailyBudget(state: DailyGasState, addWei: bigint, maxWei: bigint, now = new Date()): boolean {
  const rolled = state.day === utcDay(now) ? state.spentWei : 0n;
  return rolled + addWei > maxWei;
}

export function addSpent(state: DailyGasState, addWei: bigint, now = new Date()): DailyGasState {
  const day = utcDay(now);
  return { day, spentWei: state.day === day ? state.spentWei + addWei : addWei };
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json,text/csv,*/*" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function tryYahoo(asset: StockAsset): Promise<QuotePrint> {
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${asset.yahoo}?interval=1d&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${asset.yahoo}?interval=1d&range=1d`,
  ];
  let last: unknown;
  for (const url of urls) {
    try {
      return parseYahooChart(JSON.parse(await fetchText(url)), asset.symbol);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error(`yahoo failed for ${asset.symbol}`);
}

async function tryNasdaq(asset: StockAsset): Promise<QuotePrint> {
  const url = `https://api.nasdaq.com/api/quote/${asset.yahoo}/info?assetclass=${asset.nasdaqAssetClass}`;
  return parseNasdaqQuote(JSON.parse(await fetchText(url)), asset.symbol);
}

async function tryStooq(asset: StockAsset): Promise<QuotePrint> {
  const url = `https://stooq.com/q/l/?s=${asset.stooq}&f=sd2t2ohlcv&h&e=csv`;
  return parseStooqCsv(await fetchText(url, 3_000), asset.symbol);
}

export interface ResolvedQuote {
  symbol: string;
  price: number;
  priceE8: bigint;
  observedAt: number;
  sources: QuotePrint[];
  skipped?: string;
}

export async function resolveAssetQuote(asset: StockAsset, maxDisagreement = MAX_DISAGREEMENT): Promise<ResolvedQuote> {
  const sources: QuotePrint[] = [];
  const errors: string[] = [];
  const tryFetch = async (label: string, fn: () => Promise<QuotePrint>): Promise<void> => {
    try {
      sources.push(await fn());
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await tryFetch("yahoo", () => tryYahoo(asset));
  await tryFetch("nasdaq", () => tryNasdaq(asset));
  await tryFetch("stooq", () => tryStooq(asset));

  const priced = sources.filter((s) => s.price > 0);
  if (priced.length === 0) {
    return { symbol: asset.symbol, price: 0, priceE8: 0n, observedAt: 0, sources, skipped: errors.join("; ") };
  }
  const primary = priced.find((s) => s.source === "yahoo") ?? priced[0]!;
  const other = priced.find((s) => s.source !== primary.source);
  if (other && !sourcesAgree(primary.price, other.price, maxDisagreement)) {
    return {
      symbol: asset.symbol,
      price: primary.price,
      priceE8: toE8(primary.price),
      observedAt: primary.observedAt,
      sources: priced,
      skipped: `sources disagree ${(disagreement(primary.price, other.price) * 100).toFixed(2)}% (${primary.source}=${primary.price} ${other.source}=${other.price})`,
    };
  }
  const observedAt = priced.reduce((max, s) => (s.observedAt > max ? s.observedAt : max), primary.observedAt);
  return {
    symbol: asset.symbol,
    price: primary.price,
    priceE8: toE8(primary.price),
    observedAt: observedAt > 0 ? observedAt : Math.floor(Date.now() / 1000),
    sources: priced,
  };
}

export function formatQuoteLine(q: ResolvedQuote): string {
  const bits = q.sources.map((s) => `${s.source}=${s.price}`).join(" ");
  const status = q.skipped ? `SKIP ${q.skipped}` : `e8=${q.priceE8} observedAt=${q.observedAt}`;
  return `${q.symbol.padEnd(6)} ${q.price.toString().padStart(10)} ${bits} ${status}`;
}

function gasStatePath(): string {
  return process.env.STOCK_FEEDER_GAS_STATE
    ?? resolve(REPO_ROOT, "deployments/logs/stock-feeder-gas.json");
}

export function readGasStateFile(path = gasStatePath()): DailyGasState {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { day?: string; spentWei?: string };
    return { day: raw.day ?? "", spentWei: BigInt(raw.spentWei ?? "0") };
  } catch {
    return { day: utcDay(), spentWei: 0n };
  }
}

export function writeGasStateFile(state: DailyGasState, path = gasStatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ day: state.day, spentWei: state.spentWei.toString() }, null, 2) + "\n");
}

async function main(): Promise<void> {
  const once = hasFlag("--once") || process.env.ONCE === "1";
  const dryRun = isDryRun();
  const cfg = loadStocksConfig();
  const now = new Date();
  const intent = pushIntent(now);
  const maxWei = parseEthToWei(process.env.EVM_MAX_ETH_PER_DAY || DEFAULT_MAX_ETH_PER_DAY);
  logLine("stock-feeder", {
    event: "start",
    intent,
    et: zonedParts(now).ymd + " " + zonedParts(now).weekday,
    utc: now.toISOString(),
    assets: cfg.assets.length,
    once,
    dry_run: dryRun,
    eth_budget: formatWeiAsEth(maxWei),
  });

  const runTick = async (): Promise<void> => {
    const tickNow = new Date();
    const tickIntent = pushIntent(tickNow);
    if (tickIntent === "idle" && !dryRun) {
      logLine("stock-feeder", { event: "idle", reason: "pre-open" });
      return;
    }
    const quotes: ResolvedQuote[] = [];
    for (const asset of cfg.assets) {
      quotes.push(await resolveAssetQuote(asset, cfg.priceSources.maxDisagreement ?? MAX_DISAGREEMENT));
    }
    const actionable = quotes.filter((q) => !q.skipped && q.priceE8 > 0n);
    const skipped = quotes.filter((q) => q.skipped);
    console.log(`# Kairo stock feeder  intent=${tickIntent}  utc=${tickNow.toISOString()}`);
    console.log(`# ${tickIntent === "weekend-heartbeat" || tickIntent === "holiday-heartbeat" ? "last close / heartbeat" : "session or close print"}`);
    for (const q of quotes) console.log(formatQuoteLine(q));
    console.log(`# would push ${actionable.length}/${quotes.length}  skipped=${skipped.length}`);

    if (tickIntent === "idle") return;
    if (actionable.length === 0) {
      logLine("stock-feeder", { event: "nothing_to_push" });
      return;
    }
    if (dryRun) {
      logLine("stock-feeder", { event: "dry_run", count: actionable.length, intent: tickIntent });
      return;
    }

    const ctx = loadBotContext(true);
    const hub = ((process.env.KEEPER_FEED_HUB || ctx.deployment.contracts.keeperFeedHub || "") as Address);
    if (!hub) throw new Error("Set KEEPER_FEED_HUB or contracts.keeperFeedHub (or pass --dry-run)");
    const gas = readGasStateFile();
    if (wouldExceedDailyBudget(gas, DEFAULT_PUSH_WEI, maxWei, tickNow)) {
      logLine("stock-feeder", {
        event: "skip_budget",
        spent: formatWeiAsEth(gas.spentWei),
        budget: formatWeiAsEth(maxWei),
      });
      return;
    }
    if (!ctx.walletClient || !ctx.account) throw new Error("wallet required to push");
    const ids = actionable.map((q) => assetId(q.symbol));
    const prices = actionable.map((q) => q.priceE8);
    const observedAts = actionable.map((q) => BigInt(q.observedAt));
    const account = typeof ctx.account === "string" ? ctx.account : ctx.account.address;
    const hash = await ctx.walletClient.writeContract({
      address: hub,
      abi: keeperFeedHubAbi,
      functionName: "push",
      args: [ids, prices, observedAts],
      account: ctx.account as never,
      chain: ctx.walletClient.chain,
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`push failed ${hash}`);
    const spent = receipt.effectiveGasPrice * receipt.gasUsed;
    writeGasStateFile(addSpent(gas, spent, tickNow));
    logLine("stock-feeder", {
      event: "pushed",
      hash,
      count: actionable.length,
      gas: receipt.gasUsed.toString(),
      from: account,
    });
  };

  if (once) {
    await runTick();
    return;
  }
  const shutdown = (): void => {
    logLine("stock-feeder", { event: "shutdown" });
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  do {
    const started = Date.now();
    try {
      await runTick();
    } catch (error) {
      logLine("stock-feeder", { event: "tick_error", error: error instanceof Error ? error.message : String(error) });
    }
    const intentNow = pushIntent(new Date());
    const wait = waitMsForIntent(intentNow);
    await sleep(Math.max(wait - (Date.now() - started), 1_000));
  } while (true);
}

if (isStockFeederEntrypoint()) {
  main().catch((error: unknown) => {
    console.error(`STOCK-FEEDER failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
