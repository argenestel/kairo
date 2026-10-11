// LiteSVM harness for the Montions program: loads target/deploy/montions.so, builds instructions
// from the Anchor IDL, injects fake Pyth PriceUpdateV2 accounts, warps the clock and checks the
// vault / supply invariants of docs/SPEC.md §4 after every successful transaction.
import * as fs from "fs";
import * as path from "path";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import { expect } from "chai";

export const ROOT = path.resolve(__dirname, "..", "..");
export const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/montions.json"), "utf8"));
export const PROGRAM_ID = new PublicKey(IDL.address);
export const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

export const UNIT = 1_000_000n;
export const TICK_UNIT = 10_000n;
export const NIL = 255;
export const SIDE_BID = 0;
export const SIDE_ASK = 1;
export const TIF_GTC = 0;
export const TIF_IOC = 1;
export const TIF_POST_ONLY = 2;
export const STATUS_OPEN = 1;
export const STATUS_RESOLVED = 2;
export const STATUS_VOID = 3;
export const VOID_GRACE = 86_400;
export const E8 = 100_000_000n;

export const SOL_FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
export const BTC_FEED = Buffer.from("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", "hex");
export const SOL_PRICE_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

/// Error code (6000 + index) by name, from the IDL.
export const ERR: Record<string, number> = Object.fromEntries(IDL.errors.map((e: any) => [e.name, e.code]));

const PRICE_UPDATE_V2_DISC = Buffer.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);

export interface PythOpts {
  feedId?: Buffer;
  price: bigint;
  conf?: bigint;
  expo?: number;
  publishTime: number;
  prevPublishTime?: number;
  partial?: boolean;
}

/// PriceUpdateV2 bytes (134-byte allocation like the sponsored accounts).
export function pythData(o: PythOpts): Buffer {
  const b = Buffer.alloc(134);
  PRICE_UPDATE_V2_DISC.copy(b, 0);
  // write_authority: arbitrary
  Buffer.alloc(32, 7).copy(b, 8);
  let off = 40;
  if (o.partial) {
    b.writeUInt8(0, off++);
    b.writeUInt8(5, off++);
  } else {
    b.writeUInt8(1, off++);
  }
  (o.feedId ?? SOL_FEED).copy(b, off);
  off += 32;
  b.writeBigInt64LE(o.price, off);
  b.writeBigUInt64LE(o.conf ?? 1_000_000n, off + 8);
  b.writeInt32LE(o.expo ?? -8, off + 16);
  b.writeBigInt64LE(BigInt(o.publishTime), off + 20);
  b.writeBigInt64LE(BigInt(o.prevPublishTime ?? o.publishTime - 1), off + 28);
  b.writeBigInt64LE(o.price, off + 36); // ema_price
  b.writeBigUInt64LE(o.conf ?? 1_000_000n, off + 44); // ema_conf
  b.writeBigUInt64LE(1234n, off + 52); // posted_slot
  return b;
}

// ───────────────────────────── Market decoder (SPEC §3.1) ─────────────────────────────

export interface Seat {
  owner: PublicKey;
  cash: bigint;
  locked: bigint;
  yes: bigint;
  no: bigint;
  yesLocked: bigint;
  noLocked: bigint;
  openOrders: number;
}
export interface Order {
  idx: number;
  id: bigint;
  qty: bigint;
  ts: bigint;
  seat: number;
  side: number;
  tick: number;
  fromHeld: boolean;
  prev: number;
  next: number;
}
export interface MarketState {
  asset: PublicKey;
  feedId: Buffer;
  creator: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  strike: bigint;
  expiry: bigint;
  createdAt: bigint;
  settlePrice: bigint;
  settlePublishTime: bigint;
  pool: bigint;
  yesTotal: bigint;
  noTotal: bigint;
  fees: bigint;
  volume: bigint;
  nextOrderId: bigint;
  bidBits: [bigint, bigint];
  askBits: [bigint, bigint];
  status: number;
  outcome: number;
  bump: number;
  vaultBump: number;
  yesMintBump: number;
  noMintBump: number;
  lastTradeTick: number;
  tradeHead: number;
  tradeCount: number;
  freeHead: number;
  bidLevels: { head: number; tail: number }[];
  askLevels: { head: number; tail: number }[];
  orders: Order[];
  seats: Seat[];
  trades: { ts: bigint; qty: number; tick: number; takerIsBuyer: boolean }[];
}

export function decodeMarket(d: Buffer): MarketState {
  expect(d.length).to.eq(5184);
  const pk = (o: number) => new PublicKey(d.subarray(o, o + 32));
  const u64 = (o: number) => d.readBigUInt64LE(o);
  const i64 = (o: number) => d.readBigInt64LE(o);
  const levels = (base: number) =>
    Array.from({ length: 100 }, (_, t) => ({ head: d[base + 2 * t], tail: d[base + 2 * t + 1] }));
  const orders: Order[] = [];
  for (let i = 0; i < 64; i++) {
    const o = 768 + 32 * i;
    orders.push({
      idx: i,
      id: u64(o),
      qty: u64(o + 8),
      ts: i64(o + 16),
      seat: d[o + 24],
      side: d[o + 25],
      tick: d[o + 26],
      fromHeld: d[o + 27] === 1,
      prev: d[o + 28],
      next: d[o + 29],
    });
  }
  const seats: Seat[] = [];
  for (let i = 0; i < 24; i++) {
    const o = 2816 + 88 * i;
    seats.push({
      owner: pk(o),
      cash: u64(o + 32),
      locked: u64(o + 40),
      yes: u64(o + 48),
      no: u64(o + 56),
      yesLocked: u64(o + 64),
      noLocked: u64(o + 72),
      openOrders: d.readUInt32LE(o + 80),
    });
  }
  const trades = [];
  for (let i = 0; i < 16; i++) {
    const o = 4928 + 16 * i;
    trades.push({ ts: i64(o), qty: d.readUInt32LE(o + 8), tick: d[o + 12], takerIsBuyer: d[o + 13] === 1 });
  }
  return {
    asset: pk(8),
    feedId: Buffer.from(d.subarray(40, 72)),
    creator: pk(72),
    yesMint: pk(104),
    noMint: pk(136),
    vault: pk(168),
    strike: u64(200),
    expiry: i64(208),
    createdAt: i64(216),
    settlePrice: i64(224),
    settlePublishTime: i64(232),
    pool: u64(240),
    yesTotal: u64(248),
    noTotal: u64(256),
    fees: u64(264),
    volume: u64(272),
    nextOrderId: u64(280),
    bidBits: [u64(288), u64(296)],
    askBits: [u64(304), u64(312)],
    status: d[320],
    outcome: d[321],
    bump: d[322],
    vaultBump: d[323],
    yesMintBump: d[324],
    noMintBump: d[325],
    lastTradeTick: d[326],
    tradeHead: d[327],
    tradeCount: d.readUInt32LE(328),
    freeHead: d[332],
    bidLevels: levels(368),
    askLevels: levels(568),
    orders,
    seats,
    trades,
  };
}

/// Resting orders of one side, best price first, FIFO within a level.
export function bookSide(m: MarketState, side: number): Order[] {
  const lv = side === SIDE_BID ? m.bidLevels : m.askLevels;
  const ticks = [...Array(100).keys()].filter((t) => lv[t].head !== NIL);
  ticks.sort((a, b) => (side === SIDE_BID ? b - a : a - b));
  const out: Order[] = [];
  for (const t of ticks) {
    for (let i = lv[t].head; i !== NIL; i = m.orders[i].next) out.push(m.orders[i]);
  }
  return out;
}

export const ZERO = PublicKey.default;

export function seatOf(m: MarketState, owner: PublicKey): Seat | undefined {
  return m.seats.find((s) => s.owner.equals(owner));
}

export function feeOf(base: bigint, feeBps: number): bigint {
  return (base * BigInt(feeBps) + 9_999n) / 10_000n;
}

// ───────────────────────────── environment ─────────────────────────────

export interface MarketKeys {
  market: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  strike: bigint;
  expiry: number;
  asset: PublicKey;
}

export class TxError extends Error {
  constructor(public code: number | undefined, public logs: string[], msg: string) {
    super(msg);
  }
}

export interface SendOpts {
  cuLimit?: number;
  label?: string;
}

export class Env {
  svm: LiteSVM;
  program: Program<any>;
  admin: Keypair;
  markets: MarketKeys[] = [];
  cuLog: { label: string; cu: number }[] = [];
  feeBps = 50;

  // PDAs
  config: PublicKey;
  collateralMint: PublicKey;
  maker: PublicKey;
  treasury: PublicKey;

  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(PROGRAM_ID, path.join(ROOT, "target/deploy/montions.so"));
    this.admin = this.newUser(1000);
    const conn = new Connection("http://127.0.0.1:1"); // never used: we only build instructions
    const provider = new AnchorProvider(conn, new Wallet(this.admin), {});
    this.program = new Program(IDL, provider);
    this.config = this.pda([Buffer.from("config")]);
    this.collateralMint = this.pda([Buffer.from("collateral")]);
    this.maker = this.pda([Buffer.from("maker")]);
    this.treasury = this.pda([Buffer.from("treasury")]);
  }

  pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
  }
  assetPda(symbol: string): PublicKey {
    return this.pda([Buffer.from("asset"), Buffer.from(symbol)]);
  }
  marketKeys(asset: PublicKey, strike: bigint, expiry: number): MarketKeys {
    const s = Buffer.alloc(8);
    s.writeBigUInt64LE(strike);
    const e = Buffer.alloc(8);
    e.writeBigInt64LE(BigInt(expiry));
    const market = this.pda([Buffer.from("market"), asset.toBuffer(), s, e]);
    return {
      market,
      yesMint: this.pda([Buffer.from("yes"), market.toBuffer()]),
      noMint: this.pda([Buffer.from("no"), market.toBuffer()]),
      vault: this.pda([Buffer.from("vault"), market.toBuffer()]),
      strike,
      expiry,
      asset,
    };
  }

  newUser(sol = 100): Keypair {
    const k = Keypair.generate();
    this.svm.airdrop(k.publicKey, BigInt(sol * LAMPORTS_PER_SOL));
    return k;
  }

  // ── clock ──
  now(): number {
    return Number(this.svm.getClock().unixTimestamp);
  }
  setTime(t: number) {
    const c = this.svm.getClock();
    c.unixTimestamp = BigInt(t);
    c.slot = c.slot + 1n;
    this.svm.setClock(c);
  }

  // ── accounts ──
  data(k: PublicKey): Buffer | null {
    const a = this.svm.getAccount(k);
    return a ? Buffer.from(a.data) : null;
  }
  tokenBalance(k: PublicKey): bigint {
    const d = this.data(k);
    return d ? d.readBigUInt64LE(64) : 0n;
  }
  mintSupply(k: PublicKey): bigint {
    return this.data(k)!.readBigUInt64LE(36);
  }
  market(mk: MarketKeys | PublicKey): MarketState {
    const k = mk instanceof PublicKey ? mk : mk.market;
    return decodeMarket(this.data(k)!);
  }
  fetchConfig(): any {
    return this.program.coder.accounts.decode("config", this.data(this.config)!);
  }
  fetchAsset(k: PublicKey): any {
    return this.program.coder.accounts.decode("asset", this.data(k)!);
  }
  setPyth(addr: PublicKey, o: PythOpts, owner = PYTH_RECEIVER) {
    const data = pythData(o);
    this.svm.setAccount(addr, {
      lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data,
      owner,
      executable: false,
      rentEpoch: 0,
    });
  }
  ata(mint: PublicKey, owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, true);
  }

  // ── transactions ──
  send(ixs: TransactionInstruction[], signers: Keypair[], opts: SendOpts = {}): TransactionMetadata {
    const tx = new Transaction();
    if (opts.cuLimit) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cuLimit }));
    tx.add(...ixs);
    this.svm.expireBlockhash();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const res = this.svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      const err: any = res.err();
      let code: number | undefined;
      try {
        const inner = err.err?.();
        if (inner && typeof inner.code === "number") code = inner.code;
      } catch {}
      const logs = res.meta().logs();
      throw new TxError(code, logs, `tx failed: ${res.toString()}\n${logs.join("\n")}`);
    }
    if (opts.label) this.cuLog.push({ label: opts.label, cu: Number(res.computeUnitsConsumed()) });
    this.checkInvariants();
    return res;
  }

  /// Await instruction builders, then send.
  async exec(
    ixs: (TransactionInstruction | Promise<TransactionInstruction>)[],
    signers: Keypair[],
    opts: SendOpts = {}
  ): Promise<TransactionMetadata> {
    return this.send(await Promise.all(ixs), signers, opts);
  }

  /// Await builders, send, and require the named program error (or any failure if code is null).
  async fails(
    code: string | number | null,
    ixs: (TransactionInstruction | Promise<TransactionInstruction>)[],
    signers: Keypair[]
  ) {
    const built = await Promise.all(ixs);
    if (code === null) {
      try {
        this.send(built, signers);
      } catch (e) {
        if (e instanceof TxError) return;
        throw e;
      }
      throw new Error("expected failure, but the transaction succeeded");
    }
    this.expectErr(code, () => this.send(built, signers));
  }

  expectErr(code: string | number, fn: () => unknown) {
    const want = typeof code === "string" ? ERR[code] : code;
    expect(want, `unknown error ${code}`).to.not.be.undefined;
    try {
      fn();
    } catch (e: any) {
      if (!(e instanceof TxError)) throw e;
      if (e.code !== want) {
        throw new Error(`expected error ${code} (${want}) got ${e.code}\n${e.logs.join("\n")}`);
      }
      return;
    }
    throw new Error(`expected error ${code}, but the transaction succeeded`);
  }

  /// SPEC §4 invariants on every known market.
  checkInvariants() {
    for (const mk of this.markets) {
      const d = this.data(mk.market);
      if (!d) continue;
      const m = decodeMarket(d);
      let cash = 0n,
        locked = 0n,
        yes = 0n,
        no = 0n;
      for (const s of m.seats) {
        if (s.owner.equals(ZERO)) {
          expect(s.cash + s.locked + s.yes + s.no + s.yesLocked + s.noLocked).to.eq(0n, "free seat has balances");
          continue;
        }
        cash += s.cash;
        locked += s.locked;
        yes += s.yes + s.yesLocked;
        no += s.no + s.noLocked;
      }
      const vault = this.tokenBalance(mk.vault);
      expect(vault, "vault == Σcash + Σlocked + pool + fees").to.eq(cash + locked + m.pool + m.fees);
      expect(this.mintSupply(mk.yesMint) + yes, "YES supply + seats == yes_total").to.eq(m.yesTotal);
      expect(this.mintSupply(mk.noMint) + no, "NO supply + seats == no_total").to.eq(m.noTotal);
      if (m.status === STATUS_OPEN) {
        expect(m.pool).to.eq(m.yesTotal * UNIT);
        expect(m.pool).to.eq(m.noTotal * UNIT);
      } else if (m.status === STATUS_RESOLVED) {
        expect(m.pool).to.eq((m.outcome === 1 ? m.yesTotal : m.noTotal) * UNIT);
      } else if (m.status === STATUS_VOID) {
        expect(2n * m.pool).to.eq((m.yesTotal + m.noTotal) * UNIT);
      }
    }
  }

  // ── instruction builders ──
  ixInitialize(params: any): Promise<TransactionInstruction> {
    return this.program.methods
      .initialize(params)
      .accountsStrict({
        config: this.config,
        collateralMint: this.collateralMint,
        maker: this.maker,
        treasury: this.treasury,
        admin: this.admin.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  ixSetParams(update: any, admin = this.admin.publicKey) {
    const full = {
      feeBps: null,
      paused: null,
      faucetAmount: null,
      faucetCooldown: null,
      makerParams: null,
      newAdmin: null,
      ...update,
    };
    return this.program.methods.setParams(full).accountsStrict({ config: this.config, admin }).instruction();
  }
  ixAddAsset(args: any, priceAccount: PublicKey, admin = this.admin.publicKey) {
    return this.program.methods
      .addAsset(args)
      .accountsStrict({
        config: this.config,
        asset: this.assetPda(args.symbol),
        priceAccount,
        admin,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }
  ixSetAsset(asset: PublicKey, update: any, admin = this.admin.publicKey) {
    const full = { volBps: null, maxConfBps: null, active: null, settleWindow: null, strikeStep: null, ...update };
    return this.program.methods.setAsset(full).accountsStrict({ config: this.config, asset, admin }).instruction();
  }
  ixMintCollateral(dest: PublicKey, amount: bigint, admin = this.admin.publicKey) {
    return this.program.methods
      .mintCollateral(new BN(amount.toString()))
      .accountsStrict({
        config: this.config,
        collateralMint: this.collateralMint,
        destination: dest,
        admin,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  ixFaucet(user: PublicKey) {
    return this.program.methods
      .faucet()
      .accountsStrict({
        config: this.config,
        collateralMint: this.collateralMint,
        claim: this.pda([Buffer.from("faucet"), user.toBuffer()]),
        userCollateral: this.ata(this.collateralMint, user),
        user,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  ixCreateMarket(mk: MarketKeys, payer: PublicKey) {
    return this.program.methods
      .createMarket(new BN(mk.strike.toString()), new BN(mk.expiry))
      .accountsStrict({
        config: this.config,
        asset: mk.asset,
        market: mk.market,
        yesMint: mk.yesMint,
        noMint: mk.noMint,
        vault: mk.vault,
        collateralMint: this.collateralMint,
        payer,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  userMarketAccounts(mk: MarketKeys, user: PublicKey) {
    return {
      config: this.config,
      market: mk.market,
      user,
      userCollateral: this.ata(this.collateralMint, user),
      userYes: this.ata(mk.yesMint, user),
      userNo: this.ata(mk.noMint, user),
      vault: mk.vault,
      yesMint: mk.yesMint,
      noMint: mk.noMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }
  ixPlace(mk: MarketKeys, user: PublicKey, a: PlaceArgsTs) {
    return this.program.methods
      .placeOrder({
        side: a.side,
        tick: a.tick,
        qty: new BN(a.qty.toString()),
        tif: a.tif ?? TIF_IOC,
        fromHeld: a.fromHeld ?? false,
        maxFills: a.maxFills ?? 0,
        minFilled: new BN((a.minFilled ?? 0n).toString()),
      })
      .accountsStrict(this.userMarketAccounts(mk, user))
      .instruction();
  }
  ixCancel(mk: MarketKeys, user: PublicKey, orderId: bigint) {
    return this.program.methods
      .cancelOrder(new BN(orderId.toString()))
      .accountsStrict(this.userMarketAccounts(mk, user))
      .instruction();
  }
  ixWithdrawSeat(mk: MarketKeys, user: PublicKey) {
    return this.program.methods.withdrawSeat().accountsStrict(this.userMarketAccounts(mk, user)).instruction();
  }
  ixSplit(mk: MarketKeys, user: PublicKey, qty: bigint) {
    return this.program.methods
      .split(new BN(qty.toString()))
      .accountsStrict(this.userMarketAccounts(mk, user))
      .instruction();
  }
  ixMerge(mk: MarketKeys, user: PublicKey, qty: bigint) {
    return this.program.methods
      .merge(new BN(qty.toString()))
      .accountsStrict(this.userMarketAccounts(mk, user))
      .instruction();
  }
  ixRedeem(mk: MarketKeys, user: PublicKey, yes: bigint, no: bigint) {
    return this.program.methods
      .redeem(new BN(yes.toString()), new BN(no.toString()))
      .accountsStrict(this.userMarketAccounts(mk, user))
      .instruction();
  }
  ixResolve(mk: MarketKeys, priceUpdate: PublicKey) {
    return this.program.methods
      .resolve()
      .accountsStrict({ market: mk.market, asset: mk.asset, priceUpdate })
      .instruction();
  }
  ixVoid(mk: MarketKeys) {
    return this.program.methods.voidMarket().accountsStrict({ market: mk.market }).instruction();
  }
  ixRefresh(mk: MarketKeys, priceUpdate: PublicKey) {
    return this.program.methods
      .refreshQuotes()
      .accountsStrict({
        config: this.config,
        market: mk.market,
        asset: mk.asset,
        priceUpdate,
        maker: this.maker,
        treasury: this.treasury,
        vault: mk.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  ixSweep(mk: MarketKeys) {
    return this.program.methods
      .makerSweep()
      .accountsStrict({
        config: this.config,
        market: mk.market,
        maker: this.maker,
        treasury: this.treasury,
        vault: mk.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  ixWithdrawFees(mk: MarketKeys, dest: PublicKey, admin = this.admin.publicKey) {
    return this.program.methods
      .withdrawFees()
      .accountsStrict({
        config: this.config,
        market: mk.market,
        vault: mk.vault,
        destination: dest,
        admin,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
  ixAtas(mk: MarketKeys, user: PublicKey, payer = user): TransactionInstruction[] {
    return [this.collateralMint, mk.yesMint, mk.noMint].map((mint) =>
      createAssociatedTokenAccountIdempotentInstruction(payer, this.ata(mint, user), user, mint)
    );
  }

  // ── decoded return data ──
  placeResult(meta: TransactionMetadata): PlaceResultTs {
    const d = Buffer.from(meta.returnData().data());
    return {
      orderId: d.readBigUInt64LE(0),
      filled: d.readBigUInt64LE(8),
      resting: d.readBigUInt64LE(16),
      fee: d.readBigUInt64LE(24),
      cashOut: d.readBigUInt64LE(32),
      yesOut: d.readBigUInt64LE(40),
      noOut: d.readBigUInt64LE(48),
    };
  }
}

export interface PlaceArgsTs {
  side: number;
  tick: number;
  qty: bigint;
  tif?: number;
  fromHeld?: boolean;
  maxFills?: number;
  minFilled?: bigint;
}
export interface PlaceResultTs {
  orderId: bigint;
  filled: bigint;
  resting: bigint;
  fee: bigint;
  cashOut: bigint;
  yesOut: bigint;
  noOut: bigint;
}

// ───────────────────────────── standard fixture ─────────────────────────────

export const T0 = 1_800_000_000 - 3_600; // one hour before a grid-aligned expiry
export const EXPIRY = 1_800_000_000;
export const SPOT = 150n * E8; // $150
export const SOL_STRIKE_STEP = E8; // $1

export function makerParams(over: Partial<Record<string, any>> = {}) {
  return {
    enabled: true,
    levels: 2,
    levelSpacing: 2,
    minHalfSpread: 2,
    maxMarketExposure: new BN((200n * UNIT).toString()),
    levelNotional: new BN((20n * UNIT).toString()),
    minTte: new BN(60),
    maxPriceAge: new BN(60),
    ...over,
  };
}

export function solAssetArgs(over: Partial<Record<string, any>> = {}) {
  return {
    symbol: "SOL",
    feedId: [...SOL_FEED],
    strikeStep: new BN(SOL_STRIKE_STEP.toString()),
    volBps: 8500,
    maxConfBps: 200,
    settleWindow: new BN(60),
    ...over,
  };
}

/// Fresh env: initialized config (fee 50 bps), SOL asset on a fake sponsored feed at $150,
/// treasury funded with 10_000 tUSDC, clock at T0.
export async function bootstrap(opts: { feeBps?: number; treasury?: bigint; maker?: any } = {}): Promise<Env> {
  const env = new Env();
  env.feeBps = opts.feeBps ?? 50;
  env.setTime(T0);
  env.send(
    [
      await env.ixInitialize({
        feeBps: env.feeBps,
        faucetAmount: new BN((1_000n * UNIT).toString()),
        faucetCooldown: new BN(3_600),
        makerParams: opts.maker ?? makerParams(),
      }),
    ],
    [env.admin]
  );
  env.setPyth(SOL_PRICE_ACCOUNT, { price: SPOT, publishTime: T0 });
  env.send([await env.ixAddAsset(solAssetArgs(), SOL_PRICE_ACCOUNT)], [env.admin]);
  const fund = opts.treasury ?? 10_000n * UNIT;
  if (fund > 0n) env.send([await env.ixMintCollateral(env.treasury, fund)], [env.admin]);
  return env;
}

/// Create the SOL market (strike, expiry) and register it for invariant checks.
export async function createMarket(env: Env, strike = SPOT, expiry = EXPIRY, payer?: Keypair): Promise<MarketKeys> {
  const p = payer ?? env.admin;
  const mk = env.marketKeys(env.assetPda("SOL"), strike, expiry);
  env.markets.push(mk);
  env.send([await env.ixCreateMarket(mk, p.publicKey)], [p], { label: "create_market" });
  return mk;
}

/// New funded trader with ATAs for the market (faucet: 1000 tUSDC).
export async function trader(env: Env, mk?: MarketKeys): Promise<Keypair> {
  const u = env.newUser();
  const ixs: TransactionInstruction[] = [await env.ixFaucet(u.publicKey)];
  if (mk) ixs.push(...env.ixAtas(mk, u.publicKey));
  env.send(ixs, [u]);
  return u;
}

export async function refresh(env: Env, mk: MarketKeys, label?: string) {
  return env.send([await env.ixRefresh(mk, SOL_PRICE_ACCOUNT)], [env.admin], { label });
}

export function balances(env: Env, mk: MarketKeys, u: PublicKey) {
  return {
    cash: env.tokenBalance(env.ata(env.collateralMint, u)),
    yes: env.tokenBalance(env.ata(mk.yesMint, u)),
    no: env.tokenBalance(env.ata(mk.noMint, u)),
  };
}
