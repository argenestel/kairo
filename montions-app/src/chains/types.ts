/**
 * ChainAdapter — the only surface the UI talks to. FROZEN (main agent). One implementation per chain:
 *   src/chains/solana.ts  (Solana devnet, Anchor program + Pyth)        — owner: sdk agent
 *   src/chains/base.ts    (Base Sepolia, Solidity Book + Chainlink)     — owner: base agent
 *   src/chains/mock.ts    (offline demo / development)                  — owner: ui agent
 *
 * Product model (same on both chains): a market asks "is SYMBOL >= STRIKE at EXPIRY?".
 * "above" = buy YES, "below" = buy NO. One winning contract pays $1 of collateral (USDC-like, 6 decimals).
 * All money values in this interface are plain USD numbers (floats) for display; adapters convert internally.
 * Prices of contracts are probabilities in [0, 1] ($ per $1 contract).
 */

export type ChainId = 'base-sepolia' | 'arbitrum-sepolia' | 'hyperevm-testnet' | 'solana-devnet' | 'mock';

/** EVM chains share one contract stack and one adapter implementation (src/chains/evm.ts). */
export type EvmChainId = 'base-sepolia' | 'arbitrum-sepolia' | 'hyperevm-testnet';

/**
 * Canonical, chain-agnostic market key: the same (asset, strike, expiry) is the same economic event on every
 * chain (each chain settles it with its own oracle under the "first print at/after expiry" rule). The UI uses it
 * to compare venues and route a ticket to the best chain.
 */
export function canonicalMarketKey(symbol: string, strike: number, expiry: number): string {
  return `${symbol.toUpperCase()}:${strike}:${expiry}`;
}
export type Direction = 'above' | 'below';
export type Outcome = 'yes' | 'no';

export interface ChainMeta {
  id: ChainId;
  /** "Solana", "Base" */
  label: string;
  /** "Devnet", "Sepolia" */
  network: string;
  /** Collateral ticker shown in the UI, e.g. "tUSDC". */
  collateralSymbol: string;
  /** Native gas token, e.g. "SOL", "ETH". */
  nativeSymbol: string;
  /** Numeric EVM chain id (84532, 421614, 998) — undefined for Solana/mock. */
  evmChainId?: number;
  /** Oracle used for settlement, shown in the UI: "Pyth" | "Chainlink" | "HyperCore". */
  oracleName: string;
  /** One-line, honest description of how markets settle. */
  settlementNote: string;
  explorerTx(signature: string): string;
  explorerAddress(address: string): string;
}

export type AssetCategory = 'crypto' | 'stock' | 'etf' | 'commodity' | 'fx';

export interface AssetInfo {
  symbol: string;          // "SOL"
  name: string;            // "Solana"
  /** Asset class for grouping in the picker (default 'crypto'). */
  category?: AssetCategory;
  /** Human note on the price source when it is not a first-party oracle feed, e.g.
   *  "Keeper-reported (demo oracle) — US market hours". Shown next to the price. */
  oracleNote?: string;
  /** True while the underlying market is closed (equities outside US hours); quotes may be stale. */
  marketClosed?: boolean;
  /** Last oracle price in USD (0 if unknown yet). */
  price: number;
  /** Unix seconds of that price. */
  priceTime: number;
  /** Strike grid spacing in USD. */
  strikeStep: number;
  /** Annualised volatility used by the pricing model (0.8 = 80%). */
  vol: number;
}

export interface ExpiryOption {
  /** Unix seconds. */
  expiry: number;
  /** True if at least one market for this asset already exists at this expiry. */
  hasMarkets: boolean;
  /** Optional marker for the timeline ("Weekly", "Monthly", …). */
  tag?: string;
}

export interface BookLevel {
  /** Price of one YES contract in [0,1]. */
  price: number;
  /** Contracts available. */
  qty: number;
}

export interface MarketInfo {
  /** Chain-specific id (Solana market address / EVM seriesId). */
  id: string;
  symbol: string;
  strike: number;
  expiry: number;
  status: 'open' | 'resolved' | 'void';
  /** Set when resolved. */
  outcome?: Outcome;
  settlePrice?: number;
  /** YES order book (NO prices are 1 - YES prices). */
  bids: BookLevel[];
  asks: BookLevel[];
  lastPrice?: number;
  volume: number;
}

export interface Quote {
  outcome: Outcome;
  /** USD the user wants to put in (max loss). */
  budget: number;
  /** Contracts the budget buys right now (0 if no liquidity). */
  contracts: number;
  /** Average price per contract in [0,1]. */
  avgPrice: number;
  /** Worst price that will be accepted (limit), in [0,1]. */
  limitPrice: number;
  /** USD actually spent (<= budget). */
  cost: number;
  /** USD received if right (= contracts × $1). */
  payout: number;
  /** Model probability of this outcome (0..1) — "chance". */
  chance: number;
  /** true if the market does not exist yet and the trade will create it (Solana) or cannot be placed (Base). */
  needsMarket: boolean;
  /** true if the order can actually be submitted now. */
  tradable: boolean;
  /** Human reason when !tradable ("No liquidity at this strike yet", "Market closed", …). */
  reason?: string;
}

export interface BuyParams {
  symbol: string;
  strike: number;
  expiry: number;
  direction: Direction;
  /** USD to spend (max loss). */
  budget: number;
  /** Max acceptable avg price per contract in [0,1] (slippage guard). */
  maxPrice: number;
}

export interface TxResult {
  signature: string;
  explorerUrl: string;
}

export interface BuyResult extends TxResult {
  marketId: string;
  contracts: number;
  cost: number;
}

// ── Event markets ("Predictions"): yes/no questions about real-world events, resolved by an optimistic
//    resolver (bonded assertion + challenge window + arbitration). Same YES/NO $1 contracts and order book.

export type EventCategory = 'crypto' | 'macro' | 'politics' | 'sports' | 'tech' | 'culture' | 'other';

export interface EventInfo {
  /** Chain-specific market id (EVM seriesId / Solana market address). */
  id: string;
  /** Chain-agnostic key, identical across chains for the same question (e.g. "FED-CUT-2026-10-29"). */
  key: string;
  question: string;          // "Will the Fed cut rates at the Oct 28–29 FOMC meeting?"
  category: EventCategory;
  /** Exact resolution criteria + source, shown verbatim to the user. */
  rules: string;
  resolutionSource: string;  // URL
  /** Trading closes at this time (unix s); resolution happens after. */
  closeTime: number;
  status: 'open' | 'closed' | 'proposed' | 'disputed' | 'resolved' | 'void';
  outcome?: Outcome;
  /** Best YES prices in [0,1] (NO = 1 − YES). */
  bestBid?: number;
  bestAsk?: number;
  lastPrice?: number;
  volume: number;
  /** Optional illustration key for the UI (emoji or icon id). */
  icon?: string;
}

export interface EventQuote {
  outcome: Outcome;
  budget: number;
  contracts: number;
  avgPrice: number;
  limitPrice: number;
  cost: number;
  payout: number;
  tradable: boolean;
  reason?: string;
}

export interface Position {
  /** 'price' (default) or 'event'. For events, `symbol` holds the event key and `question` the text. */
  kind?: 'price' | 'event';
  question?: string;
  marketId: string;
  symbol: string;
  strike: number;
  expiry: number;
  outcome: Outcome;
  contracts: number;
  /** Current mark in [0,1] (best bid, else model). */
  mark: number;
  status: 'open' | 'resolved' | 'void';
  /** USD claimable now (resolved/void), else 0. */
  claimable: number;
  /** True if this position won (resolved). */
  won?: boolean;
}

export interface Balances {
  native: number;
  collateral: number;
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  /** Detected/installed in this browser. */
  installed: boolean;
}

export interface ChainAdapter {
  readonly meta: ChainMeta;

  // ── market data (no wallet needed) ──
  listAssets(): Promise<AssetInfo[]>;
  /** Live oracle prices; returns an unsubscribe function. */
  subscribePrices(onPrice: (symbol: string, price: number, time: number) => void): () => void;
  /** Strike grid around `spot` (ascending), e.g. 41 strikes. Base may restrict to strikes with markets. */
  strikes(symbol: string, spot: number): Promise<number[]>;
  /** Selectable expiries for an asset (ascending). */
  expiries(symbol: string): Promise<ExpiryOption[]>;
  getMarket(symbol: string, strike: number, expiry: number): Promise<MarketInfo | null>;
  quote(symbol: string, strike: number, expiry: number, direction: Direction, budget: number): Promise<Quote>;

  // ── wallet ──
  walletOptions(): WalletOption[];
  connect(walletId?: string): Promise<string>;
  disconnect(): Promise<void>;
  address(): string | null;
  onAccountChange(cb: (address: string | null) => void): () => void;
  balances(): Promise<Balances>;
  /** Test collateral faucet (and native-gas airdrop where the chain allows it). */
  faucet(): Promise<TxResult>;

  // ── trading ──
  buy(params: BuyParams): Promise<BuyResult>;
  positions(): Promise<Position[]>;
  /** Redeem a settled (resolved or void) position. */
  claim(marketId: string): Promise<TxResult>;
  /** Sell an open position back into the book (best bids), accepting at least `minPrice` per contract. */
  sell(marketId: string, outcome: Outcome, contracts: number, minPrice: number): Promise<TxResult>;

  // ── optional: order book inspection (all chains should implement) ──
  /** Full YES book + recent trades for a market (by chain-specific id). */
  getBook?(marketId: string): Promise<{ bids: BookLevel[]; asks: BookLevel[]; trades: { time: number; price: number; qty: number; takerBuy: boolean }[] }>;

  // ── optional: event markets ("Predictions") — implemented where the event resolver is deployed ──
  listEvents?(): Promise<EventInfo[]>;
  quoteEvent?(eventId: string, outcome: Outcome, budget: number): Promise<EventQuote>;
  buyEvent?(eventId: string, outcome: Outcome, budget: number, maxPrice: number): Promise<BuyResult>;
}
