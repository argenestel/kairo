import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseDeployment, type Deployment } from "../../sdk/src/deployments.js";
import { tryLoadChain } from "./chains.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface BotContext {
  deployment: Deployment;
  rpcUrl: string;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient?: ReturnType<typeof createWalletClient>;
  account?: ReturnType<typeof privateKeyToAccount> | Address;
  /** Native balance at the first guarded write, or EVM_START_BALANCE_WEI / BASE_START_BALANCE_WEI. */
  baseStartBalanceWei?: bigint;
}

export function deploymentPath(): string {
  const configured = process.env.DEPLOYMENT;
  if (!configured) return resolve(REPO_ROOT, "deployments/31337.json");
  if (configured.startsWith("/")) return configured;
  const fromCwd = resolve(process.cwd(), configured);
  return existsSync(fromCwd) ? fromCwd : resolve(REPO_ROOT, configured);
}

export function readDeployment(): Deployment {
  const path = deploymentPath();
  return parseDeployment(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function rpcUrl(deployment: Deployment): string {
  return process.env.RPC_URL || deployment.rpc;
}

export function makeChain(chainId: number, url: string) {
  const configured = tryLoadChain(chainId);
  const name = configured?.name
    ?? (chainId === 10143 ? "Monad Testnet" : chainId === 84532 ? "Base Sepolia" : chainId === 421614 ? "Arbitrum Sepolia" : chainId === 998 ? "HyperEVM Testnet" : `Montions chain ${chainId}`);
  const nativeCurrency = configured?.nativeCurrency
    ?? (chainId === 10143
      ? { name: "MON", symbol: "MON", decimals: 18 }
      : chainId === 998
        ? { name: "HYPE", symbol: "HYPE", decimals: 18 }
        : { name: "Ether", symbol: "ETH", decimals: 18 });
  const explorer = configured?.explorer
    ?? (chainId === 84532 ? "https://sepolia.basescan.org" : chainId === 421614 ? "https://sepolia.arbiscan.io" : undefined);
  return defineChain({
    id: chainId,
    name,
    nativeCurrency,
    rpcUrls: { default: { http: [url] } },
    ...(explorer ? { blockExplorers: { default: { name: name, url: explorer } } } : {}),
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address } },
  });
}

export function loadBotContext(requireWallet = true): BotContext {
  const deployment = readDeployment();
  const url = rpcUrl(deployment);
  const chain = makeChain(deployment.chainId, url);
  const publicClient = createPublicClient({ chain, transport: http(url) });
  const privateKey = process.env.BOT_PRIVATE_KEY as Hex | undefined;
  const unlockedAddress = process.env.BOT_ADDRESS;
  if (requireWallet && !privateKey && !unlockedAddress) {
    throw new Error("Set BOT_PRIVATE_KEY, use an unlocked BOT_ADDRESS, or run with --dry-run");
  }
  if (privateKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("BOT_PRIVATE_KEY must be a 32-byte hex private key");
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain, transport: http(url) });
    return { deployment, rpcUrl: url, publicClient, walletClient, account };
  }
  if (unlockedAddress) {
    if (!isAddress(unlockedAddress)) throw new Error("BOT_ADDRESS must be an EVM address unlocked by the RPC node");
    const account = getAddress(unlockedAddress);
    const walletClient = createWalletClient({ account, chain, transport: http(url) });
    return { deployment, rpcUrl: url, publicClient, walletClient, account };
  }
  return { deployment, rpcUrl: url, publicClient };
}

export function addressAt(deployment: Deployment, ...names: string[]): Address {
  for (const name of names) {
    const value = deployment.contracts[name];
    if (value && isAddress(value)) return value;
  }
  throw new Error(`Deployment is missing contract address: ${names.join(" or ")}`);
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function isDryRun(): boolean {
  return hasFlag("--dry-run") || process.env.DRY_RUN === "1";
}

export function isOnce(): boolean {
  return hasFlag("--once");
}

export async function sendAndWait(
  context: BotContext,
  hash: Hex,
  label: string,
): Promise<void> {
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} transaction failed: ${hash}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function envInt(name: string, fallback: number, min?: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || (min !== undefined && value < min)) {
    throw new Error(`${name} must be a finite number${min !== undefined ? ` >= ${min}` : ""}`);
  }
  return value;
}

export function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultOn;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new Error(`${name} must be 0 or 1`);
}

export function logLine(component: string, fields: Record<string, unknown>): void {
  const parts = [`component=${component}`];
  for (const [key, value] of Object.entries(fields)) {
    if (key.toLowerCase().includes("key") && key.toLowerCase().includes("private")) continue;
    parts.push(`${key}=${formatLogValue(value)}`);
  }
  console.log(parts.join(" "));
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isRetryableRpcError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/execution reverted|AlreadySettled|PriceFeedNotFoundWithinRange|SeriesExists|NotKeeper|gas limit too high|transaction gas cap|breach reserve|would exceed.*wei/i.test(message)) {
    return false;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error ? Number((error as { code: unknown }).code) : undefined;
  if (code === -32000 || code === -32005 || code === -32603 || code === 429) return true;
  return /timeout|timed out|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|nonce too low|429|503|502|fetch failed|headers timeout|socket hang up/i.test(
    message,
  );
}

export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; label?: string; sleepFn?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const sleepFn = options.sleepFn ?? sleep;
  let delay = 400;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableRpcError(error) || i === attempts - 1) throw error;
      logLine("rpc", {
        event: "retry",
        label: options.label ?? "rpc",
        attempt: i + 1,
        delay_ms: delay,
      });
      await sleepFn(delay);
      delay = Math.min(delay * 2, 8_000);
    }
  }
  throw lastError;
}

/** Serialises signer transactions so at most one is in flight (nonce safety). */
export class SerialTx {
  private tail: Promise<void> = Promise.resolve();
  private inflight = 0;

  get inFlight(): number {
    return this.inflight;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    if (this.inflight !== 0) throw new Error("nonce safety: concurrent signer transaction");
    this.inflight = 1;
    try {
      return await fn();
    } finally {
      this.inflight = 0;
      release();
    }
  }
}

/** Pool-priced (demo/testnet) assets have a pool; Pyth-priced (mainnet) assets do not. Pool-only tools call this. */
export function requirePool(asset: { symbol: string; pool?: Address; token?: Address }): Address {
  if (!asset.pool) throw new Error(`${asset.symbol} is priced by Pyth and has no demo pool; this tool only works on pool-priced assets`);
  return asset.pool;
}
export function requireToken(asset: { symbol: string; pool?: Address; token?: Address }): Address {
  if (!asset.token) throw new Error(`${asset.symbol} has no demo token`);
  return asset.token;
}

/** Base's protocol gas oracle predeploy. It is read-only and costs no ETH. */
export const BASE_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" as Address;
export const DEFAULT_BASE_BUDGET_WEI = 35_000_000_000_000_000n; // 0.035 ETH
export const DEFAULT_ARB_BUDGET_WEI = 30_000_000_000_000_000n; // 0.03 ETH

const baseL1FeeUpperBoundAbi = [{
  type: "function",
  name: "getL1FeeUpperBound",
  stateMutability: "view",
  inputs: [{ name: "unsignedTxSize", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;
const baseL1FeeUpperBoundWithGasAbi = [{
  type: "function",
  name: "getL1FeeUpperBound",
  stateMutability: "view",
  inputs: [
    { name: "unsignedTxSize", type: "uint256" },
    { name: "txGasLimit", type: "uint256" },
  ],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

export interface GuardedWriteParameters {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  account: unknown;
  value?: bigint;
  chain?: unknown;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

function spendGuardDisabled(): boolean {
  return process.env.SKIP_SPEND_GUARD === "1" || process.env.SKIP_SPEND_GUARD === "true";
}

function defaultBudgetWei(chainId: number): bigint | undefined {
  if (chainId === 84532) return DEFAULT_BASE_BUDGET_WEI;
  if (chainId === 421614) return DEFAULT_ARB_BUDGET_WEI;
  const configured = tryLoadChain(chainId)?.budgetWei;
  return configured ? BigInt(configured) : undefined;
}

function budgetWei(chainId: number): bigint | undefined {
  const raw = process.env.EVM_BUDGET_WEI ?? process.env.BASE_BUDGET_WEI;
  const fallback = defaultBudgetWei(chainId);
  if (!raw) return fallback;
  try {
    const value = BigInt(raw);
    if (value < 0n) throw new Error();
    if (fallback !== undefined && value > fallback) throw new Error();
    return value;
  } catch {
    throw new Error(`EVM_BUDGET_WEI must be between 0 and the chain budget in wei`);
  }
}

function startBalanceOverride(): bigint | undefined {
  const raw = process.env.EVM_START_BALANCE_WEI ?? process.env.BASE_START_BALANCE_WEI;
  if (!raw) return undefined;
  try {
    const balance = BigInt(raw);
    if (balance < 0n) throw new Error();
    return balance;
  } catch {
    throw new Error("EVM_START_BALANCE_WEI must be a non-negative integer in wei");
  }
}

async function baseL1UpperBound(context: BotContext, serializedLength: bigint, gasLimit: bigint): Promise<bigint> {
  const read = context.publicClient.readContract as unknown as (parameters: Record<string, unknown>) => Promise<unknown>;
  try {
    return BigInt(await read({
      address: BASE_GAS_PRICE_ORACLE,
      abi: baseL1FeeUpperBoundAbi,
      functionName: "getL1FeeUpperBound",
      args: [serializedLength],
    }) as bigint);
  } catch {
    // Some older OP-stack nodes expose a two-argument form. Keep the guard
    // conservative and fail closed if neither ABI is available.
    try {
      return BigInt(await read({
        address: BASE_GAS_PRICE_ORACLE,
        abi: baseL1FeeUpperBoundWithGasAbi,
        functionName: "getL1FeeUpperBound",
        args: [serializedLength, gasLimit],
      }) as bigint);
    } catch (error) {
      throw new Error("Base gas oracle does not expose getL1FeeUpperBound", { cause: error });
    }
  }
}

function baseMaxFeePerGas(gasPrice: bigint): bigint {
  const raw = process.env.BASE_MAX_FEE_WEI;
  if (raw === undefined || raw === "") return gasPrice * 3n > 20_000_000n ? gasPrice * 3n : 20_000_000n;
  try {
    const value = BigInt(raw);
    if (value <= 0n) throw new Error();
    return value;
  } catch {
    throw new Error("BASE_MAX_FEE_WEI must be a positive integer in wei");
  }
}

function gasOracleOf(chainId: number): Address | undefined {
  const configured = tryLoadChain(chainId)?.l2?.gasOracle;
  if (configured) return configured;
  if (chainId === 84532) return BASE_GAS_PRICE_ORACLE;
  return undefined;
}

/**
 * Checks the cumulative native spend before a write on a budgeted EVM venue.
 * Base (0.04 ETH) and Arbitrum Sepolia (0.03 ETH) are guarded; forks can set
 * SKIP_SPEND_GUARD=1. OP-stack chains include the L1 data-fee upper bound.
 */
export async function assertBaseBudget(context: BotContext, parameters: GuardedWriteParameters): Promise<{ gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
  if (spendGuardDisabled()) return {};
  const chainId = context.deployment.chainId;
  const budget = budgetWei(chainId);
  if (budget === undefined) return {};
  const account = typeof context.account === "string" ? context.account : context.account?.address;
  if (!account) throw new Error("spend guard needs a signer account");
  if (context.baseStartBalanceWei === undefined) {
    context.baseStartBalanceWei = startBalanceOverride()
      ?? await context.publicClient.getBalance({ address: account as Address });
  }
  const estimate = context.publicClient.estimateContractGas as unknown as (value: Record<string, unknown>) => Promise<bigint>;
  const rawGas = await estimate({ ...parameters, chain: undefined });
  if (rawGas <= 0n) throw new Error("gas estimate must be positive");
  const paddedGas = (rawGas * 120n + 99n) / 100n;
  // EIP-7825: padding must not make an otherwise admissible Base tx exceed 2^24 gas.
  const txGasCap = chainId === 84532 ? 16_777_216n : undefined;
  if (txGasCap && rawGas > txGasCap) throw new Error("spend guard: estimate exceeds transaction gas cap");
  const gasLimit = txGasCap && paddedGas > txGasCap ? txGasCap : paddedGas;
  const gasPrice = await context.publicClient.getGasPrice();
  const maxFeePerGas = baseMaxFeePerGas(gasPrice);
  const maxPriorityFeePerGas = maxFeePerGas < 1_000_000n ? maxFeePerGas : 1_000_000n;
  const encode = encodeFunctionData as unknown as (value: { abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Hex;
  const callData = encode({
    abi: parameters.abi,
    functionName: parameters.functionName,
    ...(parameters.args ? { args: parameters.args } : {}),
  });
  const serializedLength = BigInt((callData.length - 2) / 2 + 68);
  const oracle = gasOracleOf(chainId);
  const l1Fee = oracle ? await baseL1UpperBound(context, serializedLength, gasLimit) : 0n;
  const current = await context.publicClient.getBalance({ address: account as Address });
  const spent = context.baseStartBalanceWei > current ? context.baseStartBalanceWei - current : 0n;
  const upperBound = gasLimit * maxFeePerGas + l1Fee;
  const reserve = BigInt(process.env.MIN_RESERVE_WEI ?? process.env.LIVE_MIN_RESERVE_WEI ?? "0");
  if (reserve < 0n || current < reserve + upperBound) {
    throw new Error(`spend guard: estimated transaction would breach reserve ${reserve} wei`);
  }
  logLine("spend-guard", { balance_wei: current, estimated_max_wei: upperBound, reserve_wei: reserve });
  if (spent + upperBound > budget) {
    throw new Error(`spend guard: ${spent + upperBound} wei would exceed ${budget} wei`);
  }
  return { gas: gasLimit, maxFeePerGas, maxPriorityFeePerGas };
}

export async function guardedWriteContract(context: BotContext, parameters: GuardedWriteParameters): Promise<Hex> {
  if (!context.walletClient) throw new Error("Write path needs BOT_PRIVATE_KEY or an unlocked BOT_ADDRESS");
  const fee = await assertBaseBudget(context, parameters);
  return (context.walletClient.writeContract as unknown as (value: GuardedWriteParameters) => Promise<Hex>)({ ...parameters, ...fee });
}
