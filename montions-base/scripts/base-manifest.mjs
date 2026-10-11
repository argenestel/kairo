#!/usr/bin/env node
/*
 * Turn DeployBase's contracts-only output plus the checked-in feed table into
 * the manifest consumed by the SDK, bots and UI.
 *
 * Usage:
 *   node scripts/base-manifest.mjs [deployments/84532.json]
 *
 * The deploy script writes deployments/84532.contracts.json. Feed metadata is
 * deliberately sourced from config/base-sepolia-feeds.json so a manifest can
 * be regenerated without querying or trusting an indexer.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const chainId = 84532;
const deploymentDir = resolve(root, "deployments");
const contractsPath = resolve(process.env.CONTRACTS_IN ?? `${deploymentDir}/${chainId}.contracts.json`);
const configPath = resolve(process.env.FEEDS_CONFIG ?? `${root}/config/base-sepolia-feeds.json`);
const outputPath = resolve(process.argv[2] ?? process.env.MANIFEST_OUT ?? `${deploymentDir}/${chainId}.json`);

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse ${label}: ${path}`, { cause: error });
  }
}

const rawDeployment = readJson(contractsPath, "Base deployment output");
const config = readJson(configPath, "Base feed configuration");
if (Number(rawDeployment.chainId) !== chainId) {
  throw new Error(`Base deployment output has chainId ${rawDeployment.chainId}; expected ${chainId}`);
}
if (!Array.isArray(config.feeds) || config.feeds.length === 0) throw new Error("Base feed configuration has no feeds");

const contracts = Object.fromEntries(
  Object.entries(rawDeployment.contracts ?? {}).filter(([, value]) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)),
);
for (const required of ["book", "bookEngine", "quoter", "collateral", "vault", "chainlinkOracle", "chainlinkResolver"]) {
  if (!contracts[required]) throw new Error(`Base deployment output is missing contracts.${required}`);
}

const rpc = process.env.RPC_URL ?? "https://sepolia.base.org";

function assetId(symbol) {
  // cast keccak hashes the UTF-8 symbol exactly as ChainlinkOracle.setFeed did.
  return execFileSync("cast", ["keccak", symbol], { cwd: root, encoding: "utf8" }).trim();
}

function registeredAssetIds() {
  if (process.env.VERIFY_REGISTERED === "0") return undefined;
  try {
    const output = execFileSync("cast", ["call", contracts.chainlinkOracle, "assets()(bytes32[])", "--rpc-url", rpc], { cwd: root, encoding: "utf8" });
    const ids = new Set((output.match(/0x[0-9a-fA-F]{64}/g) ?? []).map((id) => id.toLowerCase()));
    if (ids.size === 0) throw new Error("ChainlinkOracle.assets() returned no registered asset ids");
    return ids;
  } catch (error) {
    if (process.env.MANIFEST_ALLOW_UNVERIFIED === "1") {
      console.warn(`could not verify registered Base assets; including the config table: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    throw new Error(`Unable to read registered Base assets from ${contracts.chainlinkOracle}; set MANIFEST_ALLOW_UNVERIFIED=1 only for an offline manifest`, { cause: error });
  }
}

const registered = registeredAssetIds();
function registeredFeedFor(id) {
  try {
    return execFileSync("cast", ["call", contracts.chainlinkOracle, "feedOf(bytes32)(address)", id, "--rpc-url", rpc], { cwd: root, encoding: "utf8" }).trim().match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
  } catch (error) {
    if (process.env.MANIFEST_ALLOW_UNVERIFIED === "1") return undefined;
    throw new Error(`Unable to read feedOf(${id}) from ${contracts.chainlinkOracle}`, { cause: error });
  }
}

const assets = config.feeds.map((feed) => {
  if (!feed || typeof feed.symbol !== "string" || !feed.symbol) throw new Error("Every Base feed needs a symbol");
  if (typeof feed.feed !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(feed.feed)) throw new Error(`Invalid feed address for ${feed.symbol}`);
  if (!Number.isSafeInteger(feed.decimals) || feed.decimals < 0 || feed.decimals > 255) throw new Error(`Invalid decimals for ${feed.symbol}`);
  if (!Number.isSafeInteger(feed.settleDelay) || feed.settleDelay <= 0) throw new Error(`Invalid settleDelay for ${feed.symbol}`);
  const id = assetId(feed.symbol);
  if (registered && !registered.has(id.toLowerCase())) return null;
  const onchainFeed = registeredFeedFor(id);
  if (onchainFeed && onchainFeed !== feed.feed.toLowerCase()) {
    throw new Error(`Chainlink feed mismatch for ${feed.symbol}: config=${feed.feed} onchain=${onchainFeed}`);
  }
  return {
    symbol: feed.symbol,
    name: feed.name ?? feed.display ?? feed.symbol,
    assetId: id,
    feed: feed.feed,
    decimals: feed.decimals,
    quote: feed.quote ?? "USD",
    oracle: "chainlink",
    settleDelay: feed.settleDelay,
    // The UI and seed bot list every USD feed, including stablecoins. Ratio
    // feeds remain registered for oracle reads but are outside the USD ladder.
    ladder: (feed.quote ?? "USD").toUpperCase() === "USD",
    ...(feed.strikeStep === undefined ? {} : { strikeStep: feed.strikeStep }),
    ...(typeof feed.tier === "string" ? { tier: feed.tier } : {}),
    mock: false,
  };
}).filter(Boolean);
if (assets.length === 0) throw new Error("No configured Base feed is registered in ChainlinkOracle");

const configuredRpcs = (process.env.RPCS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const rpcs = [...new Set(configuredRpcs.filter((value) => value !== rpc))];
const startBlock = rawDeployment.startBlock ?? rawDeployment.blockNumber;
if (startBlock === undefined || !/^\d+$/.test(String(startBlock))) throw new Error("Base deployment output is missing startBlock");

const manifest = {
  chainId,
  network: "testnet",
  oracle: "chainlink",
  rpc,
  ...(rpcs.length ? { rpcs } : {}),
  explorer: "https://sepolia.basescan.org",
  contracts,
  assets,
  startBlock: String(startBlock),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest written: ${outputPath}`);
