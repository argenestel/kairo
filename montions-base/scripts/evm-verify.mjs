#!/usr/bin/env node
import fs from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http } from "../bots/node_modules/viem/_esm/index.js";
import { chainById, loadChainsConfig, repoRoot } from "./chain-config.mjs";

const root = repoRoot();
const chainId = Number(process.env.CHAIN_ID ?? process.argv[2]);
if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("CHAIN_ID or argv chainId required");
const chain = chainById(loadChainsConfig(root), chainId);
const path = process.env.DEPLOYMENT ?? resolve(root, `deployments/${chainId}.json`);
const d = JSON.parse(fs.readFileSync(path, "utf8"));
const rpc = process.env.RPC_URL ?? d.rpc ?? chain.rpc;
const client = createPublicClient({ transport: http(rpc) });
const abi = (name) => JSON.parse(fs.readFileSync(resolve(root, `out/${name}.sol/${name}.json`))).abi;
if (await client.getChainId() !== chainId) throw new Error(`Wrong chain: expected ${chainId}`);
const read = (contract, name, functionName, args = []) =>
  client.readContract({ address: d.contracts[contract], abi: abi(name), functionName, args });
for (const [name, address] of Object.entries(d.contracts)) {
  if (!address || await client.getCode({ address }) === undefined) throw new Error(`Missing code ${name}`);
}
const count = await read("book", "MontionsBook", "seriesCount");
const nav = await read("vault", "MakerVault", "totalAssets");
const assets = await read("chainlinkOracle", "ChainlinkOracle", "assetCount");
if (!count || !nav || assets < 3n) throw new Error("Empty deployment");
const ids = await read("book", "MontionsBook", "seriesIds", [0n, 1n]);
const id = ids[0];
const fair = await read("quoter", "Quoter", "fair", [id]);
const depth = await read("book", "MontionsBook", "bestBidAsk", [id]);
const quote = await read("quoter", "Quoter", "quoteBuy", [id, true, 1n, 99]);
if (!fair[0] || !quote.filled) throw new Error("Sample series has no executable quote");
const result = {
  chainId,
  seriesCount: count,
  assetCount: assets,
  vaultNAV: nav,
  sampleSeries: id,
  fair,
  bestBidAsk: depth,
  quote,
};
const output = JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
console.log(output);
const outDir = resolve(root, "deployments", "logs", String(chainId));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(process.env.VERIFY_OUT ?? resolve(outDir, "live-readback.json"), `${output}\n`);
