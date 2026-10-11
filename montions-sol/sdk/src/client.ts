/**
 * MontionsClient: RPC reads (config, assets, markets, Pyth prices, positions), subscriptions, instruction
 * builders for every program instruction, and transaction builders (compute budget + idempotent ATAs).
 * Isomorphic (node + browser). Signing is the caller's job, except `sendAndConfirm` for node keypairs.
 */
import { BN, utils as anchorUtils } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type Commitment,
  type Connection,
  type GetProgramAccountsFilter,
  type Signer,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  DISCRIMINATORS,
  MARKET_ACCOUNT_SIZE,
  MARKET_HEADER_SIZE,
  MARKET_OFFSETS,
  PROGRAM_ID,
  PYTH_RECEIVER_ID,
  STATUS_OPEN,
  TICKS,
  VOID_GRACE,
} from "./constants.js";
import {
  coder,
  decodeAsset,
  decodeConfig,
  decodeFaucetClaim,
  decodeMarket,
  decodePythPrice,
  type AssetView,
  type ConfigView,
  type FaucetClaimView,
  type MakerParamsView,
  type MarketView,
  type PythPriceView,
} from "./decode.js";
import { isValidExpiry } from "./grid.js";
import { IDL } from "./idl/index.js";
import { estimateMakerLadder, ladderToBook } from "./model.js";
import { fairProbAboveE8, fairProbAboveWad } from "./pricing.js";
import {
  assetPda,
  ata,
  collateralMintPda,
  configPda,
  faucetClaimPda,
  makerPda,
  marketPda,
  noMintPda,
  treasuryPda,
  vaultPda,
  yesMintPda,
} from "./pdas.js";
import {
  quoteBuy,
  quoteSell,
  type BookLike,
  type BuyQuote,
  type OutcomeName,
  type PlaceArgsInput,
  type SellQuote,
} from "./quote.js";
import { redeemPayout } from "./payoff.js";

// ───────────────────────────── arg types ─────────────────────────────

export interface MakerParamsInput {
  enabled: boolean;
  levels: number;
  levelSpacing: number;
  minHalfSpread: number;
  maxMarketExposure: bigint;
  levelNotional: bigint;
  minTte: number;
  maxPriceAge: number;
}

export interface InitParamsInput {
  feeBps: number;
  faucetAmount: bigint;
  faucetCooldown: number;
  makerParams: MakerParamsInput;
}

export interface ParamsUpdateInput {
  feeBps?: number;
  paused?: boolean;
  faucetAmount?: bigint;
  faucetCooldown?: number;
  makerParams?: MakerParamsInput;
  newAdmin?: PublicKey;
}

export interface AddAssetInput {
  symbol: string;
  /** hex (with or without 0x) or 32 bytes */
  feedId: string | Uint8Array;
  /** 1e-8 USD */
  strikeStep: bigint;
  volBps: number;
  maxConfBps: number;
  settleWindow: number;
}

export interface AssetUpdateInput {
  volBps?: number;
  maxConfBps?: number;
  active?: boolean;
  settleWindow?: number;
  strikeStep?: bigint;
}

export interface PlaceResultView {
  orderId: bigint;
  filled: bigint;
  resting: bigint;
  fee: bigint;
  cashOut: bigint;
  yesOut: bigint;
  noOut: bigint;
}

export interface TxBuildOptions {
  /** Compute unit limit (setComputeUnitLimit is always prepended). */
  computeUnits?: number;
  /** Optional priority fee in micro-lamports per CU. */
  priorityMicroLamports?: number;
  /** Skip fetching a blockhash (caller sets it). */
  noBlockhash?: boolean;
}

export interface BuiltTx {
  tx: Transaction;
  instructions: TransactionInstruction[];
  blockhash?: string;
  lastValidBlockHeight?: number;
}

export interface BuyTxParams {
  owner: PublicKey;
  /** Asset symbol or a fetched AssetView. */
  asset: string | AssetView;
  /** 1e-8 USD */
  strike: bigint;
  expiry: number;
  outcome: OutcomeName;
  /** USD (number/string) or base units (bigint). Max loss under the default strict sizing. */
  budget: number | bigint | string;
  /** Worst acceptable outcome price per contract in [0,1] (limit). Default 0.99. */
  maxPrice?: number;
  /** Extra ticks of slippage on top of the walked worst level (default 0 on a live book, 2 on an estimated one). */
  slippageTicks?: number;
  /** min_filled as a fraction of the quoted contracts (default: 1 contract). */
  minFillRatio?: number;
  /** Prefetched state (avoids RPC round trips). `market: null` means "known not to exist". */
  config?: ConfigView;
  market?: MarketView | null;
  price?: PythPriceView;
  /** Override "now" (unix seconds). */
  now?: number;
  computeUnits?: number;
}

export interface BuyTxResult extends BuiltTx {
  market: PublicKey;
  quote: BuyQuote;
  /** create_market was prepended (and refresh_quotes). */
  needsMarket: boolean;
  /** refresh_quotes was prepended. */
  refreshed: boolean;
  /** The quote was computed from the model's estimated maker ladder, not a live book. */
  estimated: boolean;
  /** Model P(YES) used (when known). */
  fairProb: number | null;
}

export interface PositionView {
  market: MarketView;
  outcome: OutcomeName;
  /** SPL tokens in the owner's wallet. */
  wallet: bigint;
  /** Free tokens in the owner's seat (withdrawable). */
  seatFree: bigint;
  /** Tokens escrowed in the owner's resting from_held orders. */
  seatLocked: bigint;
  /** wallet + seatFree */
  contracts: bigint;
  /** Payout claimable now (resolved/void), base units. */
  claimable: bigint;
  won?: boolean;
}

export interface MontionsClientOptions {
  connection: Connection;
  programId?: PublicKey;
  commitment?: Commitment;
}

// ───────────────────────────── helpers ─────────────────────────────

type IdlIx = {
  name: string;
  accounts: {
    name: string;
    writable?: boolean;
    signer?: boolean;
    address?: string;
    optional?: boolean;
  }[];
};
const IDL_IXS = (IDL as unknown as { instructions: IdlIx[] }).instructions;

const bn = (v: bigint | number) => new BN(v.toString());
const opt = <T, U>(v: T | undefined, f: (x: T) => U): U | null =>
  v === undefined ? null : f(v);

function feedBytes(feed: string | Uint8Array): number[] {
  const b =
    typeof feed === "string"
      ? Buffer.from(feed.replace(/^0x/, ""), "hex")
      : Buffer.from(feed);
  if (b.length !== 32) throw new RangeError("feed id must be 32 bytes");
  return [...b];
}

function makerParamsRaw(m: MakerParamsInput) {
  return {
    enabled: m.enabled,
    levels: m.levels,
    level_spacing: m.levelSpacing,
    min_half_spread: m.minHalfSpread,
    max_market_exposure: bn(m.maxMarketExposure),
    level_notional: bn(m.levelNotional),
    min_tte: bn(m.minTte),
    max_price_age: bn(m.maxPriceAge),
  };
}

export function placeArgsRaw(a: PlaceArgsInput) {
  return {
    side: a.side,
    tick: a.tick,
    qty: bn(a.qty),
    tif: a.tif,
    from_held: a.fromHeld,
    max_fills: a.maxFills,
    min_filled: bn(a.minFilled),
  };
}

const big = (v: { toString(): string }) => BigInt(v.toString());

/** Decode `PlaceResult` Anchor return data (base64 or bytes). */
export function decodePlaceResult(data: string | Uint8Array): PlaceResultView {
  const buf =
    typeof data === "string" ? Buffer.from(data, "base64") : Buffer.from(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = coder.types.decode("PlaceResult", buf);
  return {
    orderId: big(r.order_id),
    filled: big(r.filled),
    resting: big(r.resting),
    fee: big(r.fee),
    cashOut: big(r.cash_out),
    yesOut: big(r.yes_out),
    noOut: big(r.no_out),
  };
}

/** Find the program's return data in transaction logs ("Program return: <id> <base64>"). */
export function returnDataFromLogs(
  logs: readonly string[] | null | undefined,
  programId = PROGRAM_ID
): string | null {
  if (!logs) return null;
  const prefix = `Program return: ${programId.toBase58()} `;
  for (let i = logs.length - 1; i >= 0; i--) {
    const l = logs[i]!;
    if (l.startsWith(prefix)) return l.slice(prefix.length).trim();
  }
  return null;
}

/** Raw SPL token account → { mint, owner, amount }. */
export function parseTokenAccount(data: Uint8Array): {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
} {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    mint: new PublicKey(data.subarray(0, 32)),
    owner: new PublicKey(data.subarray(32, 64)),
    amount: dv.getBigUint64(64, true),
  };
}

const chunk = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ───────────────────────────── client ─────────────────────────────

export class MontionsClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly commitment: Commitment;
  readonly config: PublicKey;
  readonly collateralMint: PublicKey;
  readonly maker: PublicKey;
  readonly treasury: PublicKey;

  constructor(opts: MontionsClientOptions) {
    this.connection = opts.connection;
    this.programId = opts.programId ?? PROGRAM_ID;
    this.commitment = opts.commitment ?? "confirmed";
    this.config = configPda(this.programId);
    this.collateralMint = collateralMintPda(this.programId);
    this.maker = makerPda(this.programId);
    this.treasury = treasuryPda(this.programId);
  }

  // ── generic instruction builder (account order + flags from the IDL) ──

  ix(
    name: string,
    accounts: Record<string, PublicKey>,
    args: Record<string, unknown> = {}
  ): TransactionInstruction {
    const def = IDL_IXS.find((i) => i.name === name);
    if (!def) throw new Error(`unknown instruction ${name}`);
    const keys = def.accounts.map((a) => {
      const pk =
        accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pk) throw new Error(`${name}: missing account ${a.name}`);
      return { pubkey: pk, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data: coder.instruction.encode(name, args),
    });
  }

  // ── PDAs bound to this program id ──

  assetAddress(symbol: string): PublicKey {
    return assetPda(symbol, this.programId);
  }

  marketAddress(asset: PublicKey, strike: bigint, expiry: number): PublicKey {
    return marketPda(asset, strike, expiry, this.programId);
  }

  // ── reads ──

  async isDeployed(): Promise<boolean> {
    const info = await this.connection.getAccountInfo(
      this.programId,
      this.commitment
    );
    return !!info?.executable;
  }

  async fetchConfig(): Promise<ConfigView | null> {
    const info = await this.connection.getAccountInfo(
      this.config,
      this.commitment
    );
    return info ? decodeConfig(info.data) : null;
  }

  async fetchFaucetClaim(user: PublicKey): Promise<FaucetClaimView | null> {
    const info = await this.connection.getAccountInfo(
      faucetClaimPda(user, this.programId),
      this.commitment
    );
    return info ? decodeFaucetClaim(info.data) : null;
  }

  private discFilter(disc: Uint8Array): GetProgramAccountsFilter {
    return {
      memcmp: {
        offset: 0,
        bytes: anchorUtils.bytes.bs58.encode(Buffer.from(disc)),
      },
    };
  }

  async fetchAssets(): Promise<AssetView[]> {
    const accs = await this.connection.getProgramAccounts(this.programId, {
      commitment: this.commitment,
      filters: [this.discFilter(DISCRIMINATORS.Asset)],
    });
    return accs
      .map(({ pubkey, account }) => decodeAsset(account.data, pubkey))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async fetchAsset(symbol: string): Promise<AssetView | null> {
    const addr = this.assetAddress(symbol);
    const info = await this.connection.getAccountInfo(addr, this.commitment);
    return info ? decodeAsset(info.data, addr) : null;
  }

  /**
   * All markets (optionally of one asset). `headersOnly` fetches only the first 368 bytes per market
   * (identity, status, totals — no book), which is ~14× less data.
   */
  async fetchMarkets(
    opts: { asset?: PublicKey; headersOnly?: boolean } = {}
  ): Promise<MarketView[]> {
    const filters: GetProgramAccountsFilter[] = [
      { dataSize: MARKET_ACCOUNT_SIZE },
      this.discFilter(DISCRIMINATORS.Market),
    ];
    if (opts.asset)
      filters.push({
        memcmp: { offset: MARKET_OFFSETS.asset, bytes: opts.asset.toBase58() },
      });
    const accs = await this.connection.getProgramAccounts(this.programId, {
      commitment: this.commitment,
      filters,
      ...(opts.headersOnly
        ? { dataSlice: { offset: 0, length: MARKET_HEADER_SIZE } }
        : {}),
    });
    return accs
      .map(({ pubkey, account }) => decodeMarket(account.data, pubkey))
      .sort(
        (a, b) =>
          a.expiry - b.expiry ||
          (a.strike < b.strike ? -1 : a.strike > b.strike ? 1 : 0)
      );
  }

  async fetchMarket(address: PublicKey): Promise<MarketView | null> {
    const info = await this.connection.getAccountInfo(address, this.commitment);
    if (!info || info.data.length < MARKET_ACCOUNT_SIZE) return null;
    return decodeMarket(info.data, address);
  }

  async fetchMarketFor(
    asset: PublicKey,
    strike: bigint,
    expiry: number
  ): Promise<MarketView | null> {
    return this.fetchMarket(this.marketAddress(asset, strike, expiry));
  }

  /** Batched getMultipleAccountsInfo (100 per call). */
  async fetchAccounts(
    addresses: readonly PublicKey[]
  ): Promise<(AccountInfo<Buffer> | null)[]> {
    const out: (AccountInfo<Buffer> | null)[] = [];
    for (const part of chunk(addresses, 100)) {
      out.push(
        ...(await this.connection.getMultipleAccountsInfo(
          part,
          this.commitment
        ))
      );
    }
    return out;
  }

  async fetchMarketsByAddress(
    addresses: readonly PublicKey[]
  ): Promise<(MarketView | null)[]> {
    const infos = await this.fetchAccounts(addresses);
    return infos.map((info, i) =>
      info && info.data.length >= MARKET_ACCOUNT_SIZE
        ? decodeMarket(info.data, addresses[i]!)
        : null
    );
  }

  async fetchPrice(priceAccount: PublicKey): Promise<PythPriceView | null> {
    const info = await this.connection.getAccountInfo(
      priceAccount,
      this.commitment
    );
    return info && info.owner.equals(PYTH_RECEIVER_ID)
      ? decodePythPrice(info.data)
      : null;
  }

  async fetchPrices(
    accounts: readonly PublicKey[]
  ): Promise<(PythPriceView | null)[]> {
    const infos = await this.fetchAccounts(accounts);
    return infos.map((info) => {
      if (!info || !info.owner.equals(PYTH_RECEIVER_ID)) return null;
      try {
        return decodePythPrice(info.data);
      } catch {
        return null;
      }
    });
  }

  async collateralBalance(owner: PublicKey): Promise<bigint> {
    const info = await this.connection.getAccountInfo(
      ata(this.collateralMint, owner),
      this.commitment
    );
    return info ? parseTokenAccount(info.data).amount : 0n;
  }

  /** Token balances (classic SPL Token program) of `owner`, keyed by mint base58. */
  async tokenBalances(owner: PublicKey): Promise<Map<string, bigint>> {
    const res = await this.connection.getTokenAccountsByOwner(
      owner,
      { programId: TOKEN_PROGRAM_ID },
      this.commitment
    );
    const out = new Map<string, bigint>();
    for (const { account } of res.value) {
      const t = parseTokenAccount(account.data);
      const k = t.mint.toBase58();
      out.set(k, (out.get(k) ?? 0n) + t.amount);
    }
    return out;
  }

  // ── subscriptions ──

  subscribeMarket(address: PublicKey, cb: (m: MarketView) => void): () => void {
    const id = this.connection.onAccountChange(
      address,
      (info) => {
        try {
          cb(decodeMarket(info.data, address));
        } catch {
          /* not a market (yet) */
        }
      },
      { commitment: this.commitment }
    );
    return () =>
      void this.connection.removeAccountChangeListener(id).catch(() => {});
  }

  subscribePrice(
    priceAccount: PublicKey,
    cb: (p: PythPriceView) => void
  ): () => void {
    const id = this.connection.onAccountChange(
      priceAccount,
      (info) => {
        try {
          cb(decodePythPrice(info.data));
        } catch {
          /* ignore */
        }
      },
      { commitment: this.commitment }
    );
    return () =>
      void this.connection.removeAccountChangeListener(id).catch(() => {});
  }

  // ── positions ──

  /**
   * Positions of `owner`: YES/NO SPL balances in the wallet (+ seat balances when full markets are passed or
   * `includeSeats`). Markets default to a header-only listing.
   */
  async positions(
    owner: PublicKey,
    opts: { markets?: MarketView[]; includeSeats?: boolean } = {}
  ): Promise<PositionView[]> {
    const [balances, markets] = await Promise.all([
      this.tokenBalances(owner),
      opts.markets
        ? Promise.resolve(opts.markets)
        : this.fetchMarkets({ headersOnly: !opts.includeSeats }),
    ]);
    const out: PositionView[] = [];
    for (const m of markets) {
      const seat = m.full
        ? m.seats.find((s) => s.owner.equals(owner))
        : undefined;
      for (const outcome of ["yes", "no"] as const) {
        const wallet =
          balances.get((outcome === "yes" ? m.yesMint : m.noMint).toBase58()) ??
          0n;
        const seatFree = seat ? (outcome === "yes" ? seat.yes : seat.no) : 0n;
        const seatLocked = seat
          ? outcome === "yes"
            ? seat.yesLocked
            : seat.noLocked
          : 0n;
        const contracts = wallet + seatFree;
        if (contracts === 0n && seatLocked === 0n) continue;
        let claimable = 0n;
        let won: boolean | undefined;
        if (m.statusName === "resolved") {
          won = (m.outcome === 1) === (outcome === "yes");
          claimable = won
            ? redeemPayout(
                "resolved",
                m.outcome === 1,
                outcome === "yes" ? contracts : 0n,
                outcome === "no" ? contracts : 0n
              )
            : 0n;
        } else if (m.statusName === "void") {
          claimable = redeemPayout("void", false, contracts, 0n);
        }
        out.push({
          market: m,
          outcome,
          wallet,
          seatFree,
          seatLocked,
          contracts,
          claimable,
          ...(won !== undefined ? { won } : {}),
        });
      }
    }
    return out;
  }

  // ── instruction builders ──

  ixInitialize(
    admin: PublicKey,
    params: InitParamsInput
  ): TransactionInstruction {
    return this.ix(
      "initialize",
      {
        config: this.config,
        collateral_mint: this.collateralMint,
        maker: this.maker,
        treasury: this.treasury,
        admin,
      },
      {
        params: {
          fee_bps: params.feeBps,
          faucet_amount: bn(params.faucetAmount),
          faucet_cooldown: bn(params.faucetCooldown),
          maker_params: makerParamsRaw(params.makerParams),
        },
      }
    );
  }

  ixSetParams(admin: PublicKey, u: ParamsUpdateInput): TransactionInstruction {
    return this.ix(
      "set_params",
      { config: this.config, admin },
      {
        update: {
          fee_bps: opt(u.feeBps, (x) => x),
          paused: opt(u.paused, (x) => x),
          faucet_amount: opt(u.faucetAmount, bn),
          faucet_cooldown: opt(u.faucetCooldown, bn),
          maker_params: opt(u.makerParams, makerParamsRaw),
          new_admin: opt(u.newAdmin, (x) => x),
        },
      }
    );
  }

  ixAddAsset(
    admin: PublicKey,
    a: AddAssetInput,
    priceAccount: PublicKey
  ): TransactionInstruction {
    return this.ix(
      "add_asset",
      {
        config: this.config,
        asset: this.assetAddress(a.symbol),
        price_account: priceAccount,
        admin,
      },
      {
        args: {
          symbol: a.symbol,
          feed_id: feedBytes(a.feedId),
          strike_step: bn(a.strikeStep),
          vol_bps: a.volBps,
          max_conf_bps: a.maxConfBps,
          settle_window: bn(a.settleWindow),
        },
      }
    );
  }

  ixSetAsset(
    admin: PublicKey,
    symbol: string,
    u: AssetUpdateInput
  ): TransactionInstruction {
    return this.ix(
      "set_asset",
      { config: this.config, asset: this.assetAddress(symbol), admin },
      {
        update: {
          vol_bps: opt(u.volBps, (x) => x),
          max_conf_bps: opt(u.maxConfBps, (x) => x),
          active: opt(u.active, (x) => x),
          settle_window: opt(u.settleWindow, bn),
          strike_step: opt(u.strikeStep, bn),
        },
      }
    );
  }

  ixMintCollateral(
    admin: PublicKey,
    destination: PublicKey,
    amount: bigint
  ): TransactionInstruction {
    return this.ix(
      "mint_collateral",
      {
        config: this.config,
        collateral_mint: this.collateralMint,
        destination,
        admin,
      },
      { amount: bn(amount) }
    );
  }

  ixWithdrawFees(
    admin: PublicKey,
    market: PublicKey,
    destination: PublicKey
  ): TransactionInstruction {
    return this.ix("withdraw_fees", {
      config: this.config,
      market,
      vault: vaultPda(market, this.programId),
      destination,
      admin,
    });
  }

  ixFaucet(user: PublicKey): TransactionInstruction {
    return this.ix("faucet", {
      config: this.config,
      collateral_mint: this.collateralMint,
      claim: faucetClaimPda(user, this.programId),
      user_collateral: ata(this.collateralMint, user),
      user,
    });
  }

  ixCreateMarket(
    payer: PublicKey,
    asset: PublicKey,
    strike: bigint,
    expiry: number
  ): TransactionInstruction {
    const market = this.marketAddress(asset, strike, expiry);
    return this.ix(
      "create_market",
      {
        config: this.config,
        asset,
        market,
        yes_mint: yesMintPda(market, this.programId),
        no_mint: noMintPda(market, this.programId),
        vault: vaultPda(market, this.programId),
        collateral_mint: this.collateralMint,
        payer,
      },
      { strike: bn(strike), expiry: bn(expiry) }
    );
  }

  ixRefreshQuotes(
    market: PublicKey,
    asset: PublicKey,
    priceUpdate: PublicKey
  ): TransactionInstruction {
    return this.ix("refresh_quotes", {
      config: this.config,
      market,
      asset,
      price_update: priceUpdate,
      maker: this.maker,
      treasury: this.treasury,
      vault: vaultPda(market, this.programId),
    });
  }

  ixMakerSweep(market: PublicKey): TransactionInstruction {
    return this.ix("maker_sweep", {
      config: this.config,
      market,
      maker: this.maker,
      treasury: this.treasury,
      vault: vaultPda(market, this.programId),
    });
  }

  ixResolve(
    market: PublicKey,
    asset: PublicKey,
    priceUpdate: PublicKey
  ): TransactionInstruction {
    return this.ix("resolve", { market, asset, price_update: priceUpdate });
  }

  ixVoidMarket(market: PublicKey): TransactionInstruction {
    return this.ix("void_market", { market });
  }

  /** Accounts of the shared `UserMarket` context. */
  userMarketAccounts(
    user: PublicKey,
    market: PublicKey
  ): Record<string, PublicKey> {
    const yesMint = yesMintPda(market, this.programId);
    const noMint = noMintPda(market, this.programId);
    return {
      config: this.config,
      market,
      user,
      user_collateral: ata(this.collateralMint, user),
      user_yes: ata(yesMint, user),
      user_no: ata(noMint, user),
      vault: vaultPda(market, this.programId),
      yes_mint: yesMint,
      no_mint: noMint,
    };
  }

  ixPlaceOrder(
    user: PublicKey,
    market: PublicKey,
    args: PlaceArgsInput
  ): TransactionInstruction {
    return this.ix("place_order", this.userMarketAccounts(user, market), {
      args: placeArgsRaw(args),
    });
  }

  ixCancelOrder(
    user: PublicKey,
    market: PublicKey,
    orderId: bigint
  ): TransactionInstruction {
    return this.ix("cancel_order", this.userMarketAccounts(user, market), {
      order_id: bn(orderId),
    });
  }

  ixWithdrawSeat(user: PublicKey, market: PublicKey): TransactionInstruction {
    return this.ix("withdraw_seat", this.userMarketAccounts(user, market));
  }

  ixSplit(
    user: PublicKey,
    market: PublicKey,
    qty: bigint
  ): TransactionInstruction {
    return this.ix("split", this.userMarketAccounts(user, market), {
      qty: bn(qty),
    });
  }

  ixMerge(
    user: PublicKey,
    market: PublicKey,
    qty: bigint
  ): TransactionInstruction {
    return this.ix("merge", this.userMarketAccounts(user, market), {
      qty: bn(qty),
    });
  }

  ixRedeem(
    user: PublicKey,
    market: PublicKey,
    yesQty: bigint,
    noQty: bigint
  ): TransactionInstruction {
    return this.ix("redeem", this.userMarketAccounts(user, market), {
      yes_qty: bn(yesQty),
      no_qty: bn(noQty),
    });
  }

  /** Idempotent ATA creation for the user's collateral, YES and NO accounts of `market` (payer pays rent). */
  ixUserAtas(
    payer: PublicKey,
    user: PublicKey,
    market: PublicKey
  ): TransactionInstruction[] {
    const mints = [
      this.collateralMint,
      yesMintPda(market, this.programId),
      noMintPda(market, this.programId),
    ];
    return mints.map((mint) =>
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata(mint, user),
        user,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // ── transaction builders ──

  async buildTx(
    ixs: TransactionInstruction[],
    feePayer: PublicKey,
    opts: TxBuildOptions = {}
  ): Promise<BuiltTx> {
    const pre: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: opts.computeUnits ?? 200_000,
      }),
    ];
    if (opts.priorityMicroLamports)
      pre.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: opts.priorityMicroLamports,
        })
      );
    const instructions = [...pre, ...ixs];
    const tx = new Transaction();
    tx.feePayer = feePayer;
    tx.add(...instructions);
    if (opts.noBlockhash) return { tx, instructions };
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash(this.commitment);
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    return { tx, instructions, blockhash, lastValidBlockHeight };
  }

  buildFaucetTx(user: PublicKey, opts: TxBuildOptions = {}) {
    return this.buildTx([this.ixFaucet(user)], user, {
      computeUnits: 120_000,
      ...opts,
    });
  }

  buildCreateMarketTx(
    payer: PublicKey,
    asset: PublicKey,
    strike: bigint,
    expiry: number,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [this.ixCreateMarket(payer, asset, strike, expiry)],
      payer,
      { computeUnits: 200_000, ...opts }
    );
  }

  buildRefreshQuotesTx(
    payer: PublicKey,
    market: PublicKey,
    asset: PublicKey,
    priceUpdate: PublicKey,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [this.ixRefreshQuotes(market, asset, priceUpdate)],
      payer,
      { computeUnits: 600_000, ...opts }
    );
  }

  buildPlaceOrderTx(
    user: PublicKey,
    market: PublicKey,
    args: PlaceArgsInput,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [
        ...this.ixUserAtas(user, user, market),
        this.ixPlaceOrder(user, market, args),
      ],
      user,
      {
        computeUnits: 400_000,
        ...opts,
      }
    );
  }

  buildCancelTx(
    user: PublicKey,
    market: PublicKey,
    orderId: bigint,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [
        ...this.ixUserAtas(user, user, market),
        this.ixCancelOrder(user, market, orderId),
      ],
      user,
      {
        computeUnits: 200_000,
        ...opts,
      }
    );
  }

  buildWithdrawSeatTx(
    user: PublicKey,
    market: PublicKey,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [
        ...this.ixUserAtas(user, user, market),
        this.ixWithdrawSeat(user, market),
      ],
      user,
      {
        computeUnits: 200_000,
        ...opts,
      }
    );
  }

  buildSplitTx(
    user: PublicKey,
    market: PublicKey,
    qty: bigint,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [...this.ixUserAtas(user, user, market), this.ixSplit(user, market, qty)],
      user,
      { computeUnits: 200_000, ...opts }
    );
  }

  buildMergeTx(
    user: PublicKey,
    market: PublicKey,
    qty: bigint,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [...this.ixUserAtas(user, user, market), this.ixMerge(user, market, qty)],
      user,
      { computeUnits: 200_000, ...opts }
    );
  }

  buildRedeemTx(
    user: PublicKey,
    market: PublicKey,
    yesQty: bigint,
    noQty: bigint,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx(
      [
        ...this.ixUserAtas(user, user, market),
        this.ixRedeem(user, market, yesQty, noQty),
      ],
      user,
      {
        computeUnits: 200_000,
        ...opts,
      }
    );
  }

  buildResolveTx(
    payer: PublicKey,
    market: PublicKey,
    asset: PublicKey,
    priceUpdate: PublicKey,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx([this.ixResolve(market, asset, priceUpdate)], payer, {
      computeUnits: 100_000,
      ...opts,
    });
  }

  buildVoidTx(payer: PublicKey, market: PublicKey, opts: TxBuildOptions = {}) {
    return this.buildTx([this.ixVoidMarket(market)], payer, {
      computeUnits: 60_000,
      ...opts,
    });
  }

  buildMakerSweepTx(
    payer: PublicKey,
    market: PublicKey,
    opts: TxBuildOptions = {}
  ) {
    return this.buildTx([this.ixMakerSweep(market)], payer, {
      computeUnits: 300_000,
      ...opts,
    });
  }

  // ── high-level: quote + buy / sell / claim ──

  /** Estimated book the protocol maker would post on a fresh market (model fair value ± spread). */
  estimatedBook(
    asset: AssetView,
    strike: bigint,
    expiry: number,
    price: PythPriceView,
    params: MakerParamsView,
    now: number
  ): { book: BookLike; fair: number; fairTick: number } {
    const tte = expiry - now;
    const fairWad = fairProbAboveWad(price.priceE8, strike, asset.volBps, tte);
    const fair = Number(fairWad) / 1e18;
    const lad = estimateMakerLadder({
      fair,
      fairWad,
      tteSecs: tte,
      params,
      cashAvailable: params.maxMarketExposure,
    });
    return { book: ladderToBook(lad.quotes), fair, fairTick: lad.fairTick };
  }

  /**
   * Quote a buy without building a transaction. If the market does not exist (or the side is empty and the
   * maker is on), the quote comes from the estimated maker ladder (`estimated: true`).
   */
  async quoteBuyMarket(p: Omit<BuyTxParams, "owner">): Promise<{
    quote: BuyQuote;
    market: PublicKey;
    marketView: MarketView | null;
    needsMarket: boolean;
    refresh: boolean;
    estimated: boolean;
    fairProb: number | null;
    asset: AssetView;
    config: ConfigView;
  }> {
    const config = p.config ?? (await this.fetchConfig());
    if (!config)
      throw new Error(
        "Montions is not initialised on this cluster (config account missing)"
      );
    const asset =
      typeof p.asset === "string" ? await this.fetchAsset(p.asset) : p.asset;
    if (!asset || !asset.address)
      throw new Error(`asset ${String(p.asset)} is not listed`);
    const now = p.now ?? Math.floor(Date.now() / 1000);
    const marketAddr = this.marketAddress(asset.address, p.strike, p.expiry);
    const marketView =
      p.market !== undefined ? p.market : await this.fetchMarket(marketAddr);
    const maxTick = Math.max(
      1,
      Math.min(99, Math.floor((p.maxPrice ?? 0.99) * TICKS + 1e-9))
    );
    const needsMarket = !marketView;
    if (
      marketView &&
      (marketView.statusName !== "open" || now >= marketView.expiry)
    ) {
      throw new Error("Market is closed for trading");
    }
    if (needsMarket) {
      if (config.paused) throw new Error("Protocol is paused for new markets");
      if (!asset.active) throw new Error(`${asset.symbol} is not active`);
      if (p.strike <= 0n || p.strike % asset.strikeStep !== 0n)
        throw new Error("Strike is not on the asset grid");
      if (!isValidExpiry(p.expiry, now))
        throw new Error(
          "Expiry must be on the 5-minute grid, 2 min – 90 days ahead"
        );
    }
    const outcomeSideEmpty =
      !!marketView &&
      (p.outcome === "yes"
        ? marketView.asks.length === 0
        : marketView.bids.length === 0);
    const makerCanQuote =
      config.makerParams.enabled &&
      !config.paused &&
      p.expiry - now >= config.makerParams.minTte;
    const refresh = makerCanQuote && (needsMarket || outcomeSideEmpty);
    let book: BookLike | null = marketView;
    let estimated = false;
    let fairProb: number | null = null;
    const price = p.price ?? (await this.fetchPrice(asset.priceAccount));
    if (price)
      fairProb = fairProbAboveE8(
        price.priceE8,
        p.strike,
        asset.volBps,
        p.expiry - now
      );
    if (refresh && !price)
      throw new Error("Oracle price account is unavailable");
    if (refresh && price) {
      if (price.verification !== "full" || price.feedId !== asset.feedId)
        throw new Error("Oracle verification/feed mismatch");
      if (
        price.priceE8 <= 0n ||
        price.conf * 10_000n > BigInt(asset.maxConfBps) * price.price
      )
        throw new Error("Oracle price is too uncertain");
      if (
        now - price.publishTime > config.makerParams.maxPriceAge ||
        price.publishTime > now + 5
      )
        throw new Error("Oracle price is stale or in the future");
      if (marketView && !marketView.full)
        throw new Error("Full market data is required to estimate a refresh");
      const treasury = await this.connection.getAccountInfo(
        config.treasury,
        this.commitment
      );
      const available = treasury ? parseTokenAccount(treasury.data).amount : 0n;
      const seat = marketView?.seats.find((s) => s.owner.equals(config.maker));
      const seatCash = (seat?.cash ?? 0n) + (seat?.locked ?? 0n);
      const headroom =
        config.makerParams.maxMarketExposure > seatCash
          ? config.makerParams.maxMarketExposure - seatCash
          : 0n;
      const fairWad = fairProbAboveWad(
        price.priceE8,
        p.strike,
        asset.volBps,
        p.expiry - now
      );
      const lad = estimateMakerLadder({
        fair: Number(fairWad) / 1e18,
        fairWad,
        tteSecs: p.expiry - now,
        params: config.makerParams,
        cashAvailable: available < headroom ? available : headroom,
        seatCash,
        seatYes: (seat?.yes ?? 0n) + (seat?.yesLocked ?? 0n),
        seatNo: (seat?.no ?? 0n) + (seat?.noLocked ?? 0n),
      });
      // refresh cancels the protocol maker's old orders; other makers remain.
      const others =
        marketView?.orders.filter((o) => !o.owner?.equals(config.maker)) ?? [];
      const bestBid = Math.max(
        0,
        ...others.filter((o) => o.side === 0).map((o) => o.tick)
      );
      const bestAsk = Math.min(
        100,
        ...others.filter((o) => o.side === 1).map((o) => o.tick)
      );
      const posted = lad.quotes.filter((q) =>
        q.side === 0 ? q.tick < bestAsk : q.tick > bestBid
      );
      const est = ladderToBook(posted);
      book = {
        bids: [...others.filter((o) => o.side === 0), ...est.bids],
        asks: [...others.filter((o) => o.side === 1), ...est.asks],
      };
      estimated = true;
    }
    const quote = quoteBuy(
      book ?? { bids: [], asks: [] },
      p.outcome,
      p.budget,
      {
        feeBps: config.feeBps,
        maxTick,
        slippageTicks: p.slippageTicks ?? (estimated ? 2 : 0),
        ...(p.minFillRatio !== undefined
          ? { minFillRatio: p.minFillRatio }
          : {}),
      }
    );
    return {
      quote,
      market: marketAddr,
      marketView,
      needsMarket,
      refresh,
      estimated,
      fairProb,
      asset,
      config,
    };
  }

  /**
   * Build a buy (Above = YES, Below = NO) as one transaction:
   * [CU limit] [create_market + refresh_quotes if the market doesn't exist] [refresh_quotes if the side is empty]
   * [ATAs collateral/YES/NO] [place_order IOC with min_filled].
   */
  async buildBuyTx(p: BuyTxParams): Promise<BuyTxResult> {
    const q = await this.quoteBuyMarket(p);
    if (q.quote.contracts === 0n) {
      throw new Error(
        q.quote.liquidity === 0n
          ? "No liquidity at this strike/expiry within your max price"
          : "Budget too small for one contract at the current price"
      );
    }
    const assetAddr = q.asset.address!;
    const ixs: TransactionInstruction[] = [];
    if (q.needsMarket)
      ixs.push(this.ixCreateMarket(p.owner, assetAddr, p.strike, p.expiry));
    if (q.refresh)
      ixs.push(this.ixRefreshQuotes(q.market, assetAddr, q.asset.priceAccount));
    ixs.push(...this.ixUserAtas(p.owner, p.owner, q.market));
    ixs.push(this.ixPlaceOrder(p.owner, q.market, q.quote.args));
    const cu =
      p.computeUnits ??
      (q.needsMarket ? 1_000_000 : q.refresh ? 800_000 : 400_000);
    const built = await this.buildTx(ixs, p.owner, { computeUnits: cu });
    return {
      ...built,
      market: q.market,
      quote: q.quote,
      needsMarket: q.needsMarket,
      refreshed: q.refresh,
      estimated: q.estimated,
      fairProb: q.fairProb,
    };
  }

  /** Sell held YES/NO back into the book (IOC, from_held) with a minimum outcome price. */
  async buildSellTx(p: {
    owner: PublicKey;
    market: PublicKey | MarketView;
    outcome: OutcomeName;
    contracts: bigint;
    /** Lowest acceptable outcome price per contract in [0,1]. */
    minPrice: number;
    config?: ConfigView;
  }): Promise<BuiltTx & { quote: SellQuote; market: PublicKey }> {
    const view =
      p.market instanceof PublicKey
        ? await this.fetchMarket(p.market)
        : p.market;
    if (!view || !view.address) throw new Error("Market not found");
    if (
      view.statusName !== "open" ||
      Math.floor(Date.now() / 1000) >= view.expiry
    )
      throw new Error("Market is closed for trading");
    const config = p.config ?? (await this.fetchConfig());
    const minTick = Math.max(
      1,
      Math.min(99, Math.ceil(p.minPrice * TICKS - 1e-9))
    );
    const quote = quoteSell(view, p.outcome, p.contracts, {
      feeBps: config?.feeBps ?? 0,
      minTick,
    });
    if (quote.contracts === 0n)
      throw new Error("No bids at or above your minimum price");
    const args: PlaceArgsInput = { ...quote.args, qty: p.contracts };
    const built = await this.buildTx(
      [
        ...this.ixUserAtas(p.owner, p.owner, view.address),
        this.ixPlaceOrder(p.owner, view.address, args),
      ],
      p.owner,
      { computeUnits: 400_000 }
    );
    return { ...built, quote, market: view.address };
  }

  /**
   * Claim a settled position: withdraw seat balances (if any), then redeem wallet YES/NO. If the market is past
   * expiry but unresolved, prepends `resolve` (works only inside the settle window: the sponsored Pyth account
   * must hold a print at/after expiry) or `void_market` after the 24 h grace.
   */
  async buildClaimTx(p: {
    owner: PublicKey;
    market: PublicKey | MarketView;
    now?: number;
  }): Promise<
    BuiltTx & {
      market: PublicKey;
      yesQty: bigint;
      noQty: bigint;
      settles: "resolve" | "void" | null;
    }
  > {
    const view =
      p.market instanceof PublicKey
        ? await this.fetchMarket(p.market)
        : p.market;
    if (!view || !view.address) throw new Error("Market not found");
    const now = p.now ?? Math.floor(Date.now() / 1000);
    const ixs: TransactionInstruction[] = [];
    let settles: "resolve" | "void" | null = null;
    if (view.status === STATUS_OPEN) {
      if (now <= view.expiry) throw new Error("Market has not expired yet");
      if (now >= view.expiry + VOID_GRACE) {
        ixs.push(this.ixVoidMarket(view.address));
        settles = "void";
      } else {
        const asset = await this.connection.getAccountInfo(
          view.asset,
          this.commitment
        );
        if (!asset) throw new Error("Asset account missing");
        const a = decodeAsset(asset.data, view.asset);
        const price = await this.fetchPrice(a.priceAccount);
        if (!price || price.publishTime < view.expiry)
          throw new Error("Waiting for the first oracle price after expiry");
        const firstPrint = price.prevPublishTime < view.expiry;
        if (!firstPrint && price.publishTime > view.expiry + a.settleWindow) {
          throw new Error(
            "Settlement pending: the keeper resolves markets right after expiry (or anyone can void after 24 h)"
          );
        }
        ixs.push(this.ixResolve(view.address, view.asset, a.priceAccount));
        settles = "resolve";
      }
    }
    const balances = await this.tokenBalances(p.owner);
    const yesQty = balances.get(view.yesMint.toBase58()) ?? 0n;
    const noQty = balances.get(view.noMint.toBase58()) ?? 0n;
    const seat = view.full
      ? view.seats.find((s) => s.owner.equals(p.owner))
      : undefined;
    const seatYes = seat?.yes ?? 0n;
    const seatNo = seat?.no ?? 0n;
    ixs.push(...this.ixUserAtas(p.owner, p.owner, view.address));
    if (seat && (seat.cash > 0n || seatYes > 0n || seatNo > 0n))
      ixs.push(this.ixWithdrawSeat(p.owner, view.address));
    const totalYes = yesQty + seatYes;
    const totalNo = noQty + seatNo;
    if (totalYes === 0n && totalNo === 0n && !seat)
      throw new Error("Nothing to claim in this market");
    if (totalYes > 0n || totalNo > 0n)
      ixs.push(this.ixRedeem(p.owner, view.address, totalYes, totalNo));
    const built = await this.buildTx(ixs, p.owner, { computeUnits: 300_000 });
    return {
      ...built,
      market: view.address,
      yesQty: totalYes,
      noQty: totalNo,
      settles,
    };
  }

  // ── sending (node / keypair signers) ──

  /**
   * Sign with `signers` (first = fee payer), send, re-broadcast every 2 s until confirmed or the blockhash
   * expires. Throws with logs on failure. Returns the signature.
   */
  async sendAndConfirm(
    built: BuiltTx | Transaction,
    signers: Signer[],
    opts: { skipPreflight?: boolean; refreshBlockhash?: boolean } = {}
  ): Promise<string> {
    const tx = built instanceof Transaction ? built : built.tx;
    if (!tx.recentBlockhash || opts.refreshBlockhash) {
      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash(this.commitment);
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
    }
    if (!tx.feePayer) tx.feePayer = signers[0]!.publicKey;
    tx.sign(...signers);
    const raw = tx.serialize();
    const sig = await this.connection.sendRawTransaction(raw, {
      skipPreflight: opts.skipPreflight ?? false,
      preflightCommitment: this.commitment,
      maxRetries: 0,
    });
    const lvh =
      tx.lastValidBlockHeight ??
      (await this.connection.getBlockHeight(this.commitment)) + 150;
    let done = false;
    const resend = (async () => {
      while (!done) {
        await new Promise((r) => setTimeout(r, 2000));
        if (done) break;
        try {
          await this.connection.sendRawTransaction(raw, {
            skipPreflight: true,
            maxRetries: 0,
          });
        } catch {
          /* ignore */
        }
      }
    })();
    try {
      const res = await this.connection.confirmTransaction(
        {
          signature: sig,
          blockhash: tx.recentBlockhash!,
          lastValidBlockHeight: lvh,
        },
        this.commitment
      );
      if (res.value.err) {
        const t = await this.connection
          .getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          })
          .catch(() => null);
        const err = new Error(
          `transaction ${sig} failed: ${JSON.stringify(res.value.err)}`
        ) as Error & { logs?: string[] };
        err.logs = t?.meta?.logMessages ?? [];
        throw err;
      }
      return sig;
    } finally {
      done = true;
      await resend.catch(() => {});
    }
  }

  /** PlaceResult of a confirmed place_order transaction (from return data), if available. */
  async fetchPlaceResult(signature: string): Promise<PlaceResultView | null> {
    for (let i = 0; i < 5; i++) {
      const t = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (t) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rd = (t.meta as any)?.returnData as
          | { programId: string; data: [string, string] }
          | undefined;
        if (rd && rd.programId === this.programId.toBase58() && rd.data?.[0])
          return decodePlaceResult(rd.data[0]);
        const fromLogs = returnDataFromLogs(
          t.meta?.logMessages,
          this.programId
        );
        return fromLogs ? decodePlaceResult(fromLogs) : null;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return null;
  }
}

/** Base58 codec (signatures returned as bytes by wallets). */
export const bs58: {
  encode(b: Uint8Array | number[]): string;
  decode(s: string): Uint8Array;
} = anchorUtils.bytes.bs58;

/** SystemProgram id re-export for callers building custom transactions. */
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
