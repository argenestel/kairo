/**
 * Operator-in-the-loop resolver for Kairo event markets.
 *
 * After closeTime, proposes ONLY outcomes the operator confirmed in a local JSON file.
 * Never infers an outcome from prices, news, or the catalog prior. Watches for disputes
 * (logs; does not auto-arbitrate — the arbitrator is a person). Finalises undisputed
 * proposals after the challenge window so the proposer's bond is returned.
 *
 *   EVENT_OUTCOMES=config/event-outcomes.json DEPLOYMENT=deployments/84532.json \
 *     BOT_PRIVATE_KEY=0x… pnpm exec tsx src/event-resolver-bot.ts --once --dry-run
 *
 * Outcomes file:
 *   { "outcomes": { "FED-CUT-2026-10-28": { "outcome": "no", "confirmed": true, "note": "FOMC hold" } } }
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { erc20Abi, montionsBookAbi } from "../../sdk/src/abi/index.js";
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
import {
  eventKeyBytes,
  eventResolverAbi,
  eventSeriesId,
  loadCatalog,
  type CatalogEvent,
} from "./event-maker.js";
import type { Address, Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";
const OUTCOME_YES = 1;
const OUTCOME_NO = 2;
const OUTCOME_INVALID = 3;
const STATUS_PROPOSED = 3;
const STATUS_DISPUTED = 4;
const STATUS_RESOLVED = 5;
const STATUS_INVALID = 6;

interface OutcomeEntry {
  outcome?: string;
  confirmed?: boolean;
  note?: string;
}

interface OutcomesFile {
  outcomes?: Record<string, OutcomeEntry | string>;
}

function outcomesPath(): string {
  return process.env.EVENT_OUTCOMES ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../config/event-outcomes.json");
}

function loadOutcomes(): Record<string, OutcomeEntry> {
  const path = outcomesPath();
  if (!existsSync(path)) {
    logLine("event-resolver", { event: "no_outcomes_file", path, hint: "operator-in-the-loop: refusing to guess" });
    return {};
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as OutcomesFile | Record<string, OutcomeEntry | string>;
  const bag = "outcomes" in raw && raw.outcomes ? raw.outcomes : (raw as Record<string, OutcomeEntry | string>);
  const out: Record<string, OutcomeEntry> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (key === "outcomes") continue;
    out[key] = typeof value === "string" ? { outcome: value, confirmed: true } : value;
  }
  return out;
}

function parseOutcome(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "yes" || v === "1" || v === "true") return OUTCOME_YES;
  if (v === "no" || v === "2" || v === "false") return OUTCOME_NO;
  if (v === "invalid" || v === "void" || v === "3") return OUTCOME_INVALID;
  return null;
}

function resolverAddress(context: ReturnType<typeof loadBotContext>): Address {
  if (process.env.EVENT_RESOLVER) return process.env.EVENT_RESOLVER as Address;
  return addressAt(context.deployment, "eventResolver", "optimisticEventResolver");
}

function tupleField(value: unknown, index: number, key: string): unknown {
  if (Array.isArray(value)) return value[index];
  return (value as Record<string, unknown>)[key];
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const once = isOnce() || dryRun;
  const context = loadBotContext(!dryRun);
  const book = addressAt(context.deployment, "book");
  const collateral = addressAt(context.deployment, "collateral");
  const resolver = resolverAddress(context);
  const catalog = loadCatalog();
  const confirmed = loadOutcomes();
  const me = context.account
    ? ((typeof context.account === "string" ? context.account : context.account.address) as Address)
    : undefined;

  logLine("event-resolver", {
    event: "start",
    resolver,
    book,
    confirmed: Object.keys(confirmed).length,
    dry_run: dryRun,
    once,
  });

  const pass = async (): Promise<void> => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const bond = (await context.publicClient.readContract({
      address: resolver,
      abi: eventResolverAbi,
      functionName: "bondAmount",
    })) as bigint;

    for (const ev of catalog.events) {
      const close = BigInt(ev.closeTime);
      if (now < close) continue;
      const key = eventKeyBytes(ev.key);
      let status = 0;
      let proposer = ZERO;
      let disputer = ZERO;
      let proposedAt = 0n;
      let window = 0n;
      try {
        const info = await context.publicClient.readContract({
          address: resolver,
          abi: eventResolverAbi,
          functionName: "eventInfo",
          args: [key],
        });
        status = Number(tupleField(info, 8, "status"));
        proposer = String(tupleField(info, 10, "proposer"));
        disputer = String(tupleField(info, 11, "disputer"));
        proposedAt = BigInt(tupleField(info, 12, "proposedAt") as bigint);
        const prop = await context.publicClient.readContract({
          address: resolver,
          abi: eventResolverAbi,
          functionName: "proposal",
          args: [key],
        });
        window = BigInt(tupleField(prop, 3, "window") as bigint);
      } catch (error) {
        logLine("event-resolver", {
          event: "skip_unregistered",
          key: ev.key,
          error: error instanceof Error ? error.message.slice(0, 120) : String(error),
        });
        continue;
      }

      if (status === STATUS_DISPUTED) {
        logLine("event-resolver", {
          event: "disputed",
          key: ev.key,
          proposer,
          disputer,
          note: "operator must arbitrate; bot will not guess",
        });
        continue;
      }
      if (status === STATUS_RESOLVED || status === STATUS_INVALID) {
        if (proposer !== ZERO && window !== 0n && now >= proposedAt + window) {
          await maybeFinalize(ev, key, dryRun, context, resolver);
        }
        continue;
      }

      if (status === STATUS_PROPOSED) {
        if (disputer !== ZERO && disputer !== ZERO.toLowerCase()) {
          logLine("event-resolver", { event: "disputed", key: ev.key, disputer });
          continue;
        }
        if (now >= proposedAt + window) {
          await maybeFinalize(ev, key, dryRun, context, resolver);
          await maybeBookResolve(ev, book, resolver, dryRun, context);
        } else {
          logLine("event-resolver", {
            event: "window",
            key: ev.key,
            remain_s: Number(proposedAt + window - now),
          });
        }
        continue;
      }

      const entry = confirmed[ev.key];
      if (!entry || entry.confirmed === false) {
        logLine("event-resolver", {
          event: "waiting_operator",
          key: ev.key,
          closeTime: ev.closeTime,
          note: "no confirmed outcome in EVENT_OUTCOMES",
        });
        continue;
      }
      const outcome = parseOutcome(entry.outcome);
      if (outcome === null) {
        logLine("event-resolver", { event: "bad_outcome", key: ev.key, raw: entry.outcome });
        continue;
      }
      logLine("event-resolver", {
        event: dryRun ? "would_propose" : "propose",
        key: ev.key,
        outcome: entry.outcome,
        note: entry.note ?? "",
      });
      if (dryRun || !context.walletClient || !me) continue;
      const allowance = (await context.publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "allowance",
        args: [me, resolver],
      })) as bigint;
      if (allowance < bond) {
        const hash = await guardedWriteContract(context, {
          address: collateral,
          abi: erc20Abi,
          functionName: "approve",
          args: [resolver, 2n ** 256n - 1n],
          account: context.account,
        });
        await sendAndWait(context, hash, "approve-bond");
      }
      try {
        const hash = await guardedWriteContract(context, {
          address: resolver,
          abi: eventResolverAbi,
          functionName: "propose",
          args: [key, outcome],
          account: context.account,
        });
        await sendAndWait(context, hash, "propose");
        logLine("event-resolver", { event: "proposed", key: ev.key, hash });
      } catch (error) {
        logLine("event-resolver", {
          event: "propose_error",
          key: ev.key,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      }
    }
  };

  await pass();
  if (once) return;
  const interval = envInt("EVENT_RESOLVER_INTERVAL_MS", 60_000, 5_000);
  for (;;) {
    await sleep(interval);
    await pass();
  }
}

async function maybeFinalize(
  ev: CatalogEvent,
  key: Hex,
  dryRun: boolean,
  context: ReturnType<typeof loadBotContext>,
  resolver: Address,
): Promise<void> {
  logLine("event-resolver", { event: dryRun ? "would_finalize" : "finalize", key: ev.key });
  if (dryRun || !context.walletClient) return;
  try {
    const hash = await guardedWriteContract(context, {
      address: resolver,
      abi: eventResolverAbi,
      functionName: "finalize",
      args: [key],
      account: context.account,
    });
    await sendAndWait(context, hash, "finalize");
    logLine("event-resolver", { event: "finalized", key: ev.key, hash });
  } catch (error) {
    logLine("event-resolver", {
      event: "finalize_skip",
      key: ev.key,
      error: error instanceof Error ? error.message.slice(0, 160) : String(error),
    });
  }
}

async function maybeBookResolve(
  ev: CatalogEvent,
  book: Address,
  resolver: Address,
  dryRun: boolean,
  context: ReturnType<typeof loadBotContext>,
): Promise<void> {
  const id = eventSeriesId(resolver, ev.key, BigInt(ev.closeTime), ev.rules);
  logLine("event-resolver", { event: dryRun ? "would_book_resolve" : "book_resolve", key: ev.key, seriesId: id });
  if (dryRun || !context.walletClient) return;
  try {
    const hash = await guardedWriteContract(context, {
      address: book,
      abi: montionsBookAbi,
      functionName: "resolve",
      args: [id],
      account: context.account,
    });
    await sendAndWait(context, hash, "book.resolve");
    logLine("event-resolver", { event: "book_resolved", key: ev.key, hash });
  } catch (error) {
    logLine("event-resolver", {
      event: "book_resolve_skip",
      key: ev.key,
      error: error instanceof Error ? error.message.slice(0, 160) : String(error),
    });
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
