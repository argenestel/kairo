/** Price history loaders: Chainlink/KeeperFeed rounds, Pyth live samples, synthetic GBM. */
import {
  createPublicClient, defineChain, fallback, http, parseAbi, type Address, type PublicClient,
} from 'viem';
import type { ChainKey } from '../chains';
import type { AssetCategory } from '../chains/types';
import { YEAR } from '../lib/model';
import { chainIdOf, evmFeed, evmRpcs, keeperHub, lookbackSec, MULTICALL3, pythFeed } from './feeds';
import { gauss, hash32, mulberry32 } from './geom';

export interface Point { time: number; value: number }

export type HistorySource = 'chainlink' | 'keeper' | 'pyth' | 'synthetic';

export interface HistorySnap {
  points: Point[];
  source: HistorySource;
  label: string;
}

const aggregatorAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function phaseId() view returns (uint16)',
]);
const hubAbi = parseAbi([
  'function feedOfSymbol(string symbol) view returns (address)',
]);

const clients = new Map<number, PublicClient>();
const histCache = new Map<string, { at: number; snap: HistorySnap }>();
const inflight = new Map<string, Promise<HistorySnap>>();
const pythRing = new Map<string, Point[]>();
const PYTH_RING_MAX = 720;
const ZERO = '0x0000000000000000000000000000000000000000';

function evmClient(chainId: number): PublicClient {
  const hit = clients.get(chainId);
  if (hit) return hit;
  const rpcs = evmRpcs(chainId);
  const primary = rpcs[0] ?? 'https://sepolia.base.org';
  const chain = defineChain({
    id: chainId,
    name: `evm-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: rpcs.length ? rpcs : [primary] } },
    contracts: { multicall3: { address: MULTICALL3, blockCreated: 0 } },
  });
  const client = createPublicClient({
    chain,
    transport: fallback(rpcs.map((u) => http(u, { timeout: 8_000 }))),
  });
  clients.set(chainId, client);
  return client;
}

function synthetic(spot: number, vol: number, hours: number, seed: string, now = Date.now() / 1000): Point[] {
  const s0 = spot > 0 ? spot : 100;
  const n = Math.max(80, Math.min(220, Math.round(hours * 8)));
  const dt = (hours * 3600) / n;
  const rng = mulberry32(hash32(seed));
  const sig = vol * Math.sqrt(Math.max(dt, 1) / YEAR);
  const backward: number[] = [s0];
  let s = s0;
  for (let i = 0; i < n; i++) {
    s = s * Math.exp(0.5 * sig * sig - sig * gauss(rng));
    if (!(s > 0) || !isFinite(s)) s = s0;
    backward.push(s);
  }
  backward.reverse();
  const start = now - n * dt;
  return backward.map((value, i) => ({ time: start + i * dt, value }));
}

function pinToSpot(points: Point[], spot: number): Point[] {
  if (!(spot > 0) || points.length < 2) return points;
  const last = points[points.length - 1]!.value;
  if (!(last > 0)) return points;
  const k = spot / last;
  if (Math.abs(k - 1) < 1e-6) return points;
  const n = points.length - 1;
  return points.map((p, i) => {
    const w = (i / n) ** 2;
    return { time: p.time, value: p.value * (1 + (k - 1) * w) };
  });
}

function mergePoints(a: Point[], b: Point[]): Point[] {
  if (!a.length) return b;
  if (!b.length) return a;
  const all = [...a, ...b].sort((x, y) => x.time - y.time);
  const out: Point[] = [];
  for (const p of all) {
    if (!(p.value > 0) || !isFinite(p.time)) continue;
    const prev = out[out.length - 1];
    if (!prev || p.time - prev.time > 0.5) out.push(p);
    else out[out.length - 1] = p;
  }
  return out;
}

async function multicallRounds(
  client: PublicClient,
  feed: Address,
  ids: bigint[],
): Promise<Array<readonly [bigint, bigint, bigint, bigint, bigint] | null>> {
  const out: Array<readonly [bigint, bigint, bigint, bigint, bigint] | null> = [];
  const CHUNK = 60;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const contracts = slice.map((id) => ({
      address: feed,
      abi: aggregatorAbi,
      functionName: 'getRoundData' as const,
      args: [id] as const,
    }));
    try {
      const rows = await client.multicall({ contracts, allowFailure: true });
      for (const r of rows) out.push(r.status === 'success' ? r.result : null);
    } catch {
      for (const id of slice) {
        try {
          out.push(await client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'getRoundData', args: [id] }));
        } catch {
          out.push(null);
        }
      }
    }
  }
  return out;
}

function decodeRound(
  row: readonly [bigint, bigint, bigint, bigint, bigint] | null,
  scale: number,
): Point | null {
  if (!row) return null;
  const answer = Number(row[1]) / scale;
  const t = Number(row[3]);
  if (!(answer > 0) || !isFinite(answer) || !(t > 0)) return null;
  return { time: t, value: answer };
}

async function loadAggregator(
  client: PublicClient,
  feed: Address,
  lookback: number,
  maxPoints = 220,
): Promise<Point[]> {
  const [latest, decimals] = await Promise.all([
    client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'latestRoundData' }),
    client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'decimals' }),
  ]);
  const roundId = latest[0];
  const answer = latest[1];
  if (answer <= 0n || roundId === 0n) return [];
  const scale = 10 ** Number(decimals);
  const phase = roundId >> 64n;
  const base = phase << 64n;
  const mask = (1n << 64n) - 1n;
  const hi = roundId & mask;
  if (hi <= 0n) return [];
  const cutoff = BigInt(Math.floor(Date.now() / 1000) - lookback);

  const collect = (ids: bigint[], rows: Array<readonly [bigint, bigint, bigint, bigint, bigint] | null>) => {
    const pts: Point[] = [];
    rows.forEach((row) => {
      const p = decodeRound(row, scale);
      if (p) pts.push(p);
    });
    void ids;
    pts.sort((a, b) => a.time - b.time);
    const out: Point[] = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (!prev || p.time > prev.time) out.push(p);
      else out[out.length - 1] = p;
    }
    return out;
  };

  if (hi <= BigInt(maxPoints + 4)) {
    const ids: bigint[] = [];
    for (let i = 1n; i <= hi; i++) ids.push(base | i);
    return collect(ids, await multicallRounds(client, feed, ids));
  }

  const PROBES = 20;
  const probeIds: bigint[] = [];
  for (let i = 0; i < PROBES; i++) {
    const agg = 1n + ((hi - 1n) * BigInt(i)) / BigInt(PROBES - 1);
    probeIds.push(base | agg);
  }
  const probes = await multicallRounds(client, feed, probeIds);
  let startAgg = 1n;
  for (let i = 0; i < probes.length; i++) {
    const t = probes[i]?.[3] ?? 0n;
    if (t !== 0n && t >= cutoff) {
      startAgg = i > 0 ? (probeIds[i - 1]! & mask) : (probeIds[i]! & mask);
      break;
    }
    if (i === probes.length - 1) startAgg = hi > 400n ? hi - 400n : 1n;
  }

  const span = hi - startAgg;
  const n = Math.min(maxPoints, Number(span) + 1);
  const seen = new Set<string>();
  const ids: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const agg = startAgg + (n <= 1 ? 0n : (span * BigInt(i)) / BigInt(n - 1));
    const id = base | agg;
    const k = id.toString();
    if (seen.has(k)) continue;
    seen.add(k);
    ids.push(id);
  }
  if (!seen.has(roundId.toString())) ids.push(roundId);
  return collect(ids, await multicallRounds(client, feed, ids));
}

async function resolveKeeperFeed(chain: ChainKey, symbol: string): Promise<Address | null> {
  const hub = keeperHub(chain);
  const id = chainIdOf(chain);
  if (!hub || id == null) return null;
  try {
    const addr = await evmClient(id).readContract({
      address: hub,
      abi: hubAbi,
      functionName: 'feedOfSymbol',
      args: [symbol],
    });
    if (!addr || addr.toLowerCase() === ZERO) return null;
    return addr;
  } catch {
    return null;
  }
}

const PYTH_DISC = [34, 241, 35, 99, 157, 126, 244, 205];

function parsePythV2(data: Uint8Array): Point | null {
  if (data.length < 8 + 32 + 1 + 32 + 8 * 7 + 4) return null;
  for (let i = 0; i < 8; i++) if (data[i] !== PYTH_DISC[i]) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8 + 32;
  const tag = data[o];
  if (tag === 0) o += 2;
  else if (tag === 1) o += 1;
  else return null;
  o += 32;
  const price = dv.getBigInt64(o, true);
  const exponent = dv.getInt32(o + 16, true);
  const publishTime = Number(dv.getBigInt64(o + 20, true));
  const value = Number(price) * 10 ** exponent;
  if (!(value > 0) || !isFinite(value) || !(publishTime > 0)) return null;
  return { time: publishTime, value };
}

async function samplePyth(symbol: string): Promise<Point | null> {
  const feed = pythFeed(symbol);
  if (!feed) return null;
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const conn = new Connection(feed.rpc, { commitment: 'confirmed' });
    const info = await conn.getAccountInfo(new PublicKey(feed.priceAccount), 'confirmed');
    if (!info?.data) return null;
    const data = info.data instanceof Uint8Array ? info.data : new Uint8Array(info.data);
    return parsePythV2(data);
  } catch {
    return null;
  }
}

function ringPush(symbol: string, p: Point): Point[] {
  const key = symbol.toUpperCase();
  const ring = pythRing.get(key) ?? [];
  const last = ring[ring.length - 1];
  if (!last || p.time > last.time + 0.4) ring.push(p);
  else if (p.time >= last.time) ring[ring.length - 1] = p;
  if (ring.length > PYTH_RING_MAX) ring.splice(0, ring.length - PYTH_RING_MAX);
  pythRing.set(key, ring);
  return ring;
}

export function coneBand(spot: number, vol: number, dtSec: number): { up: number; down: number } {
  const sig = vol * Math.sqrt(Math.max(dtSec, 0) / YEAR);
  const e = Math.exp(sig);
  return { up: spot * e, down: spot / e };
}

export function buildCone(
  t0: number,
  s0: number,
  expiry: number,
  vol: number,
  steps = 24,
): { t: number; up: number; down: number }[] {
  if (!(expiry > t0) || !(s0 > 0)) return [];
  const out: { t: number; up: number; down: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((expiry - t0) * i) / steps;
    const b = coneBand(s0, vol, t - t0);
    out.push({ t, up: b.up, down: b.down });
  }
  return out;
}

async function loadReal(
  chain: ChainKey,
  symbol: string,
  spot: number,
  vol: number,
  category?: AssetCategory | string,
): Promise<HistorySnap | null> {
  const hours = lookbackSec(category) / 3600;
  const syn = (): Point[] => pinToSpot(synthetic(spot, vol, hours, `${chain}:${symbol}`), spot);

  if (chain === 'solana') {
    const live = await samplePyth(symbol);
    if (live) ringPush(symbol, live);
    else if (spot > 0) ringPush(symbol, { time: Date.now() / 1000, value: spot });
    const ring = pythRing.get(symbol.toUpperCase()) ?? [];
    const points = ring.length >= 8 ? ring : mergePoints(syn(), ring);
    return { points, source: ring.length ? 'pyth' : 'synthetic', label: ring.length ? 'Pyth · live samples' : 'Simulated' };
  }

  if (chain === 'base' || chain === 'arbitrum') {
    const id = chainIdOf(chain)!;
    const client = evmClient(id);
    const known = evmFeed(chain, symbol);
    let address = known?.address ?? null;
    let kind: HistorySource = known?.kind ?? 'chainlink';
    if (!address) {
      address = await resolveKeeperFeed(chain, symbol);
      if (address) kind = 'keeper';
    }
    if (!address) return null;
    const look = lookbackSec(category);
    const pts = await loadAggregator(client, address, look);
    if (pts.length < 3) return null;
    const pinned = pinToSpot(pts, spot > 0 ? spot : pts[pts.length - 1]!.value);
    const label = kind === 'keeper'
      ? 'Keeper-reported demo oracle · last sessions'
      : `Chainlink · ${look >= 86400 * 2 ? 'sessions' : '24h'}`;
    return { points: pinned, source: kind, label };
  }

  return null;
}

export async function loadHistory(opts: {
  chain: ChainKey;
  symbol: string;
  spot: number;
  vol: number;
  category?: AssetCategory | string;
}): Promise<HistorySnap> {
  const { chain, symbol, spot, vol, category } = opts;
  const hours = lookbackSec(category) / 3600;
  const fallback: HistorySnap = {
    points: pinToSpot(synthetic(spot, vol, hours, `${chain}:${symbol}`), spot),
    source: 'synthetic',
    label: chain === 'mock' ? 'Simulated' : 'Simulated (feed unavailable)',
  };
  if (chain === 'mock' || chain === 'hyperliquid') return fallback;

  const key = `${chain}:${symbol.toUpperCase()}:${category ?? ''}`;
  const cached = histCache.get(key);
  if (cached && Date.now() - cached.at < 90_000) {
    return { ...cached.snap, points: pinToSpot(cached.snap.points, spot) };
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      const real = await loadReal(chain, symbol, spot, vol, category);
      const snap = real && real.points.length >= 3 ? real : fallback;
      histCache.set(key, { at: Date.now(), snap });
      return snap;
    } catch {
      return fallback;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/** Append a live tick into the in-memory Pyth ring (and return it). */
export function noteLiveSample(symbol: string, price: number, time = Date.now() / 1000): void {
  if (!(price > 0)) return;
  ringPush(symbol, { time, value: price });
}
