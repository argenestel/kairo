import { checkCost } from './gas.js';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { type Hex } from 'viem';
import { Hermes, HermesError, validateUpdate, type Update, type Metadata } from './hermes.js';
import { marketOpen } from './session.js';
import { assetId, config, type Runtime } from './common.js';
import { selectUpdates, verifiedSchedules, updateBatch } from './updater.js';
import { settlementGroups, settleGroup } from './settler.js';
import { encodePriceSeriesData, type OnchainSeries } from '../seriesOps.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/update.mock.json', import.meta.url),'utf8')) as Update;
const metadata = JSON.parse(readFileSync(new URL('./fixtures/metadata.json', import.meta.url),'utf8')) as Metadata[];
const a = config.assets[0]!, now = fixture.parsed[0]!.price.publish_time;
const addr = '0x1111111111111111111111111111111111111111';
const series = (expiry: number, strike=380n * 10n**18n): OnchainSeries => ({ id: ('0x'+'01'.repeat(32)) as Hex, data:encodePriceSeriesData(addr,assetId(a.symbol),strike,true,300),resolver:addr,expiry:BigInt(expiry),status:1,yes:false });
function mockRuntime(settled = false) {
  const read = vi.fn(async (p: {functionName:string}) => p.functionName === 'isSettled' ? settled : p.functionName === 'settlements' ? [1n,1n,1n,true] : 10n);
  const updates = vi.fn(async () => structuredClone(fixture));
  const r = { context:{publicClient:{readContract:read}},hermes:{updates},dry:true,pyth:addr,resolver:addr,book:addr } as unknown as Runtime;
  return {r,read,updates};
}
describe('Kairo Pyth stocks', () => {
  it('caps combined execution, L1 and Pyth fee and preserves balance reserve', () => {
    expect(()=>checkCost(1000n,950n,50n,100n,900n)).not.toThrow();
    expect(()=>checkCost(1000n,950n,51n,100n,0n)).toThrow();
    expect(()=>checkCost(1000n,950n,50n,100n,901n)).toThrow();
  });
  it('records 29 exact catalog matches, unique feeds and valid operator volatility', () => {
    expect(verifiedSchedules(metadata)).toHaveLength(29);
    expect(new Set(config.assets.map(a=>a.feedId)).size).toBe(29);
  });
  it('rejects changed IDs at startup', () => expect(()=>verifiedSchedules(metadata.map((m,i)=>i===0?{...m,id:'00'}:m))).toThrow());
  it('requires credentials, adds server-side bearer and never returns response bodies in errors', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(fixture),{status:200}));
    await expect(new Hermes(undefined,fetcher).updates([a.feedId])).rejects.toThrow('PYTH_HERMES_API_KEY');
    expect(fetcher).not.toHaveBeenCalled();
    const h = new Hermes('test-secret',fetcher,async()=>{});
    await h.updates([a.feedId],now);
    expect(fetcher.mock.calls[0]?.[0]).toContain(`/price/${now}?`);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({Authorization:'Bearer test-secret'});
    for (const status of [401,403,404,429,500]) {
      const failing = new Hermes('test-secret',async()=>new Response('test-secret',{status}),async()=>{});
      await expect(failing.updates([a.feedId])).rejects.toThrow(`Hermes HTTP ${status}`);
    }
  });
  it('serializes requests and rate limits even after errors', async () => {
    const sleep = vi.fn(async(_ms: number)=>{}), fetcher = vi.fn(async()=>new Response('{}'));
    const h = new Hermes('test-key',fetcher,sleep);
    await Promise.all([h.metadata(),h.metadata(),h.metadata()]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[1]![0]).toBeGreaterThan(1000);
  });
  it('validates exact feeds, timestamps, binary and confidence', () => {
    expect(validateUpdate(fixture,[a.feedId],now,now+300)).toEqual(['0x504e4155010000']);
    expect(()=>validateUpdate(fixture,[config.assets[1]!.feedId],now,now+300)).toThrow('Missing');
    expect(()=>validateUpdate(fixture,[a.feedId],now+1,now+301)).toThrow('window');
    for (const change of [{price:'0'},{conf:'900000000'},{expo:-19},{publish_time:now+301}]) {
      const f=structuredClone(fixture);Object.assign(f.parsed[0]!.price,change);
      expect(()=>validateUpdate(f,[a.feedId],now,now+300)).toThrow();
    }
    const malformed=structuredClone(fixture);malformed.binary.data=['zz'];
    expect(()=>validateUpdate(malformed,[a.feedId],now,now+300)).toThrow();
  });
  it('handles weekends, holidays, half days and DST', () => {
    const check=(time:string)=>marketOpen(a.schedule,Date.parse(time)/1000);
    expect(check('2026-10-12T13:30:00Z')).toBe(true);
    expect(check('2026-10-12T20:00:00Z')).toBe(false);
    expect(check('2026-10-11T15:00:00Z')).toBe(false);
    expect(check('2026-11-02T14:29:00Z')).toBe(false);
    expect(check('2026-11-02T14:30:00Z')).toBe(true);
    expect(check('2026-11-26T16:00:00Z')).toBe(false);
    expect(check('2026-11-27T17:59:00Z')).toBe(true);
    expect(check('2026-11-27T18:00:00Z')).toBe(false);
  });
  it('throttles heartbeat while forcing one batch at expiry outside session', () => {
    const last=new Map([[a.symbol,now]]), expiries=new Set<string>();
    expect(selectUpdates([a],[],now,last,expiries)).toHaveLength(0);
    expect(selectUpdates([a],[series(now)],now,last,expiries)).toHaveLength(1);
    expiries.add(`${a.symbol}:${now}`);
    expect(selectUpdates([a],[series(now)],now,last,expiries)).toHaveLength(0);
  });
  it('batches latest updates and quotes the exact fee without dry-run writes', async () => {
    const {r,read,updates}=mockRuntime();
    await updateBatch(r,[a],now);
    expect(updates).toHaveBeenCalledWith([a.feedId]);
    expect(read.mock.calls[0]?.[0].functionName).toBe('getUpdateFee');
    const b=config.assets[1]!;
    updates.mockResolvedValue({...structuredClone(fixture),parsed:[fixture.parsed[0]!,{...fixture.parsed[0]!,id:b.feedId.slice(2)}]});
    read.mockClear();
    await updateBatch(r,[a,b],now);
    expect(updates).toHaveBeenLastCalledWith([a.feedId,b.feedId]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('deduplicates shared asset-expiry settlement and never settles at expiry', () => {
    expect(settlementGroups([series(now),series(now,390n*10n**18n)],now).size).toBe(0);
    expect([...settlementGroups([series(now),series(now,390n*10n**18n)],now+1).values()][0]).toHaveLength(2);
  });
  it('queries original expiry on retries, including recovery long after expiry', async () => {
    const {r,updates}=mockRuntime();
    await settleGroup(r,[series(now)]);await settleGroup(r,[series(now)]);
    expect(updates.mock.calls).toEqual([[[a.feedId],now],[[a.feedId],now]]);
  });
  it('does not fetch or pay again for an existing settlement', async () => {
    const {r,updates}=mockRuntime(true);
    await settleGroup(r,[series(now)]);
    expect(updates).not.toHaveBeenCalled();
  });
});
