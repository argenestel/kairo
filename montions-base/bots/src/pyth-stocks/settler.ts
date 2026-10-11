import { offlineFixture } from './offline.js';
import { parseAbi, type Hex } from 'viem';
import { decodePriceSeriesData, type OnchainSeries } from '../seriesOps.js';
import { assetId, config, fail, isMain, loop, pythAbi, resolverAbi, runtime, stocks, write, type Runtime } from './common.js';
import { HermesError, validateUpdate } from './hermes.js';
const bookAbi = parseAbi(['function resolve(bytes32 seriesId)']);
export function settlementGroups(series: OnchainSeries[], now: number): Map<string, OnchainSeries[]> {
  const groups = new Map<string,OnchainSeries[]>();
  for (const s of series) {
    if (s.status !== 1 || now <= Number(s.expiry)) continue;
    const d = decodePriceSeriesData(s.data);
    if (!d || d.window !== 300) throw new Error('Invalid settlement definition');
    const key = `${d.assetId}:${s.expiry}`;
    groups.set(key,[...(groups.get(key) ?? []),s]);
  }
  return groups;
}
export async function settleGroup(r: Runtime, series: OnchainSeries[]): Promise<void> {
  const first = series[0]!;
  const id = decodePriceSeriesData(first.data)!.assetId, expiry = first.expiry;
  const asset = config.assets.find(a => assetId(a.symbol) === id);
  if (!asset) throw new Error('Unknown stock');
  const settled = await r.context.publicClient.readContract({address:r.resolver,abi:resolverAbi,functionName:'isSettled',args:[id,expiry]});
  if (!settled) {
    // Always ask for the ORIGINAL expiry. Never walk forward or substitute latest/close.
    const update = await r.hermes.updates([asset.feedId],Number(expiry));
    const data: Hex[] = validateUpdate(update,[asset.feedId],Number(expiry),Number(expiry)+300);
    const fee = await r.context.publicClient.readContract({address:r.pyth,abi:pythAbi,functionName:'getUpdateFee',args:[data]});
    await write(r,r.resolver,resolverAbi,'settle',[id,expiry,data],fee);
    if (r.dry) return; // No Book resolve simulation until settlement exists onchain.
  }
  const record = await r.context.publicClient.readContract({address:r.resolver,abi:resolverAbi,functionName:'settlements',args:[id,expiry]});
  // Book handles invalid/missing data through its existing two-day void grace.
  if (!record[3]) return;
  for (const s of series) await write(r,r.book,bookAbi,'resolve',[s.id]);
}
async function main(): Promise<void> {
  if (offlineFixture("settlement")) return;
  const r = await runtime();
  await loop(async () => {
    const now = Number((await r.context.publicClient.getBlock()).timestamp);
    for (const group of settlementGroups(await stocks(r),now).values()) {
      try { await settleGroup(r,group); }
      catch (e) {
        if (e instanceof HermesError && (e.status === 404 || e.status === 429)) {
          console.log(`Kairo Pyth settlement deferred: HTTP ${e.status}`); continue;
        }
        throw e;
      }
    }
  });
}
if (isMain(import.meta.url)) main().catch(fail);
