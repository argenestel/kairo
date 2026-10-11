/**
 * Mock ChainAdapter — offline demo/development. Realistic enough to drive the whole UI:
 * random-walk prices, strike grids, an expiry ladder (15-min → monthly), a model-priced book with a spread
 * (lognormal N(d2) fair value), a fake wallet with balances, and buys that settle after ~1.2 s.
 * State (balances, positions) persists in localStorage per flavour.
 */
import type {
  AssetCategory, AssetInfo, Balances, BookLevel, BuyParams, BuyResult, ChainAdapter, ChainMeta, Direction,
  EventInfo, EventQuote, ExpiryOption, MarketInfo, Outcome, Position, Quote, TxResult, WalletOption,
} from './types';
import { probAbove } from '../lib/model';

export type MockFlavor = 'demo' | 'solana' | 'base' | 'arbitrum' | 'hyperliquid';

interface SeedAsset {
  symbol: string; name: string; price: number; strikeStep: number; vol: number;
  category?: AssetCategory; oracleNote?: string;
}

const KEEPER_NOTE = 'Keeper-reported (demo oracle) — US market hours';

const SEED: SeedAsset[] = [
  { symbol: 'SOL', name: 'Solana', price: 109.42, strikeStep: 1, vol: 0.85 },
  { symbol: 'BTC', name: 'Bitcoin', price: 83_240, strikeStep: 500, vol: 0.55 },
  { symbol: 'ETH', name: 'Ethereum', price: 2_964, strikeStep: 25, vol: 0.7 },
  { symbol: 'BNB', name: 'BNB', price: 612.3, strikeStep: 5, vol: 0.6 },
  { symbol: 'XRP', name: 'XRP', price: 2.431, strikeStep: 0.01, vol: 0.9 },
  { symbol: 'DOGE', name: 'Dogecoin', price: 0.08531, strikeStep: 0.001, vol: 1.0 },
  { symbol: 'TSLA', name: 'Tesla', price: 382.7, strikeStep: 5, vol: 0.55, category: 'stock', oracleNote: KEEPER_NOTE },
  { symbol: 'NVDA', name: 'NVIDIA', price: 229.28, strikeStep: 2.5, vol: 0.48, category: 'stock', oracleNote: KEEPER_NOTE },
  { symbol: 'SPY', name: 'S&P 500 ETF', price: 778.57, strikeStep: 5, vol: 0.16, category: 'etf', oracleNote: KEEPER_NOTE },
];

function usEquityClosed(ms = Date.now()): boolean {
  const d = new Date(ms);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes < 13 * 60 + 30 || minutes >= 20 * 60;
}

const HALF_SPREAD = 0.015;
const TICK = 0.01;
const STORE_KEY = 'montions.mock.v1';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const round2 = (x: number) => Math.round(x * 100) / 100;
const clampTick = (p: number) => Math.min(0.99, Math.max(0.01, round2(p)));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX = '0123456789abcdef';
const randStr = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface StoredPosition {
  marketId: string; symbol: string; strike: number; expiry: number; outcome: Outcome; contracts: number; cost: number;
  kind?: 'price' | 'event'; question?: string;
}
interface Store { address: string | null; native: number; collateral: number; positions: StoredPosition[]; seeded: boolean }

const META: Record<MockFlavor, Omit<ChainMeta, 'explorerTx' | 'explorerAddress'>> = {
  demo: {
    id: 'mock', label: 'Demo', network: 'Offline', collateralSymbol: 'tUSDC', nativeSymbol: 'GAS', oracleName: 'Mock feed',
    settlementNote: 'Demo data — prices are simulated and nothing is sent onchain.',
  },
  solana: {
    id: 'mock', label: 'Solana', network: 'Devnet · demo', collateralSymbol: 'tUSDC', nativeSymbol: 'SOL', oracleName: 'Pyth',
    settlementNote: 'Demo data — the Solana adapter is unavailable, so prices are simulated and nothing is sent onchain.',
  },
  base: {
    id: 'mock', label: 'Base', network: 'Sepolia · demo', collateralSymbol: 'tUSDC', nativeSymbol: 'ETH', oracleName: 'Chainlink',
    settlementNote: 'Demo data — the Base adapter is unavailable, so prices are simulated and nothing is sent onchain.',
  },
  arbitrum: {
    id: 'mock', label: 'Arbitrum', network: 'Sepolia · coming online', collateralSymbol: 'tUSDC', nativeSymbol: 'ETH', oracleName: 'Chainlink',
    settlementNote: 'Coming online — Arbitrum Sepolia is not wired yet. Prices are simulated and nothing is sent onchain.',
  },
  hyperliquid: {
    id: 'mock', label: 'Hyperliquid', network: 'Testnet · coming online', collateralSymbol: 'tUSDC', nativeSymbol: 'HYPE', oracleName: 'HyperCore',
    settlementNote: 'Coming online — HyperEVM will settle on the HyperCore native oracle (first print in the expiry window). Demo data only.',
  },
};

export function createMockAdapter(flavor: MockFlavor = 'demo'): ChainAdapter {
  const storeKey = `${STORE_KEY}.${flavor}`;
  const assets = new Map<string, AssetInfo>(
    SEED.map((a) => [a.symbol, {
      symbol: a.symbol, name: a.name, price: a.price * (1 + gauss() * 0.004), priceTime: Math.floor(now()),
      strikeStep: a.strikeStep, vol: a.vol, category: a.category ?? 'crypto', oracleNote: a.oracleNote,
      marketClosed: a.category === 'stock' || a.category === 'etf' ? usEquityClosed() : false,
    }]),
  );
  const listeners = new Set<(s: string, p: number, t: number) => void>();
  const accountListeners = new Set<(a: string | null) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const store: Store = load();

  function load(): Store {
    const empty: Store = { address: null, native: 2.5, collateral: 1000, positions: [], seeded: false };
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) return { ...empty, ...JSON.parse(raw), address: null };
    } catch { /* storage unavailable */ }
    return empty;
  }
  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify({ ...store, address: null })); } catch { /* ignore */ }
  }

  function tick() {
    const t = Math.floor(now());
    for (const a of assets.values()) {
      const equity = a.category === 'stock' || a.category === 'etf';
      a.marketClosed = equity ? usEquityClosed() : false;
      if (a.marketClosed) { for (const l of listeners) l(a.symbol, a.price, t); continue; }
      // ~2x real per-second vol so the wheel visibly breathes
      const sd = a.vol * Math.sqrt(1 / (365 * 24 * 3600)) * 2.2;
      a.price = a.price * Math.exp(sd * gauss());
      a.priceTime = t;
      for (const l of listeners) l(a.symbol, a.price, t);
    }
  }

  function asset(symbol: string): AssetInfo {
    const a = assets.get(symbol);
    if (!a) throw new Error(`Unknown asset ${symbol}`);
    return a;
  }

  function strikeGrid(symbol: string, spot: number): number[] {
    const a = asset(symbol);
    const mult = Math.max(1, Math.round((spot * 0.01) / a.strikeStep));
    const step = a.strikeStep * mult;
    const centre = Math.round(spot / step);
    const out: number[] = [];
    const dp = Math.max(0, -Math.floor(Math.log10(a.strikeStep)) + 1);
    for (let i = -30; i <= 30; i++) {
      const k = (centre + i) * step;
      if (k > 0) out.push(Number(k.toFixed(dp)));
    }
    return out;
  }

  function expiryLadder(): ExpiryOption[] {
    const t = now();
    const map = new Map<number, ExpiryOption>();
    const add = (e: number, hasMarkets: boolean, tag?: string) => {
      if (e <= t + 120) return;
      const prev = map.get(e);
      if (!prev || (tag && rank(tag) > rank(prev.tag))) map.set(e, { expiry: e, hasMarkets: hasMarkets || !!prev?.hasMarkets, tag });
    };
    const rank = (tag?: string) => ['15-min', 'Hourly', 'Daily', 'Weekly', 'Monthly'].indexOf(tag ?? '');
    // 15-minute slots for the next hour
    const q = Math.ceil(t / 900) * 900;
    for (let i = 0; i < 4; i++) add(q + i * 900, i < 2, '15-min');
    // hourly for the next 8 hours
    const h = Math.ceil(t / 3600) * 3600;
    for (let i = 1; i <= 8; i++) add(h + i * 3600, i <= 3, 'Hourly');
    // daily 16:00 UTC for 10 days
    const day0 = Math.floor(t / 86400) * 86400;
    for (let i = 0; i <= 10; i++) add(day0 + i * 86400 + 16 * 3600, i <= 3 || i % 2 === 0, 'Daily');
    // weekly Fridays 16:00 UTC for 12 weeks; last Friday of month = monthly (up to 3 months)
    const dow = new Date(day0 * 1000).getUTCDay();
    let fri = day0 + ((5 - dow + 7) % 7) * 86400 + 16 * 3600;
    if (fri <= t) fri += 7 * 86400;
    for (let i = 0; i < 13; i++) {
      const e = fri + i * 7 * 86400;
      const next = new Date((e + 7 * 86400) * 1000);
      const monthly = next.getUTCMonth() !== new Date(e * 1000).getUTCMonth();
      if (monthly) add(e, true, 'Monthly');
      else if (i < 8) add(e, i < 6, 'Weekly');
    }
    return [...map.values()].sort((a, b) => a.expiry - b.expiry);
  }

  function book(symbol: string, strike: number, expiry: number): { fair: number; bids: BookLevel[]; asks: BookLevel[] } {
    const a = asset(symbol);
    const fair = probAbove(a.price, strike, a.vol, expiry - now());
    const asks: BookLevel[] = [];
    const bids: BookLevel[] = [];
    const ask0 = clampTick(Math.ceil((fair + HALF_SPREAD) * 100) / 100);
    const bid0 = clampTick(Math.floor((fair - HALF_SPREAD) * 100) / 100);
    for (let i = 0; i < 6; i++) {
      const pa = round2(ask0 + i * TICK);
      if (pa <= 0.99) asks.push({ price: pa, qty: Math.round(700 * (1 + i * 0.45)) });
      const pb = round2(bid0 - i * TICK);
      if (pb >= 0.01 && pb < ask0) bids.push({ price: pb, qty: Math.round(700 * (1 + i * 0.45)) });
    }
    return { fair, bids, asks };
  }

  type Trade = { time: number; price: number; qty: number; takerBuy: boolean };
  type BookSnap = { bids: BookLevel[]; asks: BookLevel[]; trades: Trade[] };

  function withMaker(levels: BookLevel[]): BookLevel[] {
    return levels.map((l, i) => (i === 0 ? Object.assign({}, l, { maker: true }) : { ...l }));
  }

  function fakeTrades(mid: number, n = 10): Trade[] {
    const t = now();
    const out: Trade[] = [];
    for (let i = 0; i < n; i++) {
      const px = clampTick(mid + (Math.random() - 0.48) * 0.05);
      out.push({
        time: t - i * (35 + Math.random() * 40),
        price: px,
        qty: Math.round(8 + Math.random() * 90),
        takerBuy: Math.random() > 0.42,
      });
    }
    return out.sort((a, b) => b.time - a.time);
  }

  function ladderFromFair(fair: number): { bids: BookLevel[]; asks: BookLevel[] } {
    const asks: BookLevel[] = [];
    const bids: BookLevel[] = [];
    const ask0 = clampTick(Math.ceil((fair + HALF_SPREAD) * 100) / 100);
    const bid0 = clampTick(Math.floor((fair - HALF_SPREAD) * 100) / 100);
    for (let i = 0; i < 6; i++) {
      const pa = round2(ask0 + i * TICK);
      if (pa <= 0.99) asks.push({ price: pa, qty: Math.round(700 * (1 + i * 0.45)) });
      const pb = round2(bid0 - i * TICK);
      if (pb >= 0.01 && pb < ask0) bids.push({ price: pb, qty: Math.round(700 * (1 + i * 0.45)) });
    }
    return { bids, asks };
  }

  function closeAt(days: number, hour = 20): number {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hour, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  const events: EventInfo[] = [
    {
      id: 'evt-fed-cut', key: 'FED-CUT-2026-10-29',
      question: 'Will the Fed cut rates at the Oct 28–29 FOMC meeting?',
      category: 'macro',
      rules: 'Resolves YES if the FOMC statement published for the October 28–29 2026 meeting announces a decrease in the target federal funds rate relative to the prior target range. A hold, a hike, or no statement resolves NO. Ties (split statements) resolve VOID.',
      resolutionSource: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
      closeTime: closeAt(18, 18), status: 'open', bestBid: 0.41, bestAsk: 0.44, lastPrice: 0.43, volume: 18240, icon: '🏦',
    },
    {
      id: 'evt-btc-100k', key: 'BTC-100K-2026-12-31',
      question: 'Will Bitcoin trade at or above $100,000 before 2027?',
      category: 'crypto',
      rules: 'Resolves YES if any Binance, Coinbase or Kraken BTC/USD last trade prints at or above 100000.00 before 2027-01-01 00:00 UTC. Otherwise NO. Uses the first qualifying print.',
      resolutionSource: 'https://www.binance.com/en/trade/BTC_USDT',
      closeTime: closeAt(80, 23), status: 'open', bestBid: 0.26, bestAsk: 0.29, lastPrice: 0.28, volume: 44120, icon: '₿',
    },
    {
      id: 'evt-eth-etf', key: 'ETH-STAKING-ETF-2026',
      question: 'Will a spot Ether staking ETF be approved in the US in 2026?',
      category: 'crypto',
      rules: 'Resolves YES if the US SEC issues an order approving a listed spot Ether product that passes through staking yield to holders, on or before 2026-12-31 23:59 UTC. Filing without an approval order is NO.',
      resolutionSource: 'https://www.sec.gov/',
      closeTime: closeAt(60, 21), status: 'open', bestBid: 0.58, bestAsk: 0.62, lastPrice: 0.61, volume: 9680, icon: 'Ξ',
    },
    {
      id: 'evt-us-election-house', key: 'US-HOUSE-2026',
      question: 'Will Republicans hold the US House after the 2026 midterms?',
      category: 'politics',
      rules: 'Resolves YES if the Republican Party holds a majority of seated voting members of the US House of Representatives on the first day of the 120th Congress. Vacancies do not count. Source: clerk.house.gov party division.',
      resolutionSource: 'https://clerk.house.gov/',
      closeTime: closeAt(390, 8), status: 'open', bestBid: 0.47, bestAsk: 0.51, lastPrice: 0.49, volume: 22100, icon: '🏛',
    },
    {
      id: 'evt-world-cup', key: 'WC-2026-ARG',
      question: 'Will Argentina win the 2026 FIFA World Cup?',
      category: 'sports',
      rules: 'Resolves YES if Argentina is the winner of the 2026 FIFA World Cup final (including extra time and penalties). Any other champion, or a cancelled tournament, resolves NO / VOID respectively.',
      resolutionSource: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
      closeTime: closeAt(250, 2), status: 'open', bestBid: 0.17, bestAsk: 0.20, lastPrice: 0.19, volume: 15400, icon: '⚽',
    },
    {
      id: 'evt-openai-ipo', key: 'OPENAI-IPO-2026',
      question: 'Will OpenAI (or its parent) complete an IPO in 2026?',
      category: 'tech',
      rules: 'Resolves YES if a registration statement for ordinary shares or ADRs of OpenAI, OpenAI Group, or a successor parent is declared effective by the SEC and those shares begin trading on a US national exchange in calendar 2026. A tender offer or private round is NO.',
      resolutionSource: 'https://www.sec.gov/edgar/search/',
      closeTime: closeAt(70, 21), status: 'open', bestBid: 0.22, bestAsk: 0.26, lastPrice: 0.24, volume: 7300, icon: '✦',
    },
    {
      id: 'evt-gpt5', key: 'GPT5-PUBLIC-2026',
      question: 'Will OpenAI publicly release a model branded GPT-5 in 2026?',
      category: 'tech',
      rules: 'Resolves YES if OpenAI (openai.com or the ChatGPT product) ships a generally available model whose public name contains “GPT-5” before 2027-01-01. Research previews limited to a waitlist count. Internal codenames do not.',
      resolutionSource: 'https://openai.com/blog',
      closeTime: closeAt(45, 17), status: 'open', bestBid: 0.63, bestAsk: 0.67, lastPrice: 0.65, volume: 12100, icon: '✧',
    },
    {
      id: 'evt-oscars-picture', key: 'OSCARS-2027-PICTURE',
      question: 'Will a non-English-language film win Best Picture at the 2027 Oscars?',
      category: 'culture',
      rules: 'Resolves YES if the Academy Award for Best Picture at the 99th Academy Awards goes to a feature whose original dialogue is predominantly not English, as classified by the Academy. A cancelled ceremony resolves VOID.',
      resolutionSource: 'https://www.oscars.org/',
      closeTime: closeAt(510, 3), status: 'open', bestBid: 0.11, bestAsk: 0.14, lastPrice: 0.12, volume: 2100, icon: '🎬',
    },
  ];

  function eventById(id: string): EventInfo | undefined {
    return events.find((e) => e.id === id || e.key === id);
  }

  function eventBookSnap(e: EventInfo): BookSnap {
    const fair = e.lastPrice ?? ((e.bestBid ?? 0.5) + (e.bestAsk ?? 0.5)) / 2;
    const { bids, asks } = ladderFromFair(fair);
    return { bids: withMaker(bids), asks: withMaker(asks), trades: fakeTrades(fair) };
  }

  function computeEventQuote(e: EventInfo, outcome: Outcome, budget: number): EventQuote {
    const base: EventQuote = { outcome, budget, contracts: 0, avgPrice: 0, limitPrice: 0, cost: 0, payout: 0, tradable: false };
    if (e.status !== 'open' || e.closeTime <= now()) {
      return { ...base, reason: 'This market is closed for trading' };
    }
    const { bids, asks } = eventBookSnap(e);
    const levels = outcome === 'yes' ? asks : bids.map((l) => ({ price: round2(1 - l.price), qty: l.qty }));
    let remaining = budget;
    let contracts = 0;
    let cost = 0;
    let worst = levels[0]?.price ?? 0;
    for (const l of levels) {
      const take = Math.min(l.qty, Math.floor((remaining + 1e-9) / l.price));
      if (take <= 0) break;
      contracts += take;
      cost += take * l.price;
      remaining -= take * l.price;
      worst = l.price;
      if (take < l.qty) break;
    }
    if (contracts === 0) {
      const p = levels[0]?.price;
      return {
        ...base, avgPrice: p ?? 0, limitPrice: p ?? 0,
        reason: p ? `Budget is below one contract (${Math.round(p * 100)}¢)` : 'No liquidity yet',
      };
    }
    return { outcome, budget, contracts, avgPrice: cost / contracts, limitPrice: worst, cost: round2(cost), payout: contracts, tradable: true };
  }

  function marketId(symbol: string, strike: number, expiry: number) {
    return `${symbol}-${strike}-${expiry}`;
  }

  function hasMarketsAt(expiry: number) {
    return expiryLadder().find((e) => e.expiry === expiry)?.hasMarkets ?? false;
  }

  function computeQuote(symbol: string, strike: number, expiry: number, direction: Direction, budget: number): Quote {
    const outcome: Outcome = direction === 'above' ? 'yes' : 'no';
    const base: Quote = {
      outcome, budget, contracts: 0, avgPrice: 0, limitPrice: 0, cost: 0, payout: 0, chance: 0,
      needsMarket: false, tradable: false,
    };
    const tte = expiry - now();
    const { fair, bids, asks } = book(symbol, strike, expiry);
    const chance = direction === 'above' ? fair : 1 - fair;
    if (tte <= 60) return { ...base, chance, reason: 'This market is closed for trading' };
    const levels = direction === 'above' ? asks : bids.map((l) => ({ price: round2(1 - l.price), qty: l.qty }));
    let remaining = budget;
    let contracts = 0;
    let cost = 0;
    let worst = levels[0]?.price ?? 0;
    for (const l of levels) {
      const take = Math.min(l.qty, Math.floor((remaining + 1e-9) / l.price));
      if (take <= 0) break;
      contracts += take;
      cost += take * l.price;
      remaining -= take * l.price;
      worst = l.price;
      if (take < l.qty) break;
    }
    if (contracts === 0) {
      const p = levels[0]?.price;
      return {
        ...base, chance, avgPrice: p ?? 0, limitPrice: p ?? 0,
        reason: p ? `Budget is below one contract (${Math.round(p * 100)}¢)` : 'No liquidity at this strike yet',
      };
    }
    return {
      outcome, budget, contracts, avgPrice: cost / contracts, limitPrice: worst, cost: round2(cost), payout: contracts,
      chance, needsMarket: !hasMarketsAt(expiry), tradable: true,
    };
  }

  const evm = flavor === 'base' || flavor === 'arbitrum' || flavor === 'hyperliquid';
  function fakeSig(): string {
    return evm ? `0x${randStr(HEX, 64)}` : randStr(B58, 88);
  }
  function fakeAddress(): string {
    return evm ? `0x${randStr(HEX, 40)}` : randStr(B58, 44);
  }
  function tx(signature: string): TxResult {
    return { signature, explorerUrl: meta.explorerTx(signature) };
  }
  function requireWallet() {
    if (!store.address) throw new Error('Wallet is not connected');
  }
  function emitAccount() {
    for (const l of accountListeners) l(store.address);
  }

  function seedPositions() {
    if (store.seeded) return;
    store.seeded = true;
    const exps = expiryLadder();
    const sol = asset('SOL');
    const btc = asset('BTC');
    const e1 = exps.find((e) => e.tag === 'Weekly')?.expiry ?? exps[exps.length - 1].expiry;
    const solStrike = Math.round(sol.price * 1.05);
    store.positions.push({ marketId: marketId('SOL', solStrike, e1), symbol: 'SOL', strike: solStrike, expiry: e1, outcome: 'yes', contracts: 120, cost: 42 });
    const past = Math.floor(now() / 3600) * 3600 - 2 * 3600;
    const btcStrike = Math.round((btc.price * 0.98) / 500) * 500;
    store.positions.push({ marketId: marketId('BTC', btcStrike, past), symbol: 'BTC', strike: btcStrike, expiry: past, outcome: 'yes', contracts: 60, cost: 33 });
    const ev = events[0];
    store.positions.push({
      marketId: ev.id, symbol: ev.key, strike: 0, expiry: ev.closeTime, outcome: 'yes', contracts: 40, cost: 17.2,
      kind: 'event', question: ev.question,
    });
    save();
  }

  const meta: ChainMeta = {
    ...META[flavor],
    explorerTx: () => '',
    explorerAddress: () => '',
  };

  const adapter: ChainAdapter = {
    meta,

    async listAssets() {
      await sleep(180);
      return [...assets.values()].map((a) => {
        const equity = a.category === 'stock' || a.category === 'etf';
        return { ...a, marketClosed: equity ? usEquityClosed() : a.marketClosed };
      });
    },

    subscribePrices(onPrice) {
      listeners.add(onPrice);
      if (!timer) timer = setInterval(tick, 1000);
      return () => {
        listeners.delete(onPrice);
        if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
      };
    },

    async strikes(symbol, spot) {
      await sleep(120);
      return strikeGrid(symbol, spot || asset(symbol).price);
    },

    async expiries(symbol) {
      asset(symbol);
      await sleep(100);
      return expiryLadder();
    },

    async getMarket(symbol, strike, expiry): Promise<MarketInfo | null> {
      await sleep(80);
      const { bids, asks } = book(symbol, strike, expiry);
      const resolved = expiry < now();
      const a = asset(symbol);
      return {
        id: marketId(symbol, strike, expiry), symbol, strike, expiry,
        status: resolved ? 'resolved' : 'open',
        outcome: resolved ? (a.price >= strike ? 'yes' : 'no') : undefined,
        settlePrice: resolved ? a.price : undefined,
        bids: resolved ? [] : bids, asks: resolved ? [] : asks,
        lastPrice: asks[0]?.price, volume: 1200 + Math.round(Math.random() * 4000),
      };
    },

    async quote(symbol, strike, expiry, direction, budget) {
      await sleep(90 + Math.random() * 120);
      return computeQuote(symbol, strike, expiry, direction, budget);
    },

    walletOptions(): WalletOption[] {
      return [{ id: 'demo', name: 'Demo wallet', installed: true }];
    },

    async connect() {
      await sleep(450);
      if (!store.address) store.address = fakeAddress();
      seedPositions();
      emitAccount();
      return store.address;
    },

    async disconnect() {
      store.address = null;
      emitAccount();
    },

    address: () => store.address,

    onAccountChange(cb) {
      accountListeners.add(cb);
      return () => accountListeners.delete(cb);
    },

    async balances(): Promise<Balances> {
      requireWallet();
      await sleep(80);
      return { native: store.native, collateral: round2(store.collateral) };
    },

    async faucet() {
      requireWallet();
      await sleep(900);
      store.collateral += 1000;
      store.native += 1;
      save();
      return tx(fakeSig());
    },

    async buy(p: BuyParams): Promise<BuyResult> {
      requireWallet();
      await sleep(1200);
      const q = computeQuote(p.symbol, p.strike, p.expiry, p.direction, p.budget);
      if (!q.tradable) throw new Error(q.reason ?? 'Not tradable');
      if (q.avgPrice > p.maxPrice + 1e-9) throw new Error('Price moved beyond your limit');
      if (q.cost > store.collateral + 1e-9) throw new Error(`Insufficient tUSDC balance (${store.collateral.toFixed(2)} available)`);
      store.collateral -= q.cost;
      store.native = Math.max(0, store.native - 0.00021);
      const id = marketId(p.symbol, p.strike, p.expiry);
      const existing = store.positions.find((x) => x.marketId === id && x.outcome === q.outcome);
      if (existing) { existing.contracts += q.contracts; existing.cost += q.cost; }
      else store.positions.push({ marketId: id, symbol: p.symbol, strike: p.strike, expiry: p.expiry, outcome: q.outcome, contracts: q.contracts, cost: q.cost });
      save();
      const sig = fakeSig();
      return { ...tx(sig), marketId: id, contracts: q.contracts, cost: q.cost };
    },

    async positions(): Promise<Position[]> {
      if (!store.address) return [];
      await sleep(150);
      const t = now();
      return store.positions.map((s) => {
        if (s.kind === 'event') {
          const ev = eventById(s.marketId) ?? eventById(s.symbol);
          const resolved = (ev?.status === 'resolved' || ev?.status === 'void') || s.expiry <= t;
          const won = resolved ? (ev?.outcome ? (s.outcome === ev.outcome) : false) : undefined;
          const mark = resolved ? (won ? 1 : 0) : s.outcome === 'yes' ? (ev?.bestBid ?? ev?.lastPrice ?? 0.5) : round2(1 - (ev?.bestAsk ?? ev?.lastPrice ?? 0.5));
          return {
            kind: 'event' as const, question: s.question ?? ev?.question,
            marketId: s.marketId, symbol: s.symbol, strike: 0, expiry: s.expiry, outcome: s.outcome,
            contracts: s.contracts, mark, status: resolved ? 'resolved' as const : 'open' as const,
            claimable: resolved && won ? s.contracts : 0, won,
          };
        }
        const a = asset(s.symbol);
        const resolved = s.expiry <= t;
        const yesWins = a.price >= s.strike;
        const won = resolved ? (s.outcome === 'yes') === yesWins : undefined;
        const { bids, fair } = book(s.symbol, s.strike, s.expiry);
        const mark = resolved ? (won ? 1 : 0) : s.outcome === 'yes' ? (bids[0]?.price ?? fair) : clampTick(1 - fair - HALF_SPREAD);
        return {
          kind: 'price' as const,
          marketId: s.marketId, symbol: s.symbol, strike: s.strike, expiry: s.expiry, outcome: s.outcome,
          contracts: s.contracts, mark, status: resolved ? 'resolved' as const : 'open' as const,
          claimable: resolved && won ? s.contracts : 0, won,
        };
      });
    },

    async claim(id) {
      requireWallet();
      await sleep(900);
      const t = now();
      const hit = store.positions.filter((s) => s.marketId === id && s.expiry <= t);
      if (!hit.length) throw new Error('Nothing to claim for this market yet');
      for (const s of hit) {
        let won = false;
        if (s.kind === 'event') {
          const ev = eventById(s.marketId);
          won = !!ev?.outcome && s.outcome === ev.outcome;
        } else {
          won = (s.outcome === 'yes') === (asset(s.symbol).price >= s.strike);
        }
        if (won) store.collateral += s.contracts;
      }
      store.positions = store.positions.filter((s) => !hit.includes(s));
      save();
      return tx(fakeSig());
    },

    async sell(id, outcome, contracts, minPrice) {
      requireWallet();
      await sleep(1000);
      const s = store.positions.find((x) => x.marketId === id && x.outcome === outcome);
      if (!s) throw new Error('Position not found');
      let px: number;
      if (s.kind === 'event') {
        const ev = eventById(s.marketId);
        if (!ev) throw new Error('Event not found');
        const { bids } = eventBookSnap(ev);
        px = outcome === 'yes' ? (bids[0]?.price ?? 0) : clampTick(1 - (ev.lastPrice ?? 0.5) - HALF_SPREAD);
      } else {
        const { bids, fair } = book(s.symbol, s.strike, s.expiry);
        px = outcome === 'yes' ? (bids[0]?.price ?? 0) : clampTick(1 - fair - HALF_SPREAD);
      }
      if (px < minPrice - 1e-9) throw new Error('Price moved beyond your limit');
      const n = Math.min(contracts, s.contracts);
      store.collateral += n * px;
      s.cost *= (s.contracts - n) / s.contracts;
      s.contracts -= n;
      if (s.contracts <= 0) store.positions = store.positions.filter((x) => x !== s);
      save();
      return tx(fakeSig());
    },

    async getBook(marketId) {
      await sleep(60);
      const ev = eventById(marketId);
      if (ev) return eventBookSnap(ev);
      const parts = marketId.split('-');
      if (parts.length >= 3) {
        const expiry = Number(parts[parts.length - 1]);
        const strike = Number(parts[parts.length - 2]);
        const symbol = parts.slice(0, -2).join('-');
        if (assets.has(symbol) && strike > 0 && expiry > 0) {
          const { fair, bids, asks } = book(symbol, strike, expiry);
          return { bids: withMaker(bids), asks: withMaker(asks), trades: fakeTrades(asks[0]?.price ?? fair) };
        }
      }
      return { bids: [], asks: [], trades: [] };
    },

    async listEvents() {
      await sleep(160);
      return events.map((e) => ({ ...e }));
    },

    async quoteEvent(eventId, outcome, budget) {
      await sleep(80 + Math.random() * 80);
      const e = eventById(eventId);
      if (!e) return { outcome, budget, contracts: 0, avgPrice: 0, limitPrice: 0, cost: 0, payout: 0, tradable: false, reason: 'Unknown event' };
      return computeEventQuote(e, outcome, budget);
    },

    async buyEvent(eventId, outcome, budget, maxPrice) {
      requireWallet();
      await sleep(1100);
      const e = eventById(eventId);
      if (!e) throw new Error('Unknown event');
      const q = computeEventQuote(e, outcome, budget);
      if (!q.tradable) throw new Error(q.reason ?? 'Not tradable');
      if (q.avgPrice > maxPrice + 1e-9) throw new Error('Price moved beyond your limit');
      if (q.cost > store.collateral + 1e-9) throw new Error(`Insufficient tUSDC balance (${store.collateral.toFixed(2)} available)`);
      store.collateral -= q.cost;
      store.native = Math.max(0, store.native - 0.00021);
      const existing = store.positions.find((x) => x.marketId === e.id && x.outcome === q.outcome);
      if (existing) { existing.contracts += q.contracts; existing.cost += q.cost; }
      else {
        store.positions.push({
          marketId: e.id, symbol: e.key, strike: 0, expiry: e.closeTime, outcome: q.outcome,
          contracts: q.contracts, cost: q.cost, kind: 'event', question: e.question,
        });
      }
      save();
      const sig = fakeSig();
      return { ...tx(sig), marketId: e.id, contracts: q.contracts, cost: q.cost };
    },
  };
  return adapter;
}
