/**
 * Account decoders.
 * - `decodeMarket`: byte-offset decoder of the zero-copy Market (SPEC §3.1) → typed view with the book
 *   aggregated by tick, live orders, occupied seats and recent trades.
 * - `decodePythPrice`: Pyth receiver PriceUpdateV2 (SPEC §7).
 * - `decodeConfig` / `decodeAsset` / `decodeFaucetClaim`: Anchor Borsh accounts via the IDL coder.
 */
import { BorshCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  DISCRIMINATORS,
  LEVELS,
  LEVEL_SIZE,
  MARKET_ACCOUNT_SIZE,
  MARKET_HEADER_SIZE,
  MARKET_OFFSETS as O,
  MAX_ORDERS,
  MAX_SEATS,
  NIL,
  ORDER_SIZE,
  SEAT_SIZE,
  SIDE_ASK,
  SIDE_BID,
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_VOID,
  TRADE_RING,
  TRADE_SIZE,
} from './constants.js';
import { IDL } from './idl/index.js';
import { toE8 } from './ticks.js';

/** Shared Anchor Borsh coder over the raw (snake_case) IDL. */
export const coder = new BorshCoder(IDL as unknown as Idl);

export type MarketStatusName = 'open' | 'resolved' | 'void' | 'uninitialized';

export interface BookLevelView {
  /** YES tick 1..=99. */
  tick: number;
  /** Total contracts resting at this tick. */
  qty: bigint;
  /** Number of resting orders. */
  orders: number;
}

export interface OrderView {
  slot: number;
  id: bigint;
  qty: bigint;
  ts: number;
  seat: number;
  side: number;
  tick: number;
  fromHeld: boolean;
  prev: number;
  next: number;
  /** Owner of the order's seat (null if the seat index is out of range / free). */
  owner: PublicKey | null;
}

export interface SeatView {
  index: number;
  owner: PublicKey;
  cash: bigint;
  locked: bigint;
  yes: bigint;
  no: bigint;
  yesLocked: bigint;
  noLocked: bigint;
  openOrders: number;
}

export interface TradeView {
  ts: number;
  qty: number;
  tick: number;
  takerIsBuyer: boolean;
}

export interface MarketView {
  address: PublicKey | null;
  asset: PublicKey;
  /** Pyth feed id, lowercase hex without 0x. */
  feedId: string;
  creator: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  /** Strike, 1e-8 USD. */
  strike: bigint;
  expiry: number;
  createdAt: number;
  settlePrice: bigint;
  settlePublishTime: number;
  pool: bigint;
  yesTotal: bigint;
  noTotal: bigint;
  fees: bigint;
  volume: bigint;
  nextOrderId: bigint;
  bidBits: [bigint, bigint];
  askBits: [bigint, bigint];
  status: number;
  statusName: MarketStatusName;
  /** 1 = YES won, 0 = NO won (only when resolved). */
  outcome: number;
  bump: number;
  vaultBump: number;
  yesMintBump: number;
  noMintBump: number;
  lastTradeTick: number;
  tradeHead: number;
  tradeCount: number;
  freeHead: number;
  /** Bids (buy YES), best (highest) first. */
  bids: BookLevelView[];
  /** Asks (sell YES), best (lowest) first. */
  asks: BookLevelView[];
  /** Best bid / ask tick, 0 if that side is empty. */
  bestBid: number;
  bestAsk: number;
  /** Live resting orders in price-time priority per side (bids desc, asks asc, FIFO within a tick). */
  orders: OrderView[];
  /** Occupied seats. */
  seats: SeatView[];
  /** Recent fills, newest first. */
  trades: TradeView[];
  /** false when decoded from a header-only data slice (no book / seats / trades). */
  full: boolean;
}

function toBytes(data: Uint8Array | Buffer | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const DEFAULT_PUBKEY_BYTES = new Uint8Array(32);

function statusName(s: number): MarketStatusName {
  return s === STATUS_OPEN ? 'open' : s === STATUS_RESOLVED ? 'resolved' : s === STATUS_VOID ? 'void' : 'uninitialized';
}

/** True if `data` starts with the Market discriminator. */
export function isMarketAccount(data: Uint8Array): boolean {
  return data.length >= 8 && eqBytes(data.subarray(0, 8), DISCRIMINATORS.Market);
}

export interface DecodeMarketOptions {
  /** Throw on a wrong discriminator (default true). */
  checkDiscriminator?: boolean;
}

/**
 * Decode a Market account (full 5184 bytes, or a header slice of >= 368 bytes for listings).
 * Book levels are aggregated by walking each level's FIFO list from `head` (cycle-safe).
 */
export function decodeMarket(
  raw: Uint8Array | Buffer | ArrayBuffer,
  address: PublicKey | string | null = null,
  opts: DecodeMarketOptions = {},
): MarketView {
  const data = toBytes(raw);
  if (data.length < MARKET_HEADER_SIZE) throw new RangeError(`market data too short: ${data.length} bytes`);
  if ((opts.checkDiscriminator ?? true) && !isMarketAccount(data)) throw new Error('not a Montions Market account');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (o: number) => dv.getBigUint64(o, true);
  const i64 = (o: number) => dv.getBigInt64(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const u8 = (o: number) => data[o]!;
  const pk = (o: number) => new PublicKey(data.subarray(o, o + 32));

  const status = u8(O.status);
  const view: MarketView = {
    address: address === null ? null : typeof address === 'string' ? new PublicKey(address) : address,
    asset: pk(O.asset),
    feedId: hex(data.subarray(O.feedId, O.feedId + 32)),
    creator: pk(O.creator),
    yesMint: pk(O.yesMint),
    noMint: pk(O.noMint),
    vault: pk(O.vault),
    strike: u64(O.strike),
    expiry: Number(i64(O.expiry)),
    createdAt: Number(i64(O.createdAt)),
    settlePrice: i64(O.settlePrice),
    settlePublishTime: Number(i64(O.settlePublishTime)),
    pool: u64(O.pool),
    yesTotal: u64(O.yesTotal),
    noTotal: u64(O.noTotal),
    fees: u64(O.fees),
    volume: u64(O.volume),
    nextOrderId: u64(O.nextOrderId),
    bidBits: [u64(O.bidBits), u64(O.bidBits + 8)],
    askBits: [u64(O.askBits), u64(O.askBits + 8)],
    status,
    statusName: statusName(status),
    outcome: u8(O.outcome),
    bump: u8(O.bump),
    vaultBump: u8(O.vaultBump),
    yesMintBump: u8(O.yesMintBump),
    noMintBump: u8(O.noMintBump),
    lastTradeTick: u8(O.lastTradeTick),
    tradeHead: u8(O.tradeHead),
    tradeCount: u32(O.tradeCount),
    freeHead: u8(O.freeHead),
    bids: [],
    asks: [],
    bestBid: 0,
    bestAsk: 0,
    orders: [],
    seats: [],
    trades: [],
    full: data.length >= MARKET_ACCOUNT_SIZE,
  };
  if (!view.full) return view;

  // seats
  const seatOwners: (PublicKey | null)[] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    const o = O.seats + i * SEAT_SIZE;
    const ownerBytes = data.subarray(o, o + 32);
    if (eqBytes(ownerBytes, DEFAULT_PUBKEY_BYTES)) {
      seatOwners.push(null);
      continue;
    }
    const owner = new PublicKey(ownerBytes);
    seatOwners.push(owner);
    view.seats.push({
      index: i,
      owner,
      cash: u64(o + 32),
      locked: u64(o + 40),
      yes: u64(o + 48),
      no: u64(o + 56),
      yesLocked: u64(o + 64),
      noLocked: u64(o + 72),
      openOrders: u32(o + 80),
    });
  }

  // orders (raw slots)
  const readOrder = (slot: number): OrderView => {
    const o = O.orders + slot * ORDER_SIZE;
    const seat = u8(o + 24);
    return {
      slot,
      id: u64(o),
      qty: u64(o + 8),
      ts: Number(i64(o + 16)),
      seat,
      side: u8(o + 25),
      tick: u8(o + 26),
      fromHeld: u8(o + 27) !== 0,
      prev: u8(o + 28),
      next: u8(o + 29),
      owner: seat < MAX_SEATS ? (seatOwners[seat] ?? null) : null,
    };
  };

  const walkSide = (side: number): BookLevelView[] => {
    const base = side === SIDE_BID ? O.bidLevels : O.askLevels;
    const levels: BookLevelView[] = [];
    const ticks: number[] = [];
    for (let t = 1; t < LEVELS; t++) ticks.push(t);
    if (side === SIDE_BID) ticks.reverse();
    for (const t of ticks) {
      const head = u8(base + t * LEVEL_SIZE);
      if (head === NIL || head >= MAX_ORDERS) continue;
      let cur = head;
      let qty = 0n;
      let n = 0;
      const seen = new Set<number>();
      while (cur !== NIL && cur < MAX_ORDERS && !seen.has(cur)) {
        seen.add(cur);
        const ord = readOrder(cur);
        if (ord.id === 0n || ord.side !== side || ord.tick !== t) break;
        qty += ord.qty;
        n++;
        view.orders.push(ord);
        cur = ord.next;
      }
      if (n > 0 && qty > 0n) levels.push({ tick: t, qty, orders: n });
    }
    return levels;
  };
  view.bids = walkSide(SIDE_BID);
  view.asks = walkSide(SIDE_ASK);
  view.bestBid = view.bids[0]?.tick ?? 0;
  view.bestAsk = view.asks[0]?.tick ?? 0;

  // trades: newest first
  const n = Math.min(view.tradeCount, TRADE_RING);
  for (let k = 1; k <= n; k++) {
    const idx = (((view.tradeHead - k) % TRADE_RING) + TRADE_RING) % TRADE_RING;
    const o = O.trades + idx * TRADE_SIZE;
    view.trades.push({ ts: Number(i64(o)), qty: u32(o + 8), tick: u8(o + 12), takerIsBuyer: u8(o + 13) !== 0 });
  }
  return view;
}

/** Bit `t` of a `[lo, hi]` occupancy bitmap. */
export function bitmapHas(bits: [bigint, bigint], tick: number): boolean {
  const word = tick < 64 ? bits[0] : bits[1];
  return ((word >> BigInt(tick % 64)) & 1n) === 1n;
}

/** Seat of `owner` in a decoded market, if any. */
export function findSeat(market: MarketView, owner: PublicKey): SeatView | undefined {
  return market.seats.find((s) => s.owner.equals(owner));
}

// ───────────────────────────── Pyth ─────────────────────────────

export interface PythPriceView {
  writeAuthority: PublicKey;
  verification: 'full' | 'partial';
  numSignatures?: number;
  /** lowercase hex, no 0x */
  feedId: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: number;
  prevPublishTime: number;
  emaPrice: bigint;
  emaConf: bigint;
  postedSlot: bigint;
  /** price and conf rescaled to 1e-8 USD */
  priceE8: bigint;
  confE8: bigint;
  /** float USD (display / model input) */
  priceUsd: number;
  confUsd: number;
}

/** Decode a Pyth receiver PriceUpdateV2 account (throws on a wrong discriminator). */
export function decodePythPrice(raw: Uint8Array | Buffer | ArrayBuffer): PythPriceView {
  const data = toBytes(raw);
  if (data.length < 8 + 32 + 1 + 32 + 8 * 7 + 4) throw new RangeError('price update too short');
  if (!eqBytes(data.subarray(0, 8), DISCRIMINATORS.PriceUpdateV2)) throw new Error('not a Pyth PriceUpdateV2 account');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const writeAuthority = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const tag = data[o]!;
  let verification: 'full' | 'partial';
  let numSignatures: number | undefined;
  if (tag === 0) {
    verification = 'partial';
    numSignatures = data[o + 1];
    o += 2;
  } else if (tag === 1) {
    verification = 'full';
    o += 1;
  } else throw new Error(`unknown verification level ${tag}`);
  const feedId = hex(data.subarray(o, o + 32));
  o += 32;
  const price = dv.getBigInt64(o, true);
  const conf = dv.getBigUint64(o + 8, true);
  const exponent = dv.getInt32(o + 16, true);
  const publishTime = Number(dv.getBigInt64(o + 20, true));
  const prevPublishTime = Number(dv.getBigInt64(o + 28, true));
  const emaPrice = dv.getBigInt64(o + 36, true);
  const emaConf = dv.getBigUint64(o + 44, true);
  const postedSlot = dv.getBigUint64(o + 52, true);
  const priceE8 = toE8(price, exponent);
  const confE8 = toE8(conf, exponent);
  return {
    writeAuthority,
    verification,
    ...(numSignatures !== undefined ? { numSignatures } : {}),
    feedId,
    price,
    conf,
    exponent,
    publishTime,
    prevPublishTime,
    emaPrice,
    emaConf,
    postedSlot,
    priceE8,
    confE8,
    priceUsd: Number(price) * 10 ** exponent,
    confUsd: Number(conf) * 10 ** exponent,
  };
}

// ───────────────────────────── Borsh accounts ─────────────────────────────

type BNLike = { toString(): string };
const big = (v: BNLike | number | bigint): bigint => (typeof v === 'bigint' ? v : BigInt(v.toString()));

export interface MakerParamsView {
  enabled: boolean;
  levels: number;
  levelSpacing: number;
  minHalfSpread: number;
  maxMarketExposure: bigint;
  levelNotional: bigint;
  minTte: number;
  maxPriceAge: number;
}

export interface ConfigView {
  admin: PublicKey;
  collateralMint: PublicKey;
  maker: PublicKey;
  treasury: PublicKey;
  feeBps: number;
  paused: boolean;
  bump: number;
  collateralBump: number;
  makerBump: number;
  treasuryBump: number;
  faucetAmount: bigint;
  faucetCooldown: number;
  marketCount: bigint;
  makerParams: MakerParamsView;
}

export interface AssetView {
  address: PublicKey | null;
  symbol: string;
  feedId: string;
  priceAccount: PublicKey;
  /** 1e-8 USD */
  strikeStep: bigint;
  volBps: number;
  maxConfBps: number;
  active: boolean;
  bump: number;
  settleWindow: number;
  marketCount: number;
}

export interface FaucetClaimView {
  lastClaim: number;
  bump: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

export function makerParamsFromRaw(m: Raw): MakerParamsView {
  return {
    enabled: m.enabled,
    levels: m.levels,
    levelSpacing: m.level_spacing,
    minHalfSpread: m.min_half_spread,
    maxMarketExposure: big(m.max_market_exposure),
    levelNotional: big(m.level_notional),
    minTte: Number(big(m.min_tte)),
    maxPriceAge: Number(big(m.max_price_age)),
  };
}

export function decodeConfig(data: Uint8Array | Buffer): ConfigView {
  const c: Raw = coder.accounts.decode('Config', Buffer.from(data));
  return {
    admin: c.admin,
    collateralMint: c.collateral_mint,
    maker: c.maker,
    treasury: c.treasury,
    feeBps: c.fee_bps,
    paused: c.paused,
    bump: c.bump,
    collateralBump: c.collateral_bump,
    makerBump: c.maker_bump,
    treasuryBump: c.treasury_bump,
    faucetAmount: big(c.faucet_amount),
    faucetCooldown: Number(big(c.faucet_cooldown)),
    marketCount: big(c.market_count),
    makerParams: makerParamsFromRaw(c.maker_params),
  };
}

export function decodeAsset(data: Uint8Array | Buffer, address: PublicKey | null = null): AssetView {
  const a: Raw = coder.accounts.decode('Asset', Buffer.from(data));
  return {
    address,
    symbol: a.symbol,
    feedId: Buffer.from(a.feed_id as number[]).toString('hex'),
    priceAccount: a.price_account,
    strikeStep: big(a.strike_step),
    volBps: a.vol_bps,
    maxConfBps: a.max_conf_bps,
    active: a.active,
    bump: a.bump,
    settleWindow: Number(big(a.settle_window)),
    marketCount: a.market_count,
  };
}

export function decodeFaucetClaim(data: Uint8Array | Buffer): FaucetClaimView {
  const f: Raw = coder.accounts.decode('FaucetClaim', Buffer.from(data));
  return { lastClaim: Number(big(f.last_claim)), bump: f.bump };
}

