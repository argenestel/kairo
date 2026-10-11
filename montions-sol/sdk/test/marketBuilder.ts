/**
 * Builds a synthetic Market account (SPEC §3.1) for decoder / quote tests, mimicking what the engine writes:
 * levels as FIFO lists through the order arena, free list, bitmaps, seats and the trade ring.
 */
import { PublicKey } from '@solana/web3.js';
import {
  DISCRIMINATORS,
  LEVEL_SIZE,
  MARKET_ACCOUNT_SIZE,
  MARKET_OFFSETS as O,
  MAX_ORDERS,
  NIL,
  ORDER_SIZE,
  SEAT_SIZE,
  SIDE_BID,
  STATUS_OPEN,
  TRADE_RING,
  TRADE_SIZE,
} from '../src/constants.js';

export interface SynthOrder {
  side: number;
  tick: number;
  qty: bigint;
  seat: number;
  fromHeld?: boolean;
  ts?: number;
}

export interface SynthSeat {
  owner: PublicKey;
  cash?: bigint;
  locked?: bigint;
  yes?: bigint;
  no?: bigint;
  yesLocked?: bigint;
  noLocked?: bigint;
  openOrders?: number;
}

export interface SynthTrade {
  ts: number;
  qty: number;
  tick: number;
  takerIsBuyer: boolean;
}

export interface SynthMarket {
  asset: PublicKey;
  feedId: Uint8Array;
  creator: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  strike: bigint;
  expiry: number;
  createdAt: number;
  settlePrice?: bigint;
  settlePublishTime?: number;
  pool?: bigint;
  yesTotal?: bigint;
  noTotal?: bigint;
  fees?: bigint;
  volume?: bigint;
  status?: number;
  outcome?: number;
  bumps?: [number, number, number, number];
  lastTradeTick?: number;
  orders?: SynthOrder[];
  seats?: SynthSeat[];
  trades?: SynthTrade[];
  /** Total fills ever (defaults to trades.length). */
  tradeCount?: number;
  /** Slot order in which to allocate orders (default 0,1,2,…) — lets tests scramble the arena. */
  slotOrder?: number[];
}

export function buildMarket(m: SynthMarket): Uint8Array {
  const data = new Uint8Array(MARKET_ACCOUNT_SIZE);
  const dv = new DataView(data.buffer);
  data.set(DISCRIMINATORS.Market, 0);
  const pk = (o: number, k: PublicKey) => data.set(k.toBytes(), o);
  pk(O.asset, m.asset);
  data.set(m.feedId, O.feedId);
  pk(O.creator, m.creator);
  pk(O.yesMint, m.yesMint);
  pk(O.noMint, m.noMint);
  pk(O.vault, m.vault);
  dv.setBigUint64(O.strike, m.strike, true);
  dv.setBigInt64(O.expiry, BigInt(m.expiry), true);
  dv.setBigInt64(O.createdAt, BigInt(m.createdAt), true);
  dv.setBigInt64(O.settlePrice, m.settlePrice ?? 0n, true);
  dv.setBigInt64(O.settlePublishTime, BigInt(m.settlePublishTime ?? 0), true);
  dv.setBigUint64(O.pool, m.pool ?? 0n, true);
  dv.setBigUint64(O.yesTotal, m.yesTotal ?? 0n, true);
  dv.setBigUint64(O.noTotal, m.noTotal ?? 0n, true);
  dv.setBigUint64(O.fees, m.fees ?? 0n, true);
  dv.setBigUint64(O.volume, m.volume ?? 0n, true);
  data[O.status] = m.status ?? STATUS_OPEN;
  data[O.outcome] = m.outcome ?? 0;
  const [b0, b1, b2, b3] = m.bumps ?? [255, 254, 253, 252];
  data[O.bump] = b0;
  data[O.vaultBump] = b1;
  data[O.yesMintBump] = b2;
  data[O.noMintBump] = b3;
  data[O.lastTradeTick] = m.lastTradeTick ?? 0;

  // levels empty
  for (let t = 0; t < 100; t++) {
    data[O.bidLevels + t * LEVEL_SIZE] = NIL;
    data[O.bidLevels + t * LEVEL_SIZE + 1] = NIL;
    data[O.askLevels + t * LEVEL_SIZE] = NIL;
    data[O.askLevels + t * LEVEL_SIZE + 1] = NIL;
  }
  const slots = m.slotOrder ?? [...Array(MAX_ORDERS).keys()];
  const used = new Set<number>();
  const bits = { bid: [0n, 0n], ask: [0n, 0n] };
  let nextId = 1n;
  (m.orders ?? []).forEach((o, i) => {
    const slot = slots[i]!;
    used.add(slot);
    const off = O.orders + slot * ORDER_SIZE;
    dv.setBigUint64(off, nextId++, true);
    dv.setBigUint64(off + 8, o.qty, true);
    dv.setBigInt64(off + 16, BigInt(o.ts ?? 1_700_000_000 + i), true);
    data[off + 24] = o.seat;
    data[off + 25] = o.side;
    data[off + 26] = o.tick;
    data[off + 27] = o.fromHeld ? 1 : 0;
    data[off + 28] = NIL;
    data[off + 29] = NIL;
    // append to level FIFO
    const lb = (o.side === SIDE_BID ? O.bidLevels : O.askLevels) + o.tick * LEVEL_SIZE;
    const tail = data[lb + 1]!;
    if (tail === NIL) {
      data[lb] = slot;
    } else {
      data[O.orders + tail * ORDER_SIZE + 29] = slot;
      data[off + 28] = tail;
    }
    data[lb + 1] = slot;
    const b = o.side === SIDE_BID ? bits.bid : bits.ask;
    b[o.tick < 64 ? 0 : 1]! |= 1n << BigInt(o.tick % 64);
  });
  dv.setBigUint64(O.nextOrderId, nextId, true);
  dv.setBigUint64(O.bidBits, bits.bid[0]!, true);
  dv.setBigUint64(O.bidBits + 8, bits.bid[1]!, true);
  dv.setBigUint64(O.askBits, bits.ask[0]!, true);
  dv.setBigUint64(O.askBits + 8, bits.ask[1]!, true);
  // free list over unused slots
  const free = [...Array(MAX_ORDERS).keys()].filter((s) => !used.has(s));
  data[O.freeHead] = free[0] ?? NIL;
  free.forEach((s, i) => {
    data[O.orders + s * ORDER_SIZE + 29] = free[i + 1] ?? NIL;
    data[O.orders + s * ORDER_SIZE + 28] = NIL;
  });

  (m.seats ?? []).forEach((s, i) => {
    const off = O.seats + i * SEAT_SIZE;
    pk(off, s.owner);
    dv.setBigUint64(off + 32, s.cash ?? 0n, true);
    dv.setBigUint64(off + 40, s.locked ?? 0n, true);
    dv.setBigUint64(off + 48, s.yes ?? 0n, true);
    dv.setBigUint64(off + 56, s.no ?? 0n, true);
    dv.setBigUint64(off + 64, s.yesLocked ?? 0n, true);
    dv.setBigUint64(off + 72, s.noLocked ?? 0n, true);
    dv.setUint32(off + 80, s.openOrders ?? 0, true);
  });

  const trades = m.trades ?? [];
  trades.forEach((t, i) => {
    const off = O.trades + (i % TRADE_RING) * TRADE_SIZE;
    dv.setBigInt64(off, BigInt(t.ts), true);
    dv.setUint32(off + 8, t.qty, true);
    data[off + 12] = t.tick;
    data[off + 13] = t.takerIsBuyer ? 1 : 0;
  });
  data[O.tradeHead] = trades.length % TRADE_RING;
  dv.setUint32(O.tradeCount, m.tradeCount ?? trades.length, true);
  return data;
}

export const pk = (n: number) => {
  const b = new Uint8Array(32);
  b[0] = n;
  b[31] = 7;
  return new PublicKey(b);
};
