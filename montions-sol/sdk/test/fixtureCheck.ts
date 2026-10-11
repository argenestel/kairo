/**
 * Compares decodeMarket() of the engine-produced fixture (programs/montions/tests/fixtures/market_fixture.bin)
 * with the engine's expected values (market_fixture.json, written by tests/engine_fixture.rs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'buffer';
import { expect } from 'vitest';
import { DISCRIMINATORS, MARKET_ACCOUNT_SIZE, decodeMarket, type MarketView } from '../src/index.js';

interface FixtureLevel {
  tick: number;
  qty: string;
  orderIds: string[];
}
interface FixtureOrder {
  slot: number;
  id: string;
  qty: string;
  ts: string;
  seat: number;
  owner: string;
  side: number;
  tick: number;
  fromHeld: boolean;
  prev: number;
  next: number;
}
interface FixtureSeat {
  index: number;
  owner: string;
  cash: string;
  locked: string;
  yes: string;
  no: string;
  yesLocked: string;
  noLocked: string;
  openOrders: number;
}
interface Fixture {
  accountSize: number;
  discriminatorHex: string;
  header: Record<string, string | number | string[]>;
  bestBid: number;
  bestAsk: number;
  bids: FixtureLevel[];
  asks: FixtureLevel[];
  orders: FixtureOrder[];
  seats: FixtureSeat[];
  trades: { ts: string; qty: number; tick: number; takerIsBuyer: boolean }[];
}

export function checkFixture(dir: string): MarketView {
  const bin = readFileSync(join(dir, 'market_fixture.bin'));
  const fx = JSON.parse(readFileSync(join(dir, 'market_fixture.json'), 'utf8')) as Fixture;
  expect(bin.length).toBe(fx.accountSize);
  expect(fx.accountSize).toBe(MARKET_ACCOUNT_SIZE);
  expect(fx.discriminatorHex).toBe(Buffer.from(DISCRIMINATORS.Market).toString('hex'));

  const m = decodeMarket(bin);
  const h = fx.header;
  // header: pubkeys, hex, u64/i64 as strings, u8/u32 as numbers
  expect(m.asset.toBase58()).toBe(h.asset);
  expect(m.feedId).toBe(h.feedIdHex);
  expect(m.creator.toBase58()).toBe(h.creator);
  expect(m.yesMint.toBase58()).toBe(h.yesMint);
  expect(m.noMint.toBase58()).toBe(h.noMint);
  expect(m.vault.toBase58()).toBe(h.vault);
  for (const k of ['strike', 'settlePrice', 'pool', 'yesTotal', 'noTotal', 'fees', 'volume', 'nextOrderId'] as const) {
    expect(String(m[k]), k).toBe(h[k]);
  }
  for (const k of ['expiry', 'createdAt', 'settlePublishTime'] as const) expect(String(m[k]), k).toBe(h[k]);
  expect(m.bidBits.map(String)).toEqual(h.bidBits);
  expect(m.askBits.map(String)).toEqual(h.askBits);
  for (const k of ['status', 'outcome', 'bump', 'vaultBump', 'yesMintBump', 'noMintBump', 'lastTradeTick', 'tradeHead', 'tradeCount', 'freeHead'] as const) {
    expect(m[k], k).toBe(h[k]);
  }

  // book
  expect(m.bestBid).toBe(fx.bestBid);
  expect(m.bestAsk).toBe(fx.bestAsk);
  const levelIds = (side: number, tick: number) =>
    m.orders.filter((o) => o.side === side && o.tick === tick).map((o) => String(o.id));
  expect(m.bids.map((l) => ({ tick: l.tick, qty: String(l.qty), orderIds: levelIds(0, l.tick) }))).toEqual(fx.bids);
  expect(m.asks.map((l) => ({ tick: l.tick, qty: String(l.qty), orderIds: levelIds(1, l.tick) }))).toEqual(fx.asks);
  m.bids.forEach((l, i) => expect(l.orders).toBe(fx.bids[i]!.orderIds.length));

  // orders (by slot)
  const orders = [...m.orders]
    .sort((a, b) => a.slot - b.slot)
    .map((o) => ({
      slot: o.slot,
      id: String(o.id),
      qty: String(o.qty),
      ts: String(o.ts),
      seat: o.seat,
      owner: o.owner?.toBase58(),
      side: o.side,
      tick: o.tick,
      fromHeld: o.fromHeld,
      prev: o.prev,
      next: o.next,
    }));
  expect(orders).toEqual(fx.orders);

  // seats
  expect(
    m.seats.map((s) => ({
      index: s.index,
      owner: s.owner.toBase58(),
      cash: String(s.cash),
      locked: String(s.locked),
      yes: String(s.yes),
      no: String(s.no),
      yesLocked: String(s.yesLocked),
      noLocked: String(s.noLocked),
      openOrders: s.openOrders,
    })),
  ).toEqual(fx.seats);

  // trades newest first
  expect(m.trades.map((t) => ({ ts: String(t.ts), qty: t.qty, tick: t.tick, takerIsBuyer: t.takerIsBuyer }))).toEqual(fx.trades);
  return m;
}
