import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { keccak256, stringToHex, parseAbi, type Address, type Hex } from 'viem';
import { loadBotContext, addressAt, isDryRun, guardedWriteContract, sendAndWait, type BotContext } from '../runtime.js';
import { readAllSeries, decodePriceSeriesData, type OnchainSeries } from '../seriesOps.js';
import { Hermes } from './hermes.js';
import { guardCost } from './gas.js';
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const config = JSON.parse(readFileSync(resolve(ROOT, 'config/pyth-stocks.json'), 'utf8')) as { assets: Asset[]; chains: Record<string, { pyth: Address; rpc: string }> };
export interface Asset { symbol: string; feedId: Hex; schedule: string; maxAge: number }
export const pythAbi = parseAbi(['function getUpdateFee(bytes[] data) view returns (uint256)', 'function updatePriceFeeds(bytes[] data) payable']);
export const resolverAbi = parseAbi(['function settle(bytes32 assetId,uint64 expiry,bytes[] data) payable', 'function isSettled(bytes32 assetId,uint64 expiry) view returns (bool)', 'function settlements(bytes32 assetId,uint64 expiry) view returns (int256,uint64,uint64,bool)', 'function pyth() view returns(address)', 'function oracle() view returns(address)']);
export const oracleAbi = parseAbi(['function feedIdOf(bytes32 assetId) view returns(bytes32)']);
export const assetId = (symbol: string) => keccak256(stringToHex(symbol));
export function loadEnv(): void { const p = resolve(ROOT, 'bots/.env'); if (existsSync(p)) process.loadEnvFile(p); }
export interface Runtime { context: BotContext; book: Address; resolver: Address; oracle: Address; pyth: Address; hermes: Hermes; dry: boolean }
export async function runtime(): Promise<Runtime> {
  loadEnv();
  const dry = isDryRun(), context = loadBotContext(!dry);
  const chain = config.chains[String(context.deployment.chainId)];
  if (!chain || await context.publicClient.getChainId() !== context.deployment.chainId) throw new Error('Unsupported or mismatched chain');
  const book = addressAt(context.deployment,'book'), resolver = addressAt(context.deployment,'pythStocksResolver'), oracle = addressAt(context.deployment,'pythStocksOracle');
  const read = context.publicClient.readContract;
  if ((await read({address:resolver,abi:resolverAbi,functionName:'pyth'})).toLowerCase() !== chain.pyth.toLowerCase() || (await read({address:resolver,abi:resolverAbi,functionName:'oracle'})).toLowerCase() !== oracle.toLowerCase()) throw new Error('Resolver binding mismatch');
  return { context, book, resolver, oracle, pyth:chain.pyth, hermes:new Hermes(process.env.PYTH_HERMES_API_KEY), dry };
}
export async function stocks(r: Runtime): Promise<OnchainSeries[]> {
  const result: OnchainSeries[] = [];
  for (const s of await readAllSeries(r.context,r.book)) {
    if (s.status !== 1 || s.resolver.toLowerCase() !== r.resolver.toLowerCase()) continue;
    const d = decodePriceSeriesData(s.data);
    if (!d || d.oracle.toLowerCase() !== r.oracle.toLowerCase() || d.window !== 300) throw new Error('Invalid Pyth stock series');
    const asset = config.assets.find(a => assetId(a.symbol) === d.assetId);
    if (!asset) throw new Error('Unknown stock asset');
    const actual = await r.context.publicClient.readContract({address:r.oracle,abi:oracleAbi,functionName:'feedIdOf',args:[d.assetId]});
    if (actual.toLowerCase() !== asset.feedId.toLowerCase()) throw new Error('Onchain feed mismatch');
    result.push(s);
  }
  return result;
}
export async function write(r: Runtime, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], value = 0n): Promise<void> {
  if (r.dry) { console.log(JSON.stringify({ dryRun:true, functionName, address, valueWei:value.toString() })); return; }
  if (process.env.ALLOW_LIVE_PYTH_STOCKS !== '1') throw new Error('Live keeper requires ALLOW_LIVE_PYTH_STOCKS=1');
  // Enforce existing L1-aware cumulative spend guard; never permit disabling it here.
  if (process.env.SKIP_SPEND_GUARD) throw new Error('Pyth stock spend guard cannot be disabled');
  if (await r.context.publicClient.getGasPrice() > BigInt(process.env.PYTH_MAX_GAS_PRICE_WEI ?? '1000000000')) throw new Error('Gas price guard');
  const parameters = { address,abi,functionName,args,value,account:r.context.account };
  const cost = await guardCost(r.context,parameters);
  console.log(JSON.stringify({functionName,estimatedMaxCostWei:cost.toString()}));
  const hash = await guardedWriteContract(r.context,parameters);
  await sendAndWait(r.context,hash,functionName);
}
export const isMain = (url: string) => process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
export async function loop(pass: () => Promise<void>): Promise<void> {
  do { await pass(); if (process.argv.includes('--once')) return; await new Promise(r => setTimeout(r, 10_000)); } while (true);
}
// Do not print raw RPC/fetch exceptions, which can contain secret headers or signer material.
export function fail(): void { console.error('Pyth stocks operation failed; check credentials, RPC, configuration and gas limits.'); process.exitCode = 1; }
