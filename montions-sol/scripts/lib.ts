/**
 * Shared CLI plumbing for scripts/ and keeper/ (node only): args, cluster/RPC, admin keypair, sending with
 * retries + 429 backoff, structured logs. Everything Solana comes from the SDK so there is one web3.js copy.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  MontionsClient,
  friendlyError,
  parseMontionsError,
  type BuiltTx,
  type Signer,
  type TransactionInstruction,
} from "../sdk/src/index.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type Cluster = "devnet" | "localnet";

export interface CommonArgs {
  cluster: Cluster;
  rpc: string;
  ws?: string;
  keypairPath: string;
  yes: boolean;
  dryRun: boolean;
  flags: Map<string, string | true>;
  positionals: string[];
}

export function parseArgs(argv = process.argv.slice(2)): CommonArgs {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(a.slice(2), next);
          i++;
        } else flags.set(a.slice(2), true);
      }
    } else positionals.push(a);
  }
  const cluster = String(
    flags.get("cluster") ?? process.env.MONTIONS_CLUSTER ?? "devnet"
  ) as Cluster;
  if (!["devnet", "localnet"].includes(cluster))
    throw new Error(`unknown --cluster ${cluster}`);
  const defaultRpc =
    cluster === "localnet"
      ? "http://127.0.0.1:8899"
      : "https://api.devnet.solana.com";
  const rpc = String(
    flags.get("rpc") ?? process.env.MONTIONS_RPC ?? defaultRpc
  );
  const ws = flags.get("ws")
    ? String(flags.get("ws"))
    : process.env.MONTIONS_WS;
  const keypairPath = String(
    flags.get("keypair") ??
      process.env.MONTIONS_KEYPAIR ??
      join(homedir(), ".config", "solana", "id.json")
  );
  return {
    cluster,
    rpc,
    ...(ws ? { ws } : {}),
    keypairPath,
    yes: flags.has("yes"),
    dryRun: flags.has("dry-run"),
    flags,
    positionals,
  };
}

export function flagStr(args: CommonArgs, name: string, def: string): string {
  const v = args.flags.get(name);
  return v === undefined || v === true ? def : v;
}

export function flagNum(args: CommonArgs, name: string, def: number): number {
  const v = args.flags.get(name);
  if (v === undefined || v === true) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

export function flagBool(
  args: CommonArgs,
  name: string,
  def: boolean
): boolean {
  if (args.flags.has(`no-${name}`)) return false;
  const v = args.flags.get(name);
  if (v === undefined) return def;
  return v === true || v === "true" || v === "1";
}

/** Load a keypair file (never printed). */
export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function makeConnection(args: CommonArgs): Connection {
  return new Connection(args.rpc, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    ...(args.ws ? { wsEndpoint: args.ws } : {}),
  });
}

export function makeClient(args: CommonArgs): MontionsClient {
  return new MontionsClient({
    connection: makeConnection(args),
    commitment: "confirmed",
  });
}

export interface AssetConfigEntry {
  symbol: string;
  name: string;
  feedId: string;
  priceAccount: string;
  strikeStep: number;
  vol: number;
  maxConfBps: number;
  settleWindow: number;
}

export function loadAssetConfig(
  path = join(ROOT, "config", "assets.devnet.json")
): AssetConfigEntry[] {
  return (
    JSON.parse(readFileSync(path, "utf8")) as { assets: AssetConfigEntry[] }
  ).assets;
}

// ── logging ──

export function log(
  event: string,
  fields: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info"
): void {
  const line = JSON.stringify(
    { ts: new Date().toISOString(), level, event, ...fields },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v)
  );
  if (level === "error") console.error(line);
  else console.log(line);
}

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export const sol = (lamports: number | bigint) =>
  Number(lamports) / LAMPORTS_PER_SOL;

function isRateLimit(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e);
  return /429|Too Many Requests|rate limit/i.test(s);
}

function isTransient(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e);
  return (
    isRateLimit(e) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|503|502|504|Blockhash not found|block height exceeded|TransactionExpired/i.test(
      s
    )
  );
}

/** Retry an RPC read with exponential backoff on 429 / transient network errors. */
export async function withRetry<T>(
  label: string,
  f: () => Promise<T>,
  tries = 6
): Promise<T> {
  let delay = 500;
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries - 1 || !isTransient(e)) throw e;
      log(
        "rpc_retry",
        {
          label,
          attempt: i + 1,
          delayMs: delay,
          error: String((e as Error).message ?? e).slice(0, 200),
        },
        "warn"
      );
      await sleep(Math.round(delay * (0.75 + Math.random() * 0.5)));
      delay = Math.min(delay * 2, 10_000);
    }
  }
}

export interface SendOptions {
  computeUnits?: number;
  label: string;
  dryRun?: boolean;
  skipPreflight?: boolean;
  /** retries on transient errors (blockhash expiry, 429) */
  tries?: number;
}

/**
 * Build once, rebroadcast identical signed bytes on transient failures. Rebuilding with a new
 * blockhash could apply an ambiguous mint/order twice. Program errors are not
 * retried. Returns the signature, or null in dry-run mode.
 */
export async function sendIxs(
  client: MontionsClient,
  payer: Keypair,
  ixs: TransactionInstruction[],
  opts: SendOptions,
  extraSigners: Signer[] = []
): Promise<string | null> {
  if (opts.dryRun) {
    log("dry_run", { label: opts.label, instructions: ixs.length });
    return null;
  }
  const tries = opts.tries ?? 4;
  let delay = 800;
  const built: BuiltTx = await withRetry(`${opts.label}:blockhash`, () =>
    client.buildTx(ixs, payer.publicKey, {
      computeUnits: opts.computeUnits ?? 400_000,
    })
  );
  for (let i = 0; ; i++) {
    try {
      return await client.sendAndConfirm(built, [payer, ...extraSigners], {
        skipPreflight: opts.skipPreflight ?? false,
      });
    } catch (e) {
      const prog = parseMontionsError(e);
      if (
        prog ||
        i >= tries - 1 ||
        !isTransient(e) ||
        /block height exceeded|TransactionExpired/i.test(
          String((e as Error).message)
        )
      ) {
        const err = e as Error & { logs?: string[] };
        const wrapped = new Error(
          `${opts.label}: ${
            prog ? `${prog.name} (${prog.msg})` : friendlyError(e)
          }`
        ) as Error & {
          logs?: string[];
          program?: string;
        };
        wrapped.logs =
          err.logs ??
          (e as { transactionLogs?: string[] }).transactionLogs ??
          [];
        if (prog) wrapped.program = prog.name;
        throw wrapped;
      }
      log(
        "send_retry",
        {
          label: opts.label,
          attempt: i + 1,
          error: String((e as Error).message ?? e).slice(0, 200),
        },
        "warn"
      );
      await sleep(Math.round(delay * (0.75 + Math.random() * 0.5)));
      delay = Math.min(delay * 2, 8000);
    }
  }
}

export async function confirmPrompt(
  args: CommonArgs,
  what: string
): Promise<boolean> {
  if (args.yes) return true;
  console.log(`\n${what}\nRe-run with --yes to execute.`);
  return false;
}

export function fmtTime(t: number): string {
  return new Date(t * 1000).toISOString().replace(".000Z", "Z");
}

export function fmtDur(secs: number): string {
  const s = Math.abs(secs);
  const sign = secs < 0 ? "-" : "";
  if (s < 120) return `${sign}${Math.round(s)}s`;
  if (s < 7200) return `${sign}${Math.round(s / 60)}m`;
  if (s < 172_800) return `${sign}${(s / 3600).toFixed(1)}h`;
  return `${sign}${(s / 86_400).toFixed(1)}d`;
}
