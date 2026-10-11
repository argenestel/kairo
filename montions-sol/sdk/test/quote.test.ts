import { describe, expect, it } from 'vitest';
import {
  SIDE_ASK,
  SIDE_BID,
  TIF_IOC,
  buyEscrow,
  estimateMakerLadder,
  ladderToBook,
  midPrice,
  modelProbAbove,
  normCdf,
  outcomeTopOfBook,
  quoteBuy,
  quoteSell,
  type BookLike,
  type MakerParamsView,
} from '../src/index.js';

const book: BookLike = {
  bids: [
    { tick: 45, qty: 10n },
    { tick: 43, qty: 20n },
  ],
  asks: [
    { tick: 50, qty: 10n },
    { tick: 52, qty: 20n },
  ],
};

describe('quoteBuy YES (walk asks)', () => {
  it('single level, strict', () => {
    const q = quoteBuy(book, 'yes', 4); // $4 at 50c → 8 contracts
    expect(q.contracts).toBe(8n);
    expect(q.premium).toBe(4_000_000n);
    expect(q.cost).toBe(4_000_000n);
    expect(q.avgPrice).toBeCloseTo(0.5);
    expect(q.worstTick).toBe(50);
    expect(q.limitTick).toBe(50);
    expect(q.orderTick).toBe(50);
    expect(q.side).toBe(SIDE_BID);
    expect(q.payout).toBe(8_000_000n);
    expect(q.args).toEqual({ side: SIDE_BID, tick: 50, qty: 8n, tif: TIF_IOC, fromHeld: false, maxFills: 0, minFilled: 1n });
    expect(q.escrow).toBe(4_000_000n);
  });

  it('two levels: strict sizes by escrow at the limit', () => {
    // 10 @ 50 = $5, next level 52. Budget $10: strict → floor(10 / 0.52) = 19 contracts, escrow 19*0.52 = 9.88
    const q = quoteBuy(book, 'yes', 10);
    expect(q.contracts).toBe(19n);
    expect(q.premium).toBe(10n * 500_000n + 9n * 520_000n);
    expect(q.escrow).toBe(19n * 520_000n);
    expect(q.escrow).toBeLessThanOrEqual(10_000_000n);
    expect(q.worstTick).toBe(52);
    expect(q.fills).toHaveLength(2);
  });

  it('two levels: non-strict spends the walked cost', () => {
    // $10: 10 @ .50 = 5, then floor(5/.52) = 9 → 19 (same here); $10.5 → 10 + floor(5.5/.52)=10 → 20
    const q = quoteBuy(book, 'yes', 10.5, { strict: false });
    expect(q.contracts).toBe(20n);
    expect(q.cost).toBe(10n * 500_000n + 10n * 520_000n);
    expect(q.cost).toBeLessThanOrEqual(10_500_000n);
  });

  it('respects maxTick and slippage', () => {
    const q = quoteBuy(book, 'yes', 100, { maxTick: 50 });
    expect(q.contracts).toBe(10n);
    expect(q.liquidity).toBe(10n);
    const s = quoteBuy(book, 'yes', 3, { slippageTicks: 2 });
    expect(s.limitTick).toBe(52);
    expect(s.contracts).toBe(5n); // escrow at 52 → floor(3/0.52) = 5
    expect(s.cost).toBe(2_500_000n);
  });

  it('fees: one ceil per order, reserve on escrow', () => {
    const q = quoteBuy(book, 'yes', 4, { feeBps: 100 }); // 1%
    // escrow per contract 0.505 → floor(4/0.505) = 7
    expect(q.contracts).toBe(7n);
    expect(q.fee).toBe(35_000n);
    expect(q.escrow).toBe(buyEscrow(7n, 50, 100));
    expect(q.escrow).toBeLessThanOrEqual(4_000_000n);
  });

  it('no liquidity', () => {
    const q = quoteBuy({ bids: [], asks: [] }, 'yes', 10);
    expect(q.contracts).toBe(0n);
    expect(q.args.qty).toBe(0n);
    expect(q.args.minFilled).toBe(0n);
  });

  it('budget below one contract', () => {
    expect(quoteBuy(book, 'yes', 0.49).contracts).toBe(0n);
    expect(quoteBuy(book, 'yes', 0.5).contracts).toBe(1n);
  });

  it('bigint budget in base units', () => {
    expect(quoteBuy(book, 'yes', 1_000_000n).contracts).toBe(2n);
  });

  it('minFillRatio', () => {
    expect(quoteBuy(book, 'yes', 4, { minFillRatio: 0.5 }).args.minFilled).toBe(4n);
  });
});

describe('quoteBuy NO (walk bids, price = 1 − bid)', () => {
  it('hits the best bid first', () => {
    // best bid 45 → NO at 55c. $5.5 → 10 contracts
    const q = quoteBuy(book, 'no', 5.5);
    expect(q.contracts).toBe(10n);
    expect(q.avgPrice).toBeCloseTo(0.55);
    expect(q.side).toBe(SIDE_ASK);
    expect(q.limitTick).toBe(55);
    expect(q.orderTick).toBe(45); // ask at YES 45 matches bids >= 45
    expect(q.escrow).toBe(10n * 550_000n);
  });

  it('second level 43 → NO at 57', () => {
    const q = quoteBuy(book, 'no', 20);
    // strict: level2 limit 57 → floor(20/0.57) = 35 > 30 available → 30
    expect(q.contracts).toBe(30n);
    expect(q.worstTick).toBe(57);
    expect(q.orderTick).toBe(43);
    expect(q.premium).toBe(10n * 550_000n + 20n * 570_000n);
  });

  it('maxTick for NO is in NO terms', () => {
    const q = quoteBuy(book, 'no', 100, { maxTick: 56 });
    expect(q.contracts).toBe(10n);
  });
});

describe('quoteSell', () => {
  it('sell YES hits bids', () => {
    const q = quoteSell(book, 'yes', 15n);
    expect(q.contracts).toBe(15n);
    expect(q.proceeds).toBe(10n * 450_000n + 5n * 430_000n);
    expect(q.side).toBe(SIDE_ASK);
    expect(q.orderTick).toBe(43);
    expect(q.args.fromHeld).toBe(true);
    expect(q.args.qty).toBe(15n);
  });

  it('sell NO lifts asks (receives 1 − ask)', () => {
    const q = quoteSell(book, 'no', 5n, { minTick: 45 });
    expect(q.contracts).toBe(5n);
    expect(q.proceeds).toBe(5n * 500_000n);
    expect(q.side).toBe(SIDE_BID);
    expect(q.limitTick).toBe(50);
    expect(q.orderTick).toBe(50); // close NO: bid at YES 50
  });

  it('minTick filters and fees come from proceeds', () => {
    const q = quoteSell(book, 'yes', 30n, { minTick: 44, feeBps: 100 });
    expect(q.contracts).toBe(10n);
    expect(q.fee).toBe(45_000n);
    expect(q.net).toBe(4_455_000n);
  });
});

describe('book helpers', () => {
  it('top of book and mid', () => {
    expect(outcomeTopOfBook(book, 'yes')).toEqual({ buy: 50, sell: 45 });
    expect(outcomeTopOfBook(book, 'no')).toEqual({ buy: 55, sell: 50 });
    expect(midPrice(book)).toBeCloseTo(0.475);
  });
});

describe('model', () => {
  it('normCdf', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
  });

  it('digital probability', () => {
    expect(modelProbAbove(100, 100, 0.8, 0)).toBe(1);
    expect(modelProbAbove(99, 100, 0.8, 0)).toBe(0);
    const p = modelProbAbove(100, 100, 0.8, 86_400);
    expect(p).toBeLessThan(0.5);
    expect(p).toBeGreaterThan(0.48);
    expect(modelProbAbove(120, 100, 0.8, 3600)).toBeGreaterThan(0.99);
  });

  const params: MakerParamsView = {
    enabled: true,
    levels: 3,
    levelSpacing: 2,
    minHalfSpread: 2,
    maxMarketExposure: 1_500_000_000n,
    levelNotional: 50_000_000n,
    minTte: 600,
    maxPriceAge: 60,
  };

  it('estimated ladder', () => {
    const l = estimateMakerLadder({ fair: 0.5, tteSecs: 86_400, params });
    expect(l.fairTick).toBe(50);
    const b = ladderToBook(l.quotes);
    expect(b.asks.map((x) => x.tick)).toEqual([52, 54, 56]);
    expect(b.bids.map((x) => x.tick)).toEqual([48, 46, 44]);
    // ask at 52 escrows 0.48/contract → floor(50/0.48) = 104
    expect(b.asks[0]!.qty).toBe(104n);
    expect(b.bids[0]!.qty).toBe(104n);
    expect(estimateMakerLadder({ fair: 0.5, tteSecs: 300, params }).quotes).toEqual([]);
  });

  it('ladder clamps at the edges and respects exposure', () => {
    const l = estimateMakerLadder({ fair: 0.98, tteSecs: 86_400, params, cashAvailable: 60_000_000n });
    for (const q of l.quotes) {
      expect(q.tick).toBeGreaterThanOrEqual(1);
      expect(q.tick).toBeLessThanOrEqual(99);
    }
    const cash = l.quotes.reduce((a, q) => a + q.qty * BigInt(q.side === SIDE_ASK ? 100 - q.tick : q.tick) * 10_000n, 0n);
    expect(cash).toBeLessThanOrEqual(60_000_000n);
  });
});
