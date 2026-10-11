import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chainById,
  parseChainsConfig,
  strikeStepFor,
  type ChainAssetConfig,
  type ChainEntry,
  type ChainsConfig,
} from "../../sdk/src/chains-config.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const CHAINS_CONFIG_PATH = resolve(REPO_ROOT, "config/chains.json");

export {
  chainById,
  parseChainsConfig,
  strikeStepFor,
  type ChainAssetConfig,
  type ChainEntry,
  type ChainsConfig,
};

let cached: ChainsConfig | undefined;

export function chainsConfigPath(): string {
  const configured = process.env.CHAINS_CONFIG;
  if (!configured) return CHAINS_CONFIG_PATH;
  if (configured.startsWith("/")) return configured;
  const fromCwd = resolve(process.cwd(), configured);
  return existsSync(fromCwd) ? fromCwd : resolve(REPO_ROOT, configured);
}

export function loadChainsConfig(): ChainsConfig {
  if (cached) return cached;
  const path = chainsConfigPath();
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${path}`, { cause: error });
  }
  cached = parseChainsConfig(JSON.parse(json) as unknown);
  return cached;
}

export function loadChain(chainId: number): ChainEntry {
  return chainById(loadChainsConfig(), chainId);
}

export function tryLoadChain(chainId: number): ChainEntry | undefined {
  try {
    return loadChain(chainId);
  } catch {
    return undefined;
  }
}

export function ladderAssets(chain: ChainEntry, symbols?: Set<string>): ChainAssetConfig[] {
  const config = loadChainsConfig();
  return chain.assets.filter((asset) => {
    if (!asset.ladder) return false;
    if (symbols && symbols.size > 0 && !symbols.has(asset.symbol.toUpperCase())) return false;
    // Cross-chain thesis: only seed the shared canonical set (ETH/BTC/LINK/SOL).
    if (!config.canonicalAssets.includes(asset.symbol.toUpperCase())) return false;
    return true;
  });
}

export function logsDir(chainId: number, repoRoot = REPO_ROOT): string {
  return resolve(repoRoot, "deployments", "logs", String(chainId));
}
