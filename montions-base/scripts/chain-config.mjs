import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function repoRoot() {
  return resolve(new URL("..", import.meta.url).pathname);
}

export function loadChainsConfig(root = repoRoot()) {
  const path = process.env.CHAINS_CONFIG ?? resolve(root, "config/chains.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function chainById(config, chainId) {
  const id = Number(chainId);
  const found = (config.chains ?? []).find((chain) => Number(chain.chainId) === id);
  if (!found) throw new Error(`config/chains.json has no entry for chainId ${chainId}`);
  return found;
}

export function strikeStepFor(config, symbol, asset) {
  const upper = String(symbol).toUpperCase();
  if (config.strikeGrids && config.strikeGrids[upper] !== undefined) return config.strikeGrids[upper];
  if (asset?.strikeStep !== undefined) return asset.strikeStep;
  throw new Error(`No strike grid for ${symbol}`);
}
