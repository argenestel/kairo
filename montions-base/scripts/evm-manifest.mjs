#!/usr/bin/env node
/*
 * Turn DeployEvm's contracts-only output plus config/chains.json into the
 * manifest consumed by the SDK, bots and UI.
 *
 * Usage:
 *   node scripts/evm-manifest.mjs <chainId> [deployments/<chainId>.json]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chainById, loadChainsConfig, repoRoot, strikeStepFor } from "./chain-config.mjs";

const root = repoRoot();
const chainId = Number(process.argv[2] ?? process.env.CHAIN_ID);
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error("usage: node scripts/evm-manifest.mjs <chainId> [out.json]");
}

const config = loadChainsConfig(root);
const chain = chainById(config, chainId);
if (chain.oracle !== "chainlink") {
  throw new Error(`evm-manifest only writes Chainlink venues; chain ${chainId} oracle=${chain.oracle}`);
}

const deploymentDir = resolve(root, "deployments");
const contractsPath = resolve(process.env.CONTRACTS_IN ?? `${deploymentDir}/${chainId}.contracts.json`);
const outputPath = resolve(process.argv[3] ?? process.env.MANIFEST_OUT ?? `${deploymentDir}/${chainId}.json`);
const liveManifest = resolve(deploymentDir, `${chainId}.json`);
const liveContracts = resolve(deploymentDir, `${chainId}.contracts.json`);
if (process.env.FORK_REHEARSAL === "1" && process.env.ALLOW_LIVE_MANIFEST_OVERWRITE !== "1") {
  if (outputPath === liveManifest || contractsPath === liveContracts) {
    throw new Error(
      `fork rehearsal must not overwrite live manifest ${liveManifest} (got out=${outputPath} contracts=${contractsPath})`,
    );
  }
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse ${label}: ${path}`, { cause: error });
  }
}

const rawDeployment = readJson(contractsPath, "deployment output");
if (Number(rawDeployment.chainId) !== chainId) {
  throw new Error(`deployment output has chainId ${rawDeployment.chainId}; expected ${chainId}`);
}

const contracts = Object.fromEntries(
  Object.entries(rawDeployment.contracts ?? {}).filter(([, value]) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)),
);
for (const required of ["book", "bookEngine", "quoter", "collateral", "vault", "chainlinkOracle", "chainlinkResolver"]) {
  if (!contracts[required]) throw new Error(`deployment output is missing contracts.${required}`);
}

const rpc = process.env.MANIFEST_RPC || process.env.RPC_URL || chain.rpc;

function assetId(symbol) {
  return execFileSync("cast", ["keccak", symbol], { cwd: root, encoding: "utf8" }).trim();
}

function registeredAssetIds() {
  if (process.env.VERIFY_REGISTERED === "0") return undefined;
  try {
    const output = execFileSync(
      "cast",
      ["call", contracts.chainlinkOracle, "assets()(bytes32[])", "--rpc-url", rpc],
      { cwd: root, encoding: "utf8" },
    );
    const ids = new Set((output.match(/0x[0-9a-fA-F]{64}/g) ?? []).map((id) => id.toLowerCase()));
    if (ids.size === 0) throw new Error("ChainlinkOracle.assets() returned no registered asset ids");
    return ids;
  } catch (error) {
    if (process.env.MANIFEST_ALLOW_UNVERIFIED === "1") {
      console.warn(`could not verify registered assets; including the config table: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    throw new Error(
      `Unable to read registered assets from ${contracts.chainlinkOracle}; set MANIFEST_ALLOW_UNVERIFIED=1 only for an offline manifest`,
      { cause: error },
    );
  }
}

const registered = registeredAssetIds();
function registeredFeedFor(id) {
  try {
    return execFileSync(
      "cast",
      ["call", contracts.chainlinkOracle, "feedOf(bytes32)(address)", id, "--rpc-url", rpc],
      { cwd: root, encoding: "utf8" },
    ).trim().match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
  } catch (error) {
    if (process.env.MANIFEST_ALLOW_UNVERIFIED === "1") return undefined;
    throw new Error(`Unable to read feedOf(${id}) from ${contracts.chainlinkOracle}`, { cause: error });
  }
}

function readSidecar(name) {
  const candidates = [
    resolve(deploymentDir, `${chainId}.${name}.json`),
    ...(process.env.FORK_REHEARSAL === "1" ? [
      resolve(deploymentDir, "rehearsal", `${name}-${chainId}.json`),
      resolve(deploymentDir, "rehearsal", `${chainId}.${name}.json`),
    ] : []),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* skip */
    }
  }
  return null;
}

const stocksSidecar = readSidecar("stocks");
if (stocksSidecar?.hub && /^0x[0-9a-fA-F]{40}$/.test(stocksSidecar.hub)) {
  contracts.keeperFeedHub = stocksSidecar.hub;
}
const eventsSidecar = readSidecar("events");
if (eventsSidecar?.eventResolver && /^0x[0-9a-fA-F]{40}$/.test(eventsSidecar.eventResolver)) {
  contracts.eventResolver = eventsSidecar.eventResolver;
}

const assets = chain.assets.map((feed) => {
  if (!feed || typeof feed.symbol !== "string" || !feed.symbol) throw new Error("Every feed needs a symbol");
  const sidecarFeed = stocksSidecar?.feeds?.[feed.symbol];
  const configFeed = typeof feed.feed === "string" && /^0x[0-9a-fA-F]{40}$/.test(feed.feed) ? feed.feed : undefined;
  let resolvedFeed = configFeed || (typeof sidecarFeed === "string" ? sidecarFeed : undefined);
  if (!Number.isSafeInteger(feed.decimals) || feed.decimals < 0 || feed.decimals > 255) {
    throw new Error(`Invalid decimals for ${feed.symbol}`);
  }
  if (!Number.isSafeInteger(feed.settleDelay) || feed.settleDelay <= 0) {
    throw new Error(`Invalid settleDelay for ${feed.symbol}`);
  }
  const id = assetId(feed.symbol);
  if (registered && !registered.has(id.toLowerCase())) return null;
  const onchainFeed = registeredFeedFor(id);
  if (!resolvedFeed && onchainFeed) resolvedFeed = onchainFeed;
  if (!resolvedFeed || !/^0x[0-9a-fA-F]{40}$/.test(resolvedFeed)) return null;
  if (onchainFeed && onchainFeed !== resolvedFeed.toLowerCase()) {
    throw new Error(`Chainlink feed mismatch for ${feed.symbol}: config=${resolvedFeed} onchain=${onchainFeed}`);
  }
  const ladder = feed.ladder === true && (feed.quote ?? "USD").toUpperCase() === "USD"
    && (config.canonicalAssets ?? []).includes(feed.symbol.toUpperCase());
  return {
    symbol: feed.symbol,
    name: feed.name ?? feed.display ?? feed.symbol,
    assetId: id,
    feed: resolvedFeed,
    decimals: feed.decimals,
    quote: feed.quote ?? "USD",
    oracle: "chainlink",
    settleDelay: feed.settleDelay,
    ladder,
    strikeStep: strikeStepFor(config, feed.symbol, feed),
    ...(typeof feed.tier === "string" ? { tier: feed.tier } : {}),
    mock: false,
  };
}).filter(Boolean);
if (assets.length === 0) throw new Error("No configured feed is registered in ChainlinkOracle");

const configuredRpcs = (process.env.RPCS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const rpcs = [...new Set(configuredRpcs.filter((value) => value !== rpc))];
const startBlock = rawDeployment.startBlock ?? rawDeployment.blockNumber;
if (startBlock === undefined || !/^\d+$/.test(String(startBlock))) throw new Error("deployment output is missing startBlock");

const manifest = {
  chainId,
  network: chain.network ?? "testnet",
  oracle: "chainlink",
  rpc,
  ...(rpcs.length ? { rpcs } : {}),
  explorer: chain.explorer.replace(/\/$/, ""),
  contracts,
  assets,
  startBlock: String(startBlock),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest written: ${outputPath}`);
