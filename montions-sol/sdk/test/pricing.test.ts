import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  WAD,
  buildLadder,
  fairProbAbove,
  fairProbAboveE8,
  fairProbAboveWad,
  normCdf,
  probToTick,
  probToTickWad,
  probToWad,
  timeDecayWidth,
  type LadderInput,
} from '../src/pricing.js';

// Shared with the Rust tests: programs/montions/tests/pricing_data (110-digit decimal reference + Rust ladder fixture).
const DATA = fileURLToPath(new URL('../../programs/montions/tests/pricing_data/', import.meta.url));
const rows = (name: string): string[][] =>
  readFileSync(DATA + name, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.trim().split(/\s+/));
const wadToNum = (s: string | bigint) => Number(BigInt(s)) / 1e18;

describe('normCdf (Hart/West, same algorithm as pricing.rs)', () => {
  it('matches the 110-digit golden table to < 1e-15', () => {
    const r = rows('golden_cdf.txt');
    expect(r.length).toBeGreaterThan(4000);
    let worst = 0;
    for (const [x, want] of r) {
      const err = Math.abs(normCdf(wadToNum(x)) - wadToNum(want));
      worst = Math.max(worst, err);
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('is symmetric and saturates like the program', () => {
    let worst = 0;
    for (let x = -12; x <= 12; x += 0.001) worst = Math.max(worst, Math.abs(normCdf(x) + normCdf(-x) - 1));
    expect(worst).toBeLessThan(2e-16);
    expect(normCdf(0)).toBe(0.5);
    expect(normCdf(-9)).toBe(0);
    expect(normCdf(9)).toBe(1);
    expect(normCdf(1.959963984540054)).toBeCloseTo(0.975, 15);
  });

  it('is monotone on a fine grid', () => {
    let prev = 0;
    let bad = 0;
    for (let x = -10; x <= 10; x += 1e-4) {
      const y = normCdf(x);
      if (y < prev) bad++;
      prev = y;
    }
    expect(bad).toBe(0);
  });
});

describe('fairProbAbove', () => {
  it('fairProbAboveE8 matches the golden digital table to < 1e-14', () => {
    const r = rows('golden_digital.txt');
    expect(r.length).toBeGreaterThan(4000);
    let worst = 0;
    let at: string[] = [];
    for (const row of r) {
      const [s, k, v, t, want] = row;
      const got = fairProbAboveE8(BigInt(s), BigInt(k), Number(v), BigInt(t));
      const err = Math.abs(got - wadToNum(want));
      if (err > worst) {
        worst = err;
        at = row;
      }
    }
    expect(worst, `worst at ${at.join(' ')}`).toBeLessThan(1e-14);
  });

  it('float-unit API agrees with the e8 API and handles edges', () => {
    expect(fairProbAbove(150, 155, 0.8, 86_400)).toBeCloseTo(0.2106991188316439, 14);
    expect(fairProbAboveE8(15_000_000_000n, 15_500_000_000n, 8_000, 86_400)).toBeCloseTo(0.2106991188316439, 14);
    expect(fairProbAbove(100, 100, 0.8, 0)).toBe(1);
    expect(fairProbAbove(99, 100, 0.8, -5)).toBe(0);
    expect(fairProbAbove(101, 100, 0, 3600)).toBe(1);
    expect(fairProbAbove(0, 100, 0.8, 3600)).toBe(0);
    expect(fairProbAbove(100, 0, 0.8, 3600)).toBe(1);
    // monotone in spot
    let prev = 0;
    for (let s = 100; s < 225; s += 0.1) {
      const p = fairProbAbove(s, 150, 0.8, 3600);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('WAD conversion round-trips', () => {
    expect(probToWad(0.37)).toBe(370_000_000_000_000_000n);
    expect(probToWad(1)).toBe(WAD);
    expect(probToWad(-1)).toBe(0n);
    const w = fairProbAboveWad(15_000_000_000n, 15_500_000_000n, 8_000, 86_400);
    expect(Math.abs(Number(w - 210_699_118_831_643_900n))).toBeLessThan(1_000);
  });
});

describe('probToTick', () => {
  it('rounds half up and clamps to 1..=99 exactly like prob_to_tick', () => {
    const c = WAD / 100n;
    const cases: [bigint, number][] = [
      [0n, 1],
      [c / 2n, 1],
      [c + c / 2n - 1n, 1],
      [c + c / 2n, 2],
      [37n * c + c / 2n - 1n, 37],
      [37n * c + c / 2n, 38],
      [WAD / 2n, 50],
      [98n * c + c / 2n, 99],
      [WAD, 99],
      [WAD + 1n, 99],
    ];
    for (const [p, t] of cases) expect(probToTickWad(p)).toBe(t);
    expect(probToTick(0.37)).toBe(37);
    expect(probToTick(0.375)).toBe(38);
    expect(probToTick(0)).toBe(1);
    expect(probToTick(1.5)).toBe(99);
  });
});

describe('buildLadder', () => {
  const params = { levels: 3, levelSpacing: 2, minHalfSpread: 2, levelNotional: 50_000_000n };

  it('worked example: fair 0.37, 1 day, 3 levels × 2 ticks, 50 USDC per level', () => {
    const l = buildLadder({
      fairWad: probToWad(0.37),
      tteSecs: 86_400,
      volBps: 8_000,
      seatCash: 0n,
      seatYes: 0n,
      seatNo: 0n,
      topupAvailable: 1_000_000_000n,
      params,
    });
    expect(l.fairTick).toBe(37);
    expect(l.quotes.map((q) => [q.side, q.tick, Number(q.qty), q.fromHeld])).toEqual([
      [0, 35, 142, false],
      [1, 39, 81, false],
      [0, 33, 151, false],
      [1, 41, 84, false],
      [0, 31, 161, false],
      [1, 43, 87, false],
    ]);
    expect(l.cashNeeded).toBe(298_000_000n);
  });

  it('time-decay width mirrors MakerVault', () => {
    expect(timeDecayWidth(86_400)).toBe(1);
    expect(timeDecayWidth(9_600)).toBe(1);
    expect(timeDecayWidth(9_599)).toBe(2);
    expect(timeDecayWidth(600)).toBe(4);
    expect(timeDecayWidth(60)).toBe(12);
    expect(timeDecayWidth(0)).toBe(12);
  });

  it('is byte-identical to the Rust build_ladder on the pinned fixture', () => {
    const lines = readFileSync(DATA + 'ladder_vectors.txt', 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(400);
    for (const line of lines) {
      const [lhs, rhs] = line.split(' | ');
      const [fair, tte, vol, cash, yes, no, topup, levels, spacing, mhs, notional] = lhs.split(' ');
      const [fairTick, cashNeeded, len, ...qs] = rhs.split(' ');
      const input: LadderInput = {
        fairWad: BigInt(fair),
        tteSecs: BigInt(tte),
        volBps: Number(vol),
        seatCash: BigInt(cash),
        seatYes: BigInt(yes),
        seatNo: BigInt(no),
        topupAvailable: BigInt(topup),
        params: { levels: Number(levels), levelSpacing: Number(spacing), minHalfSpread: Number(mhs), levelNotional: BigInt(notional) },
      };
      const l = buildLadder(input);
      expect(l.fairTick, line).toBe(Number(fairTick));
      expect(l.cashNeeded, line).toBe(BigInt(cashNeeded));
      expect(l.quotes.length, line).toBe(Number(len));
      expect(l.quotes.map((q) => `${q.side}:${q.tick}:${q.qty}:${q.fromHeld ? 1 : 0}`), line).toEqual(qs);
    }
  });
});
