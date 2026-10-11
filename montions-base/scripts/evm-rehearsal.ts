/**
 * Chain-generic fork rehearsal for a deployed Chainlink stack.
 *
 * The fork keeps the real Chainlink aggregator history. To make a historical
 * round usable as a future test event, this script finds a consecutive pair of
 * real rounds whose gap covers Book MIN_DURATION, rewinds only the local
 * aggregator's latest-round cursor to the predecessor, creates the series,
 * restores the cursor, and records the successor's real round id.
 *
 * Usage:
 *   CHAIN_ID=84532 DEPLOYMENT=deployments/84532.json \
 *   RPC_URL=http://127.0.0.1:8547 \
 *   BOT_ADDRESS=0x... \
 *   pnpm --dir bots exec tsx ../scripts/evm-rehearsal.ts
 *
 * This is intentionally local-fork-only. `anvil_setStorageAt` is rejected by
 * production RPCs and no private key is accepted or printed by this script.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  erc20Abi,
  makerVaultAbi,
  montionsBookAbi,
  priceOracleAbi,
  quoterAbi,
} from "../sdk/src/abi/index.js";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(resolve(ROOT, "bots/package.json"));
// scripts/ is outside the bots workspace, so use the workspace's installed viem
// through a package-rooted require instead of depending on a root node_modules.
const {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbiParameters,
  toBytes,
} = require("viem") as {
  createPublicClient: (...args: any[]) => any;
  createWalletClient: (...args: any[]) => any;
  defineChain: (...args: any[]) => any;
  encodeAbiParameters: (...args: any[]) => any;
  getAddress: (...args: any[]) => any;
  http: (...args: any[]) => any;
  isAddress: (...args: any[]) => any;
  keccak256: (...args: any[]) => any;
  parseAbiParameters: (...args: any[]) => any;
  toBytes: (...args: any[]) => any;
};
type Address = `0x${string}`;
type Hex = `0x${string}`;
const MIN_QUOTE_LIFE = 10n * 60n;
const DEFAULT_TRADE_QTY = 1n;
const DEFAULT_SETTLEMENT_QTY = 1n;
const MAX_STORAGE_SLOTS = 256;

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

const proxyAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "aggregator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "phaseId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const;

const oracleExtraAbi = [
  {
    type: "function",
    name: "feedOf",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "settleDelayOf",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "isHealthy",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const resolverExtraAbi = [
  {
    type: "function",
    name: "findRound",
    stateMutability: "view",
    inputs: [
      { name: "feed", type: "address" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "found", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feed", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "roundIdHint", type: "uint80" },
    ],
    outputs: [
      { name: "answer", type: "int256" },
      { name: "updatedAt", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "settlementOf",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [
      { name: "recorded", type: "bool" },
      { name: "priceWad", type: "uint256" },
      { name: "roundId", type: "uint80" },
      { name: "updatedAt", type: "uint64" },
    ],
  },
] as const;

const vaultAdminAbi = [
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type Manifest = {
  chainId?: number;
  rpc?: string;
  contracts?: Record<string, unknown>;
};

type SeriesInfo = {
  resolver: Address;
  data: Hex;
  expiry: bigint;
  status: number;
  yes: boolean;
  yesId: bigint;
  noId: bigint;
};

type RoundData = {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
};

type AggRoundData = RoundData;

type CursorPatch = {
  slot: bigint;
  mask: bigint;
  originalWord: bigint;
  rewoundWord: bigint;
};

type TradeTarget = {
  seriesId: Hex;
  info: SeriesInfo;
  fairTick: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`EVM REHEARSAL assertion failed: ${message}`);
}

function asAddress(value: unknown, field: string): Address {
  assert(typeof value === "string" && isAddress(value), `${field} must be an EVM address`);
  return getAddress(value);
}

function requiredContract(raw: Manifest, ...names: string[]): Address {
  const contracts = raw.contracts;
  assert(contracts && typeof contracts === "object", "manifest.contracts is required");
  for (const name of names) {
    const value = contracts[name];
    if (value !== undefined) return asAddress(value, `contracts.${name}`);
  }
  throw new Error(`deployment is missing contracts.${names.join(" or contracts.")}`);
}

function loadManifest(): { raw: Manifest; path: string } {
  const configured = process.env.DEPLOYMENT;
  assert(configured, "DEPLOYMENT must point to the deployed fork manifest");
  const path = isAbsolute(configured)
    ? configured
    : [resolve(process.cwd(), configured), resolve(ROOT, configured)].find((candidate) => existsSync(candidate)) ?? resolve(process.cwd(), configured);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  return { raw, path };
}

function bigintEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(raw);
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function word(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function tupleField(value: unknown, index: number, name: string): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (name in object) return object[name];
    if (String(index) in object) return object[String(index)];
  }
  return undefined;
}

function parseSeriesInfo(value: unknown): SeriesInfo {
  const resolverValue = tupleField(value, 0, "resolver");
  const dataValue = tupleField(value, 1, "data");
  const expiryValue = tupleField(value, 2, "expiry");
  const statusValue = tupleField(value, 3, "status");
  const yesValue = tupleField(value, 4, "yes");
  const yesIdValue = tupleField(value, 5, "yesId");
  const noIdValue = tupleField(value, 6, "noId");
  assert(resolverValue !== undefined && dataValue !== undefined && expiryValue !== undefined && statusValue !== undefined && yesValue !== undefined && yesIdValue !== undefined && noIdValue !== undefined, "seriesInfo returned too few fields");
  return {
    resolver: asAddress(resolverValue, "series.resolver"),
    data: dataValue as Hex,
    expiry: BigInt(expiryValue as bigint | number | string),
    status: Number(statusValue),
    yes: Boolean(yesValue),
    yesId: BigInt(yesIdValue as bigint | number | string),
    noId: BigInt(noIdValue as bigint | number | string),
  };
}

function parseRound(value: unknown): RoundData {
  const roundIdValue = tupleField(value, 0, "roundId");
  const answerValue = tupleField(value, 1, "answer");
  const updatedAtValue = tupleField(value, 3, "updatedAt");
  assert(roundIdValue !== undefined && answerValue !== undefined && updatedAtValue !== undefined, "Chainlink round returned too few fields");
  return {
    roundId: BigInt(roundIdValue as bigint | number | string),
    answer: BigInt(answerValue as bigint | number | string),
    updatedAt: BigInt(updatedAtValue as bigint | number | string),
  };
}

function parseRoundFromRaw(data: Hex): RoundData {
  const body = data.slice(2);
  assert(body.length >= 320, "latestRoundData returned malformed ABI data");
  const read = (index: number) => BigInt(`0x${body.slice(index * 64, (index + 1) * 64)}`);
  return { roundId: read(0), answer: read(1), updatedAt: read(3) };
}

function assertPositiveRound(round: RoundData, label: string): void {
  assert(round.roundId > 0n, `${label} round id is zero`);
  assert(round.answer > 0n, `${label} answer is not positive`);
  assert(round.updatedAt > 0n, `${label} updatedAt is zero`);
}

async function main(): Promise<void> {
  const { raw, path: manifestPath } = loadManifest();
  const rpcUrl = process.env.RPC_URL ?? raw.rpc;
  assert(rpcUrl, "RPC_URL or manifest.rpc is required");
  const botRaw = process.env.BOT_ADDRESS;
  assert(botRaw && isAddress(botRaw), "BOT_ADDRESS must be an RPC-unlocked EVM address");
  const bot = getAddress(botRaw);
  const chainId = Number(process.env.CHAIN_ID ?? raw.chainId);
  assert(Number.isSafeInteger(chainId) && chainId > 0, "CHAIN_ID or manifest.chainId is required");
  const chain = defineChain({
    id: chainId,
    name: `Montions chain ${chainId} fork`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: bot, chain, transport: http(rpcUrl) });

  const actualChainId = await publicClient.getChainId();
  assert(actualChainId === chainId, `RPC chain id ${actualChainId} does not match target ${chainId}`);
  const unlocked = (await publicClient.request({ method: "eth_accounts" } as never)) as string[];
  if (!unlocked.some((address) => lower(address) === lower(bot))) {
    console.log(`BOT_ADDRESS ${bot} is not listed by eth_accounts; continuing for Anvil impersonation mode`);
  }

  const book = requiredContract(raw, "book");
  const collateral = requiredContract(raw, "collateral");
  const oracle = requiredContract(raw, "chainlinkOracle", "oracle");
  const resolver = requiredContract(raw, "chainlinkResolver", "resolver");
  const quoter = requiredContract(raw, "quoter");
  const vault = requiredContract(raw, "vault", "makerVault");
  const tradeQty = bigintEnv("TRADE_QTY", DEFAULT_TRADE_QTY);
  const settlementQty = bigintEnv("SETTLEMENT_QTY", DEFAULT_SETTLEMENT_QTY);
  const reportFile = process.env.REHEARSAL_REPORT
    ? (isAbsolute(process.env.REHEARSAL_REPORT) ? process.env.REHEARSAL_REPORT : resolve(process.cwd(), process.env.REHEARSAL_REPORT))
    : resolve(ROOT, "deployments", "logs", String(chainId), "fork-rehearsal.json");
  assert(tradeQty > 0n && tradeQty <= 100n, "TRADE_QTY must be between 1 and 100");
  assert(settlementQty > 0n && settlementQty <= 100n, "SETTLEMENT_QTY must be between 1 and 100");
  const scanSlots = Math.max(64, Math.min(numberEnv("CHAINLINK_STORAGE_SLOTS", MAX_STORAGE_SLOTS), 1024));

  const originalBlock = await publicClient.getBlock();
  const originalTimestamp = originalBlock.timestamp;
  const unit = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "UNIT" })) as bigint;
  const minDuration = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "MIN_DURATION" })) as bigint;
  assert(unit === 1_000_000n, `unexpected Book UNIT ${unit}`);
  assert(minDuration >= 120n, `unexpected Book MIN_DURATION ${minDuration}`);

  const assetId = keccak256(toBytes(process.env.CHAINLINK_ASSET ?? "ETH"));
  const feed = (await publicClient.readContract({
    address: oracle,
    abi: oracleExtraAbi,
    functionName: "feedOf",
    args: [assetId],
  })) as Address;
  const settleDelay = BigInt(
    (await publicClient.readContract({ address: oracle, abi: oracleExtraAbi, functionName: "settleDelayOf", args: [assetId] })) as number,
  );
  assert(feed !== "0x0000000000000000000000000000000000000000", "selected Chainlink asset is not registered");
  const phase = (await publicClient.readContract({ address: feed, abi: proxyAbi, functionName: "phaseId" })) as number;
  const aggregator = (await publicClient.readContract({ address: feed, abi: proxyAbi, functionName: "aggregator" })) as Address;
  const originalAggLatest = parseRound(
    await publicClient.readContract({ address: aggregator, abi: aggregatorAbi, functionName: "latestRoundData" }),
  ) as AggRoundData;
  assertPositiveRound(originalAggLatest, "current Chainlink");
  assert(phase > 0, "Chainlink proxy phase is zero");
  const originalProxyLatest = parseRound(
    await publicClient.readContract({ address: feed, abi: proxyAbi, functionName: "latestRoundData" }),
  );
  assert(originalProxyLatest.updatedAt === originalAggLatest.updatedAt, "proxy and aggregator timestamps differ");

  console.log(`evm rehearsal: chain=${actualChainId} rpc=${rpcUrl}`);
  console.log(`manifest=${manifestPath}`);
  console.log(`contracts: book=${book} resolver=${resolver} oracle=${oracle} vault=${vault}`);
  console.log(`chainlink: feed=${feed} aggregator=${aggregator} phase=${phase} latestRound=${originalAggLatest.roundId} updatedAt=${originalAggLatest.updatedAt}`);

  const pair = await findSettlementPair(publicClient, aggregator, originalAggLatest.roundId, minDuration, settleDelay);
  const successor = pair.successor;
  const predecessor = pair.predecessor;
  assertPositiveRound(successor, "settlement successor");
  assertPositiveRound(predecessor, "settlement predecessor");
  const settlementExpiry = predecessor.updatedAt + minDuration;
  const createAt = predecessor.updatedAt;
  const cursorPatch = await findCursorPatch(publicClient, aggregator, originalAggLatest.roundId, predecessor.roundId, scanSlots, aggregatorAbi);
  assert(createAt < settlementExpiry, "settlement creation timestamp is not before expiry");
  assert(settlementExpiry <= originalTimestamp + 90n * 24n * 60n * 60n, "historical round pair cannot fit Book MAX_DURATION");
  const wrappedSuccessor = (BigInt(phase) << 64n) | successor.roundId;
  const wrappedPredecessor = (BigInt(phase) << 64n) | predecessor.roundId;
  console.log(`historical pair: predecessor=${predecessor.roundId}/${predecessor.updatedAt} successor=${successor.roundId}/${successor.updatedAt}`);
  console.log(`local-only cursor fixture: slot=${cursorPatch.slot} bitMask=${word(cursorPatch.mask)}`);

  try {
    const txs = await exerciseVaultTrades({
      publicClient,
      walletClient,
      bot,
      book,
      collateral,
      quoter,
      vault,
      resolver,
      now: originalTimestamp,
      unit,
      tradeQty,
      settlementQty,
    });

    await setStorage(publicClient, aggregator, cursorPatch.slot, cursorPatch.rewoundWord);
    const rewound = await readAggregatorRound(publicClient, aggregator, predecessor.roundId);
    assert(rewound.roundId === predecessor.roundId, "local Chainlink cursor did not rewind to predecessor");
    const rewoundProxy = parseRound(
      await publicClient.readContract({ address: feed, abi: proxyAbi, functionName: "latestRoundData" }),
    );
    assert(rewoundProxy.roundId === wrappedPredecessor, "proxy latest round is not the genuine predecessor phase round");

    await mineAt(publicClient, createAt);
    const health = (await publicClient.readContract({ address: oracle, abi: oracleExtraAbi, functionName: "isHealthy", args: [assetId] })) as boolean;
    assert(health, "Chainlink oracle is not healthy at historical creation timestamp");
    const latest = await publicClient.readContract({ address: oracle, abi: priceOracleAbi, functionName: "latestPrice", args: [assetId] });
    const strikeValue = tupleField(latest, 0, "priceWad");
    assert(strikeValue !== undefined, "historical Chainlink latestPrice returned no price");
    const strikeWad = BigInt(strikeValue as bigint | number | string);
    assert(strikeWad > 0n, "historical Chainlink spot is zero");
    const maxDelay = Number(settleDelay);
    const data = encodeAbiParameters(parseAbiParameters("address, bytes32, uint256, bool, uint32"), [oracle, assetId, strikeWad, true, maxDelay]);
    const createHash = await walletClient.writeContract({
      address: book,
      abi: montionsBookAbi,
      functionName: "createSeries",
      args: [resolver, data, settlementExpiry],
      account: bot,
      chain: undefined,
    });
    txs.set("settlementCreate", createHash);
    await waitForSuccess(publicClient, createHash, "historical settlement series creation");
    const settlementSeries = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "seriesIdOf", args: [resolver, data, settlementExpiry] })) as Hex;
    const settlementInfo = parseSeriesInfo(await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "seriesInfo", args: [settlementSeries] }));
    assert(settlementInfo.status === 1, "historical settlement series is not open");

    const settlementCash = settlementQty * unit;
    const settlementCashBefore = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "cash", args: [bot] })) as bigint;
    assert(settlementCashBefore >= settlementCash, `BOT cash ${settlementCashBefore} is below settlement split ${settlementCash}`);
    const splitHash = await walletClient.writeContract({ address: book, abi: montionsBookAbi, functionName: "split", args: [settlementSeries, settlementQty], account: bot, chain: undefined });
    txs.set("settlementSplit", splitHash);
    await waitForSuccess(publicClient, splitHash, "historical settlement split");

    await setStorage(publicClient, aggregator, cursorPatch.slot, cursorPatch.originalWord);
    const restored = parseRound(
      await publicClient.readContract({ address: aggregator, abi: aggregatorAbi, functionName: "latestRoundData" }),
    );
    assert(restored.roundId === originalAggLatest.roundId, "Chainlink cursor was not restored before settlement");
    const restoredProxy = parseRound(await publicClient.readContract({ address: feed, abi: proxyAbi, functionName: "latestRoundData" }));
    assert(restoredProxy.roundId === originalProxyLatest.roundId, "proxy latest round was not restored");
    // latestRoundData after restore may be newer than the settlement successor.
    // findRound rejects a latest round whose updatedAt is in the future, so jump
    // at least to the fork head (and never behind the successor).
    const settleAt = originalTimestamp > successor.updatedAt ? originalTimestamp : successor.updatedAt + 1n;
    await mineAt(publicClient, settleAt);

    const found = await publicClient.readContract({ address: resolver, abi: resolverExtraAbi, functionName: "findRound", args: [feed, settlementExpiry] });
    const foundRound = tupleField(found, 0, "roundId");
    const foundFlag = tupleField(found, 1, "found");
    assert(foundRound !== undefined && foundFlag !== undefined, "resolver findRound returned malformed data");
    assert(Boolean(foundFlag), "deployed resolver could not find a historical successor round");
    assert(BigInt(foundRound as bigint) === wrappedSuccessor, `resolver selected ${String(foundRound)}, expected genuine ${wrappedSuccessor}`);
    const recordHash = await walletClient.writeContract({ address: resolver, abi: resolverExtraAbi, functionName: "record", args: [feed, settlementExpiry, wrappedSuccessor], account: bot, chain: undefined });
    txs.set("settlementRecord", recordHash);
    await waitForSuccess(publicClient, recordHash, "historical Chainlink settlement record");
    const stored = await publicClient.readContract({ address: resolver, abi: resolverExtraAbi, functionName: "settlementOf", args: [assetId, settlementExpiry] });
    const storedRecorded = tupleField(stored, 0, "recorded");
    const storedPrice = tupleField(stored, 1, "priceWad");
    const storedRound = tupleField(stored, 2, "roundId");
    const storedUpdatedAt = tupleField(stored, 3, "updatedAt");
    assert(storedRecorded !== undefined && storedPrice !== undefined && storedRound !== undefined && storedUpdatedAt !== undefined, "resolver settlementOf returned malformed data");
    assert(Boolean(storedRecorded), "resolver did not record the historical round");
    assert(BigInt(storedRound as bigint) === wrappedSuccessor, "stored settlement round is not the genuine successor");
    assert(BigInt(storedUpdatedAt as bigint) === successor.updatedAt, "stored settlement timestamp differs from Chainlink history");
    const decimalsValue = await publicClient.readContract({ address: aggregator, abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const, functionName: "decimals" });
    const decimals = BigInt(decimalsValue as bigint | number | string);
    assert(decimals <= 18n, `Chainlink decimals ${decimals} exceeds WAD scale`);
    const expectedPriceWad = successor.answer * 10n ** (18n - decimals);
    assert(BigInt(storedPrice as bigint) === expectedPriceWad, "stored settlement price differs from genuine Chainlink answer");

    const resolveHash = await walletClient.writeContract({ address: book, abi: montionsBookAbi, functionName: "resolve", args: [settlementSeries], account: bot, chain: undefined });
    txs.set("settlementResolve", resolveHash);
    await waitForSuccess(publicClient, resolveHash, "historical settlement series resolve");
    const resolvedInfo = parseSeriesInfo(await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "seriesInfo", args: [settlementSeries] }));
    assert(resolvedInfo.status === 2, "historical settlement series did not resolve");
    const expectedYes = expectedPriceWad >= strikeWad;
    assert(resolvedInfo.yes === expectedYes, "Book outcome differs from resolver settlement");

    const yesBefore = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "balanceOf", args: [bot, settlementInfo.yesId] })) as bigint;
    const noBefore = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "balanceOf", args: [bot, settlementInfo.noId] })) as bigint;
    assert(yesBefore >= settlementQty && noBefore >= settlementQty, "split did not mint both settlement outcomes");
    const cashBeforeRedeem = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "cash", args: [bot] })) as bigint;
    const redeemHash = await walletClient.writeContract({ address: book, abi: montionsBookAbi, functionName: "redeem", args: [settlementSeries, settlementQty, settlementQty], account: bot, chain: undefined });
    txs.set("settlementRedeem", redeemHash);
    await waitForSuccess(publicClient, redeemHash, "historical settlement redeem");
    const cashAfterRedeem = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "cash", args: [bot] })) as bigint;
    assert(cashAfterRedeem - cashBeforeRedeem === settlementQty * unit, "redeem payout was not one UNIT per winning settlement contract");
    const yesAfter = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "balanceOf", args: [bot, settlementInfo.yesId] })) as bigint;
    const noAfter = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "balanceOf", args: [bot, settlementInfo.noId] })) as bigint;
    assert(yesAfter === yesBefore - settlementQty && noAfter === noBefore - settlementQty, "redeem did not burn both settlement outcomes");

    writeReport(reportFile, {
      success: true,
      chainId: actualChainId,
      bot,
      feed,
      aggregator,
      settlementSeries,
      settlementExpiry: settlementExpiry.toString(),
      predecessorRound: wrappedPredecessor.toString(),
      successorRound: wrappedSuccessor.toString(),
      predecessorUpdatedAt: predecessor.updatedAt.toString(),
      successorUpdatedAt: successor.updatedAt.toString(),
      outcome: resolvedInfo.yes ? "YES" : "NO",
      payout: (settlementQty * unit).toString(),
      txs: Object.fromEntries(txs),
    });
    console.log(`EVM REHEARSAL PASS chain=${actualChainId}: bought YES and NO from vault quotes; recorded real Chainlink round ${wrappedSuccessor}; resolved ${resolvedInfo.yes ? "YES" : "NO"}; redeemed ${settlementQty} pair(s)`);
  } finally {
    await setStorage(publicClient, aggregator, cursorPatch.slot, cursorPatch.originalWord);
    const block = await publicClient.getBlock();
    if (block.timestamp < originalTimestamp) await mineAt(publicClient, originalTimestamp);
  }
}

async function exerciseVaultTrades(parameters: {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  bot: Address;
  book: Address;
  collateral: Address;
  quoter: Address;
  vault: Address;
  resolver: Address;
  now: bigint;
  unit: bigint;
  tradeQty: bigint;
  settlementQty: bigint;
}): Promise<Map<string, Hex>> {
  const { publicClient, walletClient, bot, book, collateral, quoter, vault, resolver, now, unit, tradeQty, settlementQty } = parameters;
  const txs = new Map<string, Hex>();
  const count = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "seriesCount" })) as bigint;
  const candidates: TradeTarget[] = [];
  for (let i = 0n; i < count; i++) {
    const seriesId = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "seriesIdAt", args: [i] })) as Hex;
    const info = parseSeriesInfo(await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "seriesInfo", args: [seriesId] }));
    if (info.status !== 1 || lower(info.resolver) !== lower(resolver) || info.expiry <= now + MIN_QUOTE_LIFE) continue;
    const fair = await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "fair", args: [seriesId] });
    const fairValue = tupleField(fair, 0, "fairTick");
    assert(fairValue !== undefined, "Quoter fair returned malformed data");
    const fairTick = Number(fairValue);
    if (fairTick < 1 || fairTick > 99) continue;
    candidates.push({ seriesId, info, fairTick });
  }
  assert(candidates.length > 0, "no seeded future Chainlink series is open and quoteable");

  const selected: TradeTarget[] = [];
  for (const candidate of candidates) {
    if (selected.length >= 2) break;
    await ensureVaultQuote(publicClient, walletClient, bot, book, quoter, vault, candidate.seriesId, tradeQty);
    const yesQuote = parseQuote(await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteBuy", args: [candidate.seriesId, true, tradeQty, 99] }));
    const noQuote = parseQuote(await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteBuy", args: [candidate.seriesId, false, tradeQty, 99] }));
    if (yesQuote.complete && noQuote.complete && yesQuote.cost > 0n && noQuote.cost > 0n) selected.push(candidate);
  }
  assert(selected.length > 0, "vault has no complete YES/NO quotes on the seeded future series");
  const yesTarget = selected[0]!;
  const noTarget = selected[1] ?? yesTarget;
  const estimatedDeposit = tradeQty * unit * 4n + settlementQty * unit * 2n;
  const externalBalance = (await publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [bot] })) as bigint;
  assert(externalBalance >= estimatedDeposit, `BOT collateral ${externalBalance} is below rehearsal deposit ${estimatedDeposit}`);
  const allowance = (await publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "allowance", args: [bot, book] })) as bigint;
  if (allowance < estimatedDeposit) {
    const approveHash = await walletClient.writeContract({ address: collateral, abi: erc20Abi, functionName: "approve", args: [book, 2n ** 256n - 1n], account: bot, chain: undefined });
    txs.set("collateralApproval", approveHash);
    await waitForSuccess(publicClient, approveHash, "collateral approval");
  }
  const depositHash = await walletClient.writeContract({ address: book, abi: montionsBookAbi, functionName: "deposit", args: [estimatedDeposit], account: bot, chain: undefined });
  txs.set("bookDeposit", depositHash);
  await waitForSuccess(publicClient, depositHash, "BOT Book deposit");

  const yesQuote = parseQuote(await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteBuy", args: [yesTarget.seriesId, true, tradeQty, 99] }));
  const yesVaultOrder = await hasVaultOrder(publicClient, book, vault, yesTarget.seriesId, 1);
  assert(yesVaultOrder, "YES quote is not backed by an open vault ask");
  const yesHash = await walletClient.writeContract({
    address: book,
    abi: montionsBookAbi,
    functionName: "placeOrder",
    args: [{ seriesId: yesTarget.seriesId, side: 0, tick: yesQuote.worstTick, qty: tradeQty, fromHeld: false, tif: 1, maxFills: 0 }],
    account: bot,
    chain: undefined,
  });
  txs.set("buyYes", yesHash);
  await waitForSuccess(publicClient, yesHash, "vault-backed YES buy");
  const yesBalance = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "balanceOf", args: [bot, yesTarget.info.yesId] })) as bigint;
  assert(yesBalance >= tradeQty, "BOT did not receive YES after the vault-backed buy");

  const noQuote = parseQuote(await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteBuy", args: [noTarget.seriesId, false, tradeQty, 99] }));
  const noVaultOrder = await hasVaultOrder(publicClient, book, vault, noTarget.seriesId, 0);
  assert(noVaultOrder, "NO quote is not backed by an open vault bid");
  const noHash = await walletClient.writeContract({
    address: book,
    abi: montionsBookAbi,
    functionName: "placeOrder",
    args: [{ seriesId: noTarget.seriesId, side: 1, tick: 100 - noQuote.worstTick, qty: tradeQty, fromHeld: false, tif: 1, maxFills: 0 }],
    account: bot,
    chain: undefined,
  });
  txs.set("buyNo", noHash);
  await waitForSuccess(publicClient, noHash, "vault-backed NO buy");
  const noBalance = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "balanceOf", args: [bot, noTarget.info.noId] })) as bigint;
  assert(noBalance >= tradeQty, "BOT did not receive NO after the vault-backed buy");
  console.log(`vault trades: YES series=${yesTarget.seriesId} qty=${tradeQty} tick=${yesQuote.worstTick}; NO series=${noTarget.seriesId} qty=${tradeQty} tick=${noQuote.worstTick}`);
  return txs;
}

type Quote = { filled: bigint; cost: bigint; worstTick: number; complete: boolean };

function parseQuote(value: unknown): Quote {
  const filled = tupleField(value, 0, "filled");
  const cost = tupleField(value, 1, "cost");
  const worstTick = tupleField(value, 3, "worstTick");
  const complete = tupleField(value, 4, "complete");
  assert(filled !== undefined && cost !== undefined && worstTick !== undefined && complete !== undefined, "Quoter quote returned too few fields");
  return { filled: BigInt(filled as bigint | number | string), cost: BigInt(cost as bigint | number | string), worstTick: Number(worstTick), complete: Boolean(complete) };
}

async function ensureVaultQuote(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  bot: Address,
  book: Address,
  quoter: Address,
  vault: Address,
  seriesId: Hex,
  qty: bigint,
): Promise<void> {
  const beforeYes = parseQuote(await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteBuy", args: [seriesId, true, qty, 99] }));
  const beforeNo = parseQuote(await publicClient.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteBuy", args: [seriesId, false, qty, 99] }));
  if (beforeYes.complete && beforeNo.complete && beforeYes.cost > 0n && beforeNo.cost > 0n) return;
  const keeper = (await publicClient.readContract({ address: vault, abi: vaultAdminAbi, functionName: "keeper" })) as Address;
  assert(lower(keeper) === lower(bot), `vault keeper ${keeper} is not BOT_ADDRESS ${bot}`);
  const refreshHash = await walletClient.writeContract({ address: vault, abi: makerVaultAbi, functionName: "refresh", args: [seriesId], account: bot, chain: undefined });
  await waitForSuccess(publicClient, refreshHash, `vault refresh ${seriesId}`);
}

async function hasVaultOrder(
  publicClient: ReturnType<typeof createPublicClient>,
  book: Address,
  vault: Address,
  seriesId: Hex,
  side: number,
): Promise<boolean> {
  const orders = (await publicClient.readContract({ address: book, abi: montionsBookAbi, functionName: "ordersOf", args: [vault, 0n, 500n] })) as readonly unknown[];
  return orders.some((raw) => {
    const maker = tupleField(raw, 1, "maker");
    const itemSeries = tupleField(raw, 2, "seriesId");
    const itemSide = tupleField(raw, 3, "side");
    const open = tupleField(raw, 9, "open");
    return maker !== undefined && itemSeries !== undefined && itemSide !== undefined && open !== undefined && lower(String(maker)) === lower(vault) && String(itemSeries).toLowerCase() === seriesId.toLowerCase() && Number(itemSide) === side && Boolean(open);
  });
}

async function readAggregatorRound(
  publicClient: ReturnType<typeof createPublicClient>,
  aggregator: Address,
  roundId: bigint,
): Promise<AggRoundData> {
  return parseRound(await publicClient.readContract({ address: aggregator, abi: aggregatorAbi, functionName: "getRoundData", args: [roundId] }));
}

async function findSettlementPair(
  publicClient: ReturnType<typeof createPublicClient>,
  aggregator: Address,
  latestRoundId: bigint,
  minDuration: bigint,
  settleDelay: bigint,
): Promise<{ predecessor: AggRoundData; successor: AggRoundData }> {
  const maxLookback = 512;
  let current = latestRoundId;
  for (let i = 0; i < maxLookback && current > 1n; i++) {
    const successor = await readAggregatorRound(publicClient, aggregator, current);
    const predecessor = await readAggregatorRound(publicClient, aggregator, current - 1n);
    if (successor.roundId === current && predecessor.roundId === current - 1n && successor.updatedAt > predecessor.updatedAt) {
      const gap = successor.updatedAt - predecessor.updatedAt;
      const expiry = predecessor.updatedAt + minDuration;
      if (gap >= minDuration && expiry <= successor.updatedAt && successor.updatedAt <= expiry + settleDelay) {
        return { predecessor, successor };
      }
    }
    current -= 1n;
  }
  throw new Error(`no consecutive Chainlink rounds with gap >= MIN_DURATION ${minDuration}s in the last ${maxLookback} rounds`);
}

async function findCursorPatch(
  publicClient: ReturnType<typeof createPublicClient>,
  aggregator: Address,
  currentRound: bigint,
  toRound: bigint,
  scanSlots: number,
  abi: typeof aggregatorAbi,
): Promise<CursorPatch> {
  const slots = await Promise.all(
    Array.from({ length: scanSlots }, (_, index) =>
      publicClient.getStorageAt({ address: aggregator, slot: word(BigInt(index)) }),
    ),
  );
  assert(toRound > 0n, "Chainlink rewind target round is zero");
  const previous = await readAggregatorRound(publicClient, aggregator, toRound);
  const widths = [4, 8, 2, 1] as const;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const raw = slots[slotIndex];
    if (!raw) continue;
    const originalWord = BigInt(raw);
    for (const width of widths) {
      const bits = BigInt(width * 8);
      const fieldLimit = 1n << bits;
      if (currentRound >= fieldLimit || toRound >= fieldLimit) continue;
      for (let offset = 0; offset + width <= 32; offset++) {
        const shift = BigInt(offset * 8);
        const mask = (fieldLimit - 1n) << shift;
        if (((originalWord & mask) >> shift) !== currentRound) continue;
        const rewoundWord = (originalWord & ~mask) | (toRound << shift);
        if (rewoundWord === originalWord) continue;
        await setStorage(publicClient, aggregator, BigInt(slotIndex), rewoundWord);
        try {
          const observed = parseRound(await publicClient.readContract({ address: aggregator, abi, functionName: "latestRoundData" }));
          if (observed.roundId === toRound && observed.answer === previous.answer && observed.updatedAt === previous.updatedAt) {
            return { slot: BigInt(slotIndex), mask, originalWord, rewoundWord };
          }
        } finally {
          await setStorage(publicClient, aggregator, BigInt(slotIndex), originalWord);
        }
      }
    }
  }
  throw new Error(`could not locate the local Chainlink latest-round cursor in ${scanSlots} storage slots`);
}

async function setStorage(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Address,
  slot: bigint,
  value: bigint,
): Promise<void> {
  await publicClient.request({ method: "anvil_setStorageAt", params: [address, word(slot), word(value)] } as never);
}

async function mineAt(publicClient: ReturnType<typeof createPublicClient>, timestamp: bigint): Promise<void> {
  assert(timestamp <= BigInt(Number.MAX_SAFE_INTEGER), "timestamp exceeds JavaScript safe integer range");
  await publicClient.request({ method: "anvil_setTime", params: [Number(timestamp)] } as never);
  await publicClient.request({ method: "anvil_mine", params: ["0x1"] } as never);
  const block = await publicClient.getBlock();
  assert(block.timestamp === timestamp, `Anvil timestamp ${block.timestamp} did not reach ${timestamp}`);
}

async function waitForSuccess(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hex,
  label: string,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `${label} reverted (${hash})`);
}

function writeReport(path: string, report: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`rehearsal report: ${path}`);
}

main().catch((error: unknown) => {
  const configured = process.env.REHEARSAL_REPORT;
  const reportFile = configured
    ? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured))
    : resolve(ROOT, "deployments/logs/rehearsal-fail.json");
  try {
    writeReport(reportFile, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Preserve the original failure if the report directory is unavailable.
  }
  console.error(`EVM REHEARSAL FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
