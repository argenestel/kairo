/**
 * Protocol constants — TS twin of programs/montions/src/constants.rs (docs/SPEC.md §3).
 * Amounts are bigint collateral base units (6 decimals), strikes/prices bigint 1e-8 USD.
 */
import { PublicKey } from '@solana/web3.js';
import { IDL } from './idl/index.js';

export const PROGRAM_ID = new PublicKey('MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh');
/** Pyth Solana Receiver (owner of PriceUpdateV2 accounts, incl. sponsored feeds). */
export const PYTH_RECEIVER_ID = new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ');
/** Pyth push-oracle program (sponsored feed PDAs: [shard u16 LE, feed_id]). */
export const PYTH_PUSH_ORACLE_ID = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');

/** Collateral decimals and the payout of one winning contract ($1). */
export const COLLATERAL_DECIMALS = 6;
export const UNIT = 1_000_000n;
/** One price tick (1¢) in base units. */
export const TICK_UNIT = 10_000n;
export const TICKS = 100;
export const MIN_TICK = 1;
export const MAX_TICK = 99;
export const LEVELS = 100;

export const MAX_ORDERS = 64;
export const MAX_SEATS = 24;
export const TRADE_RING = 16;
export const NIL = 255;

export const MIN_DURATION = 120;
export const MAX_DURATION = 90 * 86_400;
export const EXPIRY_GRID = 300;
export const VOID_GRACE = 86_400;

export const MAX_ORDER_QTY = 1_000_000_000n;
export const DEFAULT_MAX_FILLS = 32;
export const MAX_FEE_BPS = 100;

/** Strikes and settlement prices are USD × 1e8. */
export const PRICE_DECIMALS = 8;
export const PRICE_SCALE = 100_000_000n;

export const STATUS_OPEN = 1;
export const STATUS_RESOLVED = 2;
export const STATUS_VOID = 3;

export const SIDE_BID = 0;
export const SIDE_ASK = 1;

export const TIF_GTC = 0;
export const TIF_IOC = 1;
export const TIF_POST_ONLY = 2;

export const SEED_CONFIG = 'config';
export const SEED_COLLATERAL = 'collateral';
export const SEED_MAKER = 'maker';
export const SEED_TREASURY = 'treasury';
export const SEED_ASSET = 'asset';
export const SEED_MARKET = 'market';
export const SEED_YES = 'yes';
export const SEED_NO = 'no';
export const SEED_VAULT = 'vault';
export const SEED_FAUCET = 'faucet';

/** Market account size incl. the 8-byte discriminator (§3.1). */
export const MARKET_ACCOUNT_SIZE = 5184;
/** Header bytes (everything before the level arrays) — enough for listing without the book. */
export const MARKET_HEADER_SIZE = 368;

/** Byte offsets inside the Market account (incl. discriminator) — FROZEN layout, SPEC §3.1. */
export const MARKET_OFFSETS = {
  asset: 8,
  feedId: 40,
  creator: 72,
  yesMint: 104,
  noMint: 136,
  vault: 168,
  strike: 200,
  expiry: 208,
  createdAt: 216,
  settlePrice: 224,
  settlePublishTime: 232,
  pool: 240,
  yesTotal: 248,
  noTotal: 256,
  fees: 264,
  volume: 272,
  nextOrderId: 280,
  bidBits: 288,
  askBits: 304,
  status: 320,
  outcome: 321,
  bump: 322,
  vaultBump: 323,
  yesMintBump: 324,
  noMintBump: 325,
  lastTradeTick: 326,
  tradeHead: 327,
  tradeCount: 328,
  freeHead: 332,
  reserved: 336,
  bidLevels: 368,
  askLevels: 568,
  orders: 768,
  seats: 2816,
  trades: 4928,
  end: 5184,
} as const;
export const ORDER_SIZE = 32;
export const SEAT_SIZE = 88;
export const TRADE_SIZE = 16;
export const LEVEL_SIZE = 2;

function idlDisc(name: string): Uint8Array {
  const acc = (IDL as unknown as { accounts: { name: string; discriminator: number[] }[] }).accounts.find(
    (a) => a.name === name,
  );
  if (!acc) throw new Error(`IDL has no account ${name}`);
  return Uint8Array.from(acc.discriminator);
}

/** Anchor account discriminators (sha256("account:<Name>")[..8]). */
export const DISCRIMINATORS = {
  Config: idlDisc('Config'),
  Asset: idlDisc('Asset'),
  Market: idlDisc('Market'),
  FaucetClaim: idlDisc('FaucetClaim'),
  /** Pyth receiver PriceUpdateV2. */
  PriceUpdateV2: Uint8Array.from([34, 241, 35, 99, 157, 126, 244, 205]),
} as const;

/** Rent-exempt sizes of the accounts a `create_market` allocates (for cost projections). */
export const CREATE_MARKET_SPACE = {
  market: MARKET_ACCOUNT_SIZE,
  yesMint: 82,
  noMint: 82,
  vault: 165,
} as const;

/** Rough lamports needed to create one market (rent of 4 accounts at the default 3480 lamports/byte-year × 2 years). */
export function estimateCreateMarketLamports(lamportsPerByte = 6960): number {
  const sizes = Object.values(CREATE_MARKET_SPACE);
  return sizes.reduce((acc, s) => acc + (s + 128) * lamportsPerByte, 0);
}
