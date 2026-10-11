import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
  BN,
  IDL,
  MontionsClient,
  SIDE_BID,
  TIF_IOC,
  assetPda,
  ata,
  coder,
  collateralMintPda,
  configPda,
  decodePlaceResult,
  friendlyError,
  marketPda,
  noMintPda,
  parseMontionsError,
  returnDataFromLogs,
  vaultPda,
  yesMintPda,
} from '../src/index.js';

const client = new MontionsClient({ connection: new Connection('http://127.0.0.1:1') });
const ixDisc = (name: string) =>
  Buffer.from((IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }).instructions.find((i) => i.name === name)!.discriminator);

describe('instruction builders', () => {
  const user = Keypair.generate().publicKey;
  const asset = assetPda('SOL');
  const market = marketPda(asset, 11_000_000_000n, 1_791_734_400);

  it('place_order: accounts in IDL order and Borsh args', () => {
    const ix = client.ixPlaceOrder(user, market, { side: SIDE_BID, tick: 55, qty: 12n, tif: TIF_IOC, fromHeld: false, maxFills: 0, minFilled: 3n });
    expect(ix.programId.toBase58()).toBe('MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh');
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toEqual([
      configPda().toBase58(),
      market.toBase58(),
      user.toBase58(),
      ata(collateralMintPda(), user).toBase58(),
      ata(yesMintPda(market), user).toBase58(),
      ata(noMintPda(market), user).toBase58(),
      vaultPda(market).toBase58(),
      yesMintPda(market).toBase58(),
      noMintPda(market).toBase58(),
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ]);
    expect(ix.keys[1]!.isWritable).toBe(true);
    expect(ix.keys[2]!.isSigner).toBe(true);
    expect(ix.keys[0]!.isWritable).toBe(false);
    expect(ix.data.subarray(0, 8)).toEqual(ixDisc('place_order'));
    // side u8, tick u8, qty u64, tif u8, from_held bool, max_fills u8, min_filled u64
    const d = ix.data.subarray(8);
    expect(d.length).toBe(1 + 1 + 8 + 1 + 1 + 1 + 8);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(55);
    expect(d.readBigUInt64LE(2)).toBe(12n);
    expect(d[10]).toBe(1);
    expect(d[11]).toBe(0);
    expect(d[12]).toBe(0);
    expect(d.readBigUInt64LE(13)).toBe(3n);
  });

  it('create_market encodes strike u64 / expiry i64 and derives all PDAs', () => {
    const payer = Keypair.generate().publicKey;
    const ix = client.ixCreateMarket(payer, asset, 11_000_000_000n, 1_791_734_400);
    expect(ix.data.subarray(0, 8)).toEqual(ixDisc('create_market'));
    expect(ix.data.readBigUInt64LE(8)).toBe(11_000_000_000n);
    expect(ix.data.readBigInt64LE(16)).toBe(1_791_734_400n);
    const names = ['config', 'asset', 'market', 'yes_mint', 'no_mint', 'vault', 'collateral_mint', 'payer', 'system_program', 'token_program'];
    expect(ix.keys).toHaveLength(names.length);
    expect(ix.keys[2]!.pubkey.equals(market)).toBe(true);
    expect(ix.keys[7]!.pubkey.equals(payer)).toBe(true);
    expect(ix.keys[7]!.isSigner && ix.keys[7]!.isWritable).toBe(true);
    expect(ix.keys[8]!.pubkey.toBase58()).toBe('11111111111111111111111111111111');
  });

  it('initialize / add_asset / set_params encode', () => {
    const admin = Keypair.generate().publicKey;
    const init = client.ixInitialize(admin, {
      feeBps: 0,
      faucetAmount: 1_000_000_000n,
      faucetCooldown: 600,
      makerParams: { enabled: true, levels: 3, levelSpacing: 2, minHalfSpread: 2, maxMarketExposure: 1_500_000_000n, levelNotional: 50_000_000n, minTte: 600, maxPriceAge: 60 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dec: any = coder.instruction.decode(init.data);
    expect(dec.name).toBe('initialize');
    expect(dec.data.params.maker_params.level_notional.toString()).toBe('50000000');
    const add = client.ixAddAsset(admin, { symbol: 'SOL', feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', strikeStep: 100_000_000n, volBps: 8500, maxConfBps: 200, settleWindow: 60 }, new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = coder.instruction.decode(add.data);
    expect(a.data.args.symbol).toBe('SOL');
    expect(a.data.args.vol_bps).toBe(8500);
    expect(add.keys[1]!.pubkey.equals(assetPda('SOL'))).toBe(true);
    const sp = client.ixSetParams(admin, { paused: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = coder.instruction.decode(sp.data);
    expect(s.data.update.paused).toBe(true);
    expect(s.data.update.fee_bps).toBeNull();
  });

  it('user ATAs are idempotent creates for collateral / YES / NO', () => {
    const ixs = client.ixUserAtas(user, user, market);
    expect(ixs).toHaveLength(3);
    expect(ixs.every((i) => i.programId.toBase58() === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')).toBe(true);
    expect(ixs.map((i) => i.data[0])).toEqual([1, 1, 1]);
  });

  it('every IDL instruction can be built', () => {
    const k = Keypair.generate().publicKey;
    expect(() => client.ixFaucet(k)).not.toThrow();
    expect(() => client.ixRefreshQuotes(market, asset, k)).not.toThrow();
    expect(() => client.ixMakerSweep(market)).not.toThrow();
    expect(() => client.ixResolve(market, asset, k)).not.toThrow();
    expect(() => client.ixVoidMarket(market)).not.toThrow();
    expect(() => client.ixCancelOrder(k, market, 5n)).not.toThrow();
    expect(() => client.ixWithdrawSeat(k, market)).not.toThrow();
    expect(() => client.ixSplit(k, market, 1n)).not.toThrow();
    expect(() => client.ixMerge(k, market, 1n)).not.toThrow();
    expect(() => client.ixRedeem(k, market, 1n, 0n)).not.toThrow();
    expect(() => client.ixMintCollateral(k, k, 1n)).not.toThrow();
    expect(() => client.ixWithdrawFees(k, market, k)).not.toThrow();
    expect(() => client.ixSetAsset(k, 'SOL', { active: false })).not.toThrow();
  });
});

describe('return data + errors', () => {
  it('decodes PlaceResult', () => {
    const buf = coder.types.encode('PlaceResult', {
      order_id: new BN(0),
      filled: new BN(7),
      resting: new BN(0),
      fee: new BN(12),
      cash_out: new BN(300),
      yes_out: new BN(7),
      no_out: new BN(0),
    });
    const r = decodePlaceResult(buf.toString('base64'));
    expect(r).toEqual({ orderId: 0n, filled: 7n, resting: 0n, fee: 12n, cashOut: 300n, yesOut: 7n, noOut: 0n });
    const logs = [`Program MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh invoke [1]`, `Program return: MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh ${buf.toString('base64')}`];
    expect(returnDataFromLogs(logs)).toBe(buf.toString('base64'));
  });

  it('maps program errors', () => {
    expect(parseMontionsError({ logs: ['Program log: AnchorError occurred. Error Code: MinFillNotMet. Error Number: 6017. Error Message: filled quantity below min_filled.'] })?.name).toBe('MinFillNotMet');
    expect(parseMontionsError(new Error('failed: {"InstructionError":[3,{"Custom":6028}]}'))?.name).toBe('FaucetCooldown');
    expect(parseMontionsError('custom program error: 0x1770')?.name).toBe('BadTick');
    expect(friendlyError(new Error('Attempt to debit an account but found no record of a prior credit.'))).toMatch(/no SOL/);
    expect(friendlyError({ logs: ['Error Number: 6028.'] })).toBe('Faucet cooldown active');
  });
});
