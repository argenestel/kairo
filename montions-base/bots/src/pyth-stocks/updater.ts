import { offlineFixture } from './offline.js';
import { assetId, config, fail, isMain, loop, pythAbi, runtime, stocks, write, type Asset, type Runtime } from './common.js';
import { validateUpdate, type Metadata } from './hermes.js';
import { marketOpen } from './session.js';
import { decodePriceSeriesData, type OnchainSeries } from '../seriesOps.js';

export function selectUpdates(assets: Asset[], series: OnchainSeries[], now: number, last: Map<string, number>, expiries: Set<string>): Asset[] {
  return assets.filter(a => {
    const atExpiry = series.some(s => decodePriceSeriesData(s.data)?.assetId === assetId(a.symbol) && now >= Number(s.expiry) && now <= Number(s.expiry) + 300 && !expiries.has(`${a.symbol}:${s.expiry}`));
    return atExpiry || (marketOpen(a.schedule,now) && now - (last.get(a.symbol) ?? 0) >= 900);
  });
}
export async function updateBatch(r: Runtime, assets: Asset[], now: number): Promise<void> {
  if (!assets.length) return;
  const ids = assets.map(a => a.feedId);
  const update = await r.hermes.updates(ids);
  const data = validateUpdate(update,ids,now - Math.min(...assets.map(a => a.maxAge)),now);
  const fee = await r.context.publicClient.readContract({address:r.pyth,abi:pythAbi,functionName:'getUpdateFee',args:[data]});
  await write(r,r.pyth,pythAbi,'updatePriceFeeds',[data],fee);
}
export function verifiedSchedules(metadata: Metadata[]): Asset[] {
  return config.assets.map(a => {
    const feed = metadata.find(f => f.attributes.symbol === `Equity.US.${a.symbol}/USD`);
    if (!feed || `0x${feed.id}`.toLowerCase() !== a.feedId.toLowerCase()) throw new Error('Hermes feed catalog mismatch');
    return {...a,schedule:feed.attributes.schedule};
  });
}
async function main(): Promise<void> {
  if (offlineFixture("latest")) return;
  const r = await runtime(), last = new Map<string,number>(), expiries = new Set<string>();
  let assets = verifiedSchedules(await r.hermes.metadata()), metadataAt = 0;
  await loop(async () => {
    const now = Number((await r.context.publicClient.getBlock()).timestamp);
    if (now - metadataAt > 86400) { assets = verifiedSchedules(await r.hermes.metadata()); metadataAt = now; }
    const series = await stocks(r), due = selectUpdates(assets,series,now,last,expiries);
    await updateBatch(r,due,now);
    for (const a of due) {
      last.set(a.symbol,now);
      for (const s of series) if (decodePriceSeriesData(s.data)?.assetId === assetId(a.symbol) && now >= Number(s.expiry) && now <= Number(s.expiry) + 300) expiries.add(`${a.symbol}:${s.expiry}`);
    }
    console.log(`Kairo Pyth updater: ${due.length} feeds selected`);
  });
}
if (isMain(import.meta.url)) main().catch(fail);
