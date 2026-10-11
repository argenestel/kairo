/**
 * EOA maker for Kairo event markets. Posts a 3-rung ladder around the catalog
 * prior (or the live mid once the book has both sides) with a 6¢ inner spread.
 * Refreshes only on fills or every EVENT_MAKER_REFRESH_SEC (default 3 h) to save gas.
 *
 *   DEPLOYMENT=deployments/84532.json BOT_PRIVATE_KEY=0x… \
 *     pnpm exec tsx src/event-maker.ts --once --dry-run
 *
 * Env: EVENT_RESOLVER, EVENT_MAKER_QTY (20), EVENT_MAKER_SPREAD (6), EVENT_MAKER_LEVELS (3),
 *      EVENT_MAKER_MAX_PER_EVENT (200), EVENT_MAKER_MAX_GLOBAL (2000), EVENT_MAKER_REFRESH_SEC (10800),
 *      EVENT_MAKER_STATE (deployments/rehearsal/event-maker-state.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, montionsBookAbi } from "../../sdk/src/abi/index.js";
import { encodePlaceOrder } from "../../sdk/src/client.js";
import {
  addressAt,
  envInt,
  guardedWriteContract,
  isDryRun,
  isOnce,
  loadBotContext,
  logLine,
  sendAndWait,
  sleep,
} from "./runtime.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVENT_DATA_PARAMS = parseAbiParameters("bytes32 eventKey, uint64 closeTime, bytes32 rulesHash");
const SERIES_ID_PARAMS = parseAbiParameters("address resolver, bytes data, uint64 expiry");
const TICK = 10_000n;

export const eventResolverAbi = [
  {
    type: "function",
    name: "eventCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "eventKeyAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "eventInfo",
    stateMutability: "view",
    inputs: [{ name: "eventKey", type: "bytes32" }],
    outputs: [
      {
        name: "view_",
        type: "tuple",
        components: [
          { name: "key", type: "string" },
          { name: "question", type: "string" },
          { name: "rules", type: "string" },
          { name: "source", type: "string" },
          { name: "category", type: "string" },
          { name: "icon", type: "string" },
          { name: "closeTime", type: "uint64" },
          { name: "rulesHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "outcome", type: "uint8" },
          { name: "proposer", type: "address" },
          { name: "disputer", type: "address" },
          { name: "proposedAt", type: "uint64" },
          { name: "bond", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "eventKeyOf",
    stateMutability: "pure",
    inputs: [{ name: "key", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "bondAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "challengeWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "eventKey", type: "bytes32" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "nonpayable",
    inputs: [{ name: "eventKey", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "proposal",
    stateMutability: "view",
    inputs: [{ name: "eventKey", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "proposer", type: "address" },
          { name: "disputer", type: "address" },
          { name: "proposedAt", type: "uint64" },
          { name: "window", type: "uint64" },
          { name: "outcome", type: "uint8" },
          { name: "bond", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export interface CatalogEvent {
  key: string;
  question: string;
  rules: string;
  resolutionSource: string;
  closeTime: number;
  category: string;
  icon?: string;
  prior: { yes: number; basis: string; source?: string };
}

export interface CatalogFile {
  events: CatalogEvent[];
}

interface MakerState {
  lastRefresh: Record<string, number>;
  orders: Record<string, string[]>;
}

export function loadCatalog(path = resolve(REPO_ROOT, "config/events.json")): CatalogFile {
  return JSON.parse(readFileSync(path, "utf8")) as CatalogFile;
}

export function eventKeyBytes(key: string): Hex {
  return keccak256(stringToBytes(key));
}

export function rulesHashBytes(rules: string): Hex {
  return keccak256(stringToBytes(rules));
}

export function encodeEventSeriesData(key: string, closeTime: bigint, rules: string): Hex {
  return encodeAbiParameters(EVENT_DATA_PARAMS, [eventKeyBytes(key), closeTime, rulesHashBytes(rules)]);
}

export function eventSeriesId(resolver: Address, key: string, closeTime: bigint, rules: string): Hex {
  const data = encodeEventSeriesData(key, closeTime, rules);
  return keccak256(encodeAbiParameters(SERIES_ID_PARAMS, [resolver, data, closeTime]));
}

export function clampTick(tick: number): number {
  if (!Number.isFinite(tick)) return 50;
  return Math.min(99, Math.max(1, Math.round(tick)));
}

export function priorTick(yes: number): number {
  return clampTick(yes * 100);
}

/** Inner spread is `spread` cents; extra rungs step by `spread / 2` ticks. */
export function ladderTicks(mid: number, spread = 6, levels = 3): { bids: number[]; asks: number[] } {
  const half = Math.max(1, Math.floor(spread / 2));
  const bids: number[] = [];
  const asks: number[] = [];
  const seenBid = new Set<number>();
  const seenAsk = new Set<number>();
  for (let i = 0; i < levels; i++) {
    const bid = clampTick(mid - half * (i + 1));
    const ask = clampTick(mid + half * (i + 1));
    if (bid < ask && !seenBid.has(bid)) {
      seenBid.add(bid);
      bids.push(bid);
    }
    if (ask > bid && !seenAsk.has(ask)) {
      seenAsk.add(ask);
      asks.push(ask);
    }
  }
  return { bids, asks };
}

function statePath(): string {
  return process.env.EVENT_MAKER_STATE
    ?? resolve(REPO_ROOT, "deployments/rehearsal/event-maker-state.json");
}

function readState(): MakerState {
  const path = statePath();
  if (!existsSync(path)) return { lastRefresh: {}, orders: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MakerState;
  } catch {
    return { lastRefresh: {}, orders: {} };
  }
}

function writeState(state: MakerState): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function resolverAddress(context: ReturnType<typeof loadBotContext>): Address {
  if (process.env.EVENT_RESOLVER) return process.env.EVENT_RESOLVER as Address;
  return addressAt(context.deployment, "eventResolver", "optimisticEventResolver");
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const once = isOnce() || dryRun;
  const qty = BigInt(envInt("EVENT_MAKER_QTY", 20, 1));
  const spread = envInt("EVENT_MAKER_SPREAD", 6, 2);
  const levels = envInt("EVENT_MAKER_LEVELS", 3, 1);
  const maxPer = envInt("EVENT_MAKER_MAX_PER_EVENT", 200, 1);
  const maxGlobal = envInt("EVENT_MAKER_MAX_GLOBAL", 2000, 1);
  const refreshSec = envInt("EVENT_MAKER_REFRESH_SEC", 3 * 60 * 60, 60);
  const context = loadBotContext(!dryRun);
  const book = addressAt(context.deployment, "book");
  const collateral = addressAt(context.deployment, "collateral");
  const resolver = resolverAddress(context);
  const catalog = loadCatalog();
  const state = readState();
  const me = context.account
    ? ((typeof context.account === "string" ? context.account : context.account.address) as Address)
    : undefined;

  logLine("event-maker", {
    event: "start",
    book,
    resolver,
    markets: catalog.events.length,
    dry_run: dryRun,
    once,
  });

  const pass = async (): Promise<void> => {
    const now = Math.floor(Date.now() / 1000);
    let globalQty = 0;
    for (const ev of catalog.events) {
      if (now >= ev.closeTime - 60) {
        logLine("event-maker", { event: "skip_closed", key: ev.key, closeTime: ev.closeTime });
        continue;
      }
      const id = eventSeriesId(resolver, ev.key, BigInt(ev.closeTime), ev.rules);
      let bidTick = 0;
      let askTick = 0;
      let bidQty = 0n;
      let askQty = 0n;
      try {
        const top = await context.publicClient.readContract({
          address: book,
          abi: montionsBookAbi,
          functionName: "bestBidAsk",
          args: [id],
        });
        bidTick = Number(top[0]);
        bidQty = top[1];
        askTick = Number(top[2]);
        askQty = top[3];
      } catch (error) {
        logLine("event-maker", {
          event: "skip_unknown",
          key: ev.key,
          error: error instanceof Error ? error.message.slice(0, 120) : String(error),
        });
        continue;
      }

      const mid = bidTick > 0 && askTick > 0 ? (bidTick + askTick) / 2 : priorTick(ev.prior.yes);
      const ladder = ladderTicks(mid, spread, levels);
      const last = state.lastRefresh[ev.key] ?? 0;
      const tracked = (state.orders[ev.key] ?? []).map((x) => BigInt(x));
      let filled = false;
      if (me && tracked.length) {
        for (const orderId of tracked) {
          try {
            const info = await context.publicClient.readContract({
              address: book,
              abi: montionsBookAbi,
              functionName: "orderInfo",
              args: [orderId],
            });
            const open = Boolean(info.open);
            if (!open) filled = true;
          } catch {
            filled = true;
          }
        }
      }
      const stale = now - last >= refreshSec;
      const virgin = last === 0;
      if (!virgin && !filled && !stale) {
        logLine("event-maker", { event: "fresh", key: ev.key, mid, age_s: now - last });
        continue;
      }

      const perLevel = qty;
      const want = BigInt(ladder.bids.length + ladder.asks.length) * perLevel;
      const cap = BigInt(Math.max(0, Math.min(maxPer, maxGlobal - globalQty)));
      if (cap === 0n || want === 0n) {
        logLine("event-maker", { event: "cap", key: ev.key, global: globalQty });
        continue;
      }
      const scale = want > cap ? cap / BigInt(ladder.bids.length + ladder.asks.length) : perLevel;
      if (scale === 0n) continue;
      globalQty += Number(scale) * (ladder.bids.length + ladder.asks.length);

      logLine("event-maker", {
        event: dryRun ? "would_quote" : "quote",
        key: ev.key,
        mid,
        bids: ladder.bids.join(","),
        asks: ladder.asks.join(","),
        qty: scale.toString(),
        reason: filled ? "fill" : virgin ? "new" : "refresh",
      });
      if (dryRun || !context.walletClient || !me) continue;

      const calls: Hex[] = [];
      if (tracked.length) {
        calls.push(encodeFunctionData({ abi: montionsBookAbi, functionName: "cancelOrders", args: [tracked] }));
      }
      const escrow = scale * TICK * BigInt(
        ladder.bids.reduce((a, t) => a + t, 0) + ladder.asks.reduce((a, t) => a + (100 - t), 0),
      );
      const free = (await context.publicClient.readContract({
        address: book,
        abi: montionsBookAbi,
        functionName: "cash",
        args: [me],
      })) as bigint;
      if (escrow > free) {
        const allowance = (await context.publicClient.readContract({
          address: collateral,
          abi: erc20Abi,
          functionName: "allowance",
          args: [me, book],
        })) as bigint;
        if (allowance < escrow - free) {
          const hash = await guardedWriteContract(context, {
            address: collateral,
            abi: erc20Abi,
            functionName: "approve",
            args: [book, 2n ** 256n - 1n],
            account: context.account,
          });
          await sendAndWait(context, hash, "approve");
        }
        calls.push(encodeFunctionData({
          abi: montionsBookAbi,
          functionName: "deposit",
          args: [escrow - free + escrow / 10n],
        }));
      }
      for (const tick of ladder.bids) {
        calls.push(encodePlaceOrder({ seriesId: id, side: "bid", tick, qty: scale, tif: "gtc" }));
      }
      for (const tick of ladder.asks) {
        calls.push(encodePlaceOrder({ seriesId: id, side: "ask", tick, qty: scale, tif: "gtc" }));
      }
      try {
        const hash = await guardedWriteContract(context, {
          address: book,
          abi: montionsBookAbi,
          functionName: "multicall",
          args: [calls],
          account: context.account,
        });
        await sendAndWait(context, hash, "event-maker multicall");
        const count = (await context.publicClient.readContract({
          address: book,
          abi: montionsBookAbi,
          functionName: "orderCount",
        })) as bigint;
        const posted = ladder.bids.length + ladder.asks.length;
        const ids: string[] = [];
        for (let i = 0; i < posted; i++) ids.push((count - BigInt(posted - 1 - i)).toString());
        state.orders[ev.key] = ids;
        state.lastRefresh[ev.key] = now;
        writeState(state);
        logLine("event-maker", { event: "quoted", key: ev.key, hash, orders: ids.join(",") });
      } catch (error) {
        logLine("event-maker", {
          event: "error",
          key: ev.key,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      }
    }
  };

  await pass();
  if (once) return;
  const interval = envInt("EVENT_MAKER_INTERVAL_MS", 60_000, 5_000);
  for (;;) {
    await sleep(interval);
    await pass();
  }
}

const entry = process.argv[1];
const isMain = entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
