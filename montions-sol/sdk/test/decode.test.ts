import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
  MARKET_ACCOUNT_SIZE,
  MARKET_HEADER_SIZE,
  SIDE_ASK,
  SIDE_BID,
  STATUS_RESOLVED,
  bitmapHas,
  decodeMarket,
  decodePythPrice,
  pythPushFeedAddress,
  toE8,
} from '../src/index.js';
import { buildMarket, pk } from './marketBuilder.js';

const here = dirname(fileURLToPath(import.meta.url));
const feed = Uint8Array.from(Buffer.from('ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', 'hex'));

const base = {
  asset: pk(1),
  feedId: feed,
  creator: pk(2),
  yesMint: pk(3),
  noMint: pk(4),
  vault: pk(5),
  strike: 11_000_000_000n,
  expiry: 1_791_734_400,
  createdAt: 1_791_700_000,
};

describe('decodeMarket (synthetic §3.1 buffer)', () => {
  const maker = pk(9);
  const alice = pk(10);
  const data = buildMarket({
    ...base,
    pool: 30_000_000n,
    yesTotal: 30n,
    noTotal: 30n,
    fees: 1234n,
    volume: 42n,
    lastTradeTick: 55,
    seats: [
      { owner: maker, cash: 5n, locked: 1_000_000n, yes: 3n, no: 0n, yesLocked: 2n, noLocked: 0n, openOrders: 4 },
      { owner: alice, cash: 7n, openOrders: 1 },
    ],
    orders: [
      { side: SIDE_BID, tick: 48, qty: 10n, seat: 0 },
      { side: SIDE_BID, tick: 50, qty: 5n, seat: 0 },
      { side: SIDE_BID, tick: 50, qty: 7n, seat: 1 },
      { side: SIDE_ASK, tick: 53, qty: 4n, seat: 0, fromHeld: true },
      { side: SIDE_ASK, tick: 70, qty: 9n, seat: 0 },
    ],
    // scramble the arena so the decoder must follow the lists
    slotOrder: [17, 3, 60, 0, 31],
    trades: Array.from({ length: 20 }, (_, i) => ({ ts: 1_791_700_100 + i, qty: i + 1, tick: 40 + i, takerIsBuyer: i % 2 === 0 })),
  });

  it('has the frozen size', () => {
    expect(data.length).toBe(MARKET_ACCOUNT_SIZE);
  });

  const m = decodeMarket(data, pk(77));

  it('decodes the header', () => {
    expect(m.address?.equals(pk(77))).toBe(true);
    expect(m.asset.equals(base.asset)).toBe(true);
    expect(m.feedId).toBe(Buffer.from(feed).toString('hex'));
    expect(m.creator.equals(base.creator)).toBe(true);
    expect(m.yesMint.equals(base.yesMint)).toBe(true);
    expect(m.noMint.equals(base.noMint)).toBe(true);
    expect(m.vault.equals(base.vault)).toBe(true);
    expect(m.strike).toBe(11_000_000_000n);
    expect(m.expiry).toBe(base.expiry);
    expect(m.createdAt).toBe(base.createdAt);
    expect(m.pool).toBe(30_000_000n);
    expect(m.yesTotal).toBe(30n);
    expect(m.noTotal).toBe(30n);
    expect(m.fees).toBe(1234n);
    expect(m.volume).toBe(42n);
    expect(m.nextOrderId).toBe(6n);
    expect(m.statusName).toBe('open');
    expect([m.bump, m.vaultBump, m.yesMintBump, m.noMintBump]).toEqual([255, 254, 253, 252]);
    expect(m.lastTradeTick).toBe(55);
    expect(m.full).toBe(true);
  });

  it('aggregates levels by tick in price priority', () => {
    expect(m.bids).toEqual([
      { tick: 50, qty: 12n, orders: 2 },
      { tick: 48, qty: 10n, orders: 1 },
    ]);
    expect(m.asks).toEqual([
      { tick: 53, qty: 4n, orders: 1 },
      { tick: 70, qty: 9n, orders: 1 },
    ]);
    expect(m.bestBid).toBe(50);
    expect(m.bestAsk).toBe(53);
    expect(bitmapHas(m.bidBits, 50)).toBe(true);
    expect(bitmapHas(m.bidBits, 49)).toBe(false);
    expect(bitmapHas(m.askBits, 70)).toBe(true);
  });

  it('lists orders FIFO with owners', () => {
    const at50 = m.orders.filter((o) => o.side === SIDE_BID && o.tick === 50);
    expect(at50.map((o) => o.id)).toEqual([2n, 3n]);
    expect(at50[0]!.owner?.equals(maker)).toBe(true);
    expect(at50[1]!.owner?.equals(alice)).toBe(true);
    const held = m.orders.find((o) => o.side === SIDE_ASK && o.tick === 53)!;
    expect(held.fromHeld).toBe(true);
    expect(held.slot).toBe(0);
    expect(m.orders).toHaveLength(5);
  });

  it('decodes seats', () => {
    expect(m.seats).toHaveLength(2);
    expect(m.seats[0]).toMatchObject({ index: 0, cash: 5n, locked: 1_000_000n, yes: 3n, yesLocked: 2n, openOrders: 4 });
    expect(m.seats[1]!.owner.equals(alice)).toBe(true);
  });

  it('decodes the trade ring newest first (wrapped)', () => {
    expect(m.tradeCount).toBe(20);
    expect(m.trades).toHaveLength(16);
    expect(m.trades[0]).toEqual({ ts: 1_791_700_119, qty: 20, tick: 59, takerIsBuyer: false });
    expect(m.trades[15]!.qty).toBe(5);
  });

  it('decodes a header-only slice', () => {
    const h = decodeMarket(data.subarray(0, MARKET_HEADER_SIZE), null);
    expect(h.full).toBe(false);
    expect(h.strike).toBe(11_000_000_000n);
    expect(h.bids).toEqual([]);
  });

  it('rejects a wrong discriminator', () => {
    const bad = Uint8Array.from(data);
    bad[0] ^= 0xff;
    expect(() => decodeMarket(bad)).toThrow();
  });

  it('empty / resolved market', () => {
    const r = decodeMarket(buildMarket({ ...base, status: STATUS_RESOLVED, outcome: 1, settlePrice: 11_100_000_000n, settlePublishTime: base.expiry + 2 }));
    expect(r.statusName).toBe('resolved');
    expect(r.outcome).toBe(1);
    expect(r.settlePrice).toBe(11_100_000_000n);
    expect(r.bestBid).toBe(0);
    expect(r.bestAsk).toBe(0);
    expect(r.trades).toEqual([]);
  });
});

// Engine-produced fixture (programs/montions/tests/fixtures/market_fixture.{bin,json}) — used when present.
const fixtureDirs = [join(here, '..', '..', 'programs', 'montions', 'tests', 'fixtures')];
const fixtureDir = fixtureDirs.find((d) => existsSync(join(d, 'market_fixture.bin')));

describe.skipIf(!fixtureDir)('decodeMarket (engine fixture)', () => {
  it('matches the expected decoded values', async () => {
    const { checkFixture } = await import('./fixtureCheck.js');
    checkFixture(fixtureDir!);
  });
});

describe('decodePythPrice (devnet capture)', () => {
  const cap = JSON.parse(readFileSync(join(here, 'fixtures', 'pyth_devnet.json'), 'utf8')) as {
    accounts: Record<string, { owner: string; data: string }>;
  };
  it('decodes SOL/USD and BTC/USD sponsored accounts', () => {
    const sol = decodePythPrice(Buffer.from(cap.accounts['7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE']!.data, 'base64'));
    expect(sol.verification).toBe('full');
    expect(sol.feedId).toBe('ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d');
    expect(sol.exponent).toBe(-8);
    expect(sol.priceE8).toBe(sol.price);
    expect(sol.priceUsd).toBeGreaterThan(1);
    expect(sol.publishTime).toBeGreaterThan(1_700_000_000);
    expect(sol.prevPublishTime).toBeLessThanOrEqual(sol.publishTime);
    expect(sol.conf).toBeGreaterThan(0n);
    const btc = decodePythPrice(Buffer.from(cap.accounts['4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo']!.data, 'base64'));
    expect(btc.feedId).toBe('e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43');
    expect(btc.priceUsd).toBeGreaterThan(1000);
  });

  it('sponsored accounts are the push-oracle PDAs of the config feed ids', () => {
    const assets = JSON.parse(readFileSync(join(here, '..', '..', 'config', 'assets.devnet.json'), 'utf8')) as {
      assets: { feedId: string; priceAccount: string }[];
    };
    for (const a of assets.assets) expect(pythPushFeedAddress(a.feedId).toBase58()).toBe(a.priceAccount);
  });

  it('rejects partial verification parsing errors and wrong discriminators', () => {
    expect(() => decodePythPrice(new Uint8Array(134))).toThrow();
  });

  it('toE8 rescales', () => {
    expect(toE8(123n, -8)).toBe(123n);
    expect(toE8(123n, -6)).toBe(12_300n);
    expect(toE8(123_456n, -10)).toBe(1_234n);
    expect(toE8(5n, 0)).toBe(500_000_000n);
  });

  it('PublicKey sanity', () => {
    expect(new PublicKey(new Uint8Array(32)).toBase58()).toBe('11111111111111111111111111111111');
  });
});
