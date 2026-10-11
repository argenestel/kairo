import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
  IDL,
  PROGRAM_ID,
  assetPda,
  collateralMintPda,
  configPda,
  faucetClaimPda,
  makerPda,
  marketAddresses,
  marketPda,
  noMintPda,
  treasuryPda,
  vaultPda,
  yesMintPda,
} from '../src/index.js';

const find = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

describe('PDAs', () => {
  it('program id matches the IDL', () => {
    expect(PROGRAM_ID.toBase58()).toBe((IDL as unknown as { address: string }).address);
  });

  it('global PDAs', () => {
    expect(configPda().equals(find([Buffer.from('config')]))).toBe(true);
    expect(collateralMintPda().equals(find([Buffer.from('collateral')]))).toBe(true);
    expect(makerPda().equals(find([Buffer.from('maker')]))).toBe(true);
    expect(treasuryPda().equals(find([Buffer.from('treasury')]))).toBe(true);
  });

  it('IDL const seeds agree (config / collateral / treasury in initialize)', () => {
    const ix = (IDL as unknown as { instructions: { name: string; accounts: { name: string; pda?: { seeds: { kind: string; value?: number[] }[] } }[] }[] }).instructions.find(
      (i) => i.name === 'initialize',
    )!;
    const seedOf = (n: string) => Buffer.from(ix.accounts.find((a) => a.name === n)!.pda!.seeds[0]!.value!).toString();
    expect(seedOf('config')).toBe('config');
    expect(seedOf('collateral_mint')).toBe('collateral');
    expect(seedOf('treasury')).toBe('treasury');
    expect(seedOf('maker')).toBe('maker');
  });

  it('asset / market / mints / vault / faucet', () => {
    const asset = assetPda('SOL');
    expect(asset.equals(find([Buffer.from('asset'), Buffer.from('SOL')]))).toBe(true);
    const strike = 11_000_000_000n;
    const expiry = 1_791_734_400;
    const s = Buffer.alloc(8);
    s.writeBigUInt64LE(strike);
    const e = Buffer.alloc(8);
    e.writeBigInt64LE(BigInt(expiry));
    const market = marketPda(asset, strike, expiry);
    expect(market.equals(find([Buffer.from('market'), asset.toBuffer(), s, e]))).toBe(true);
    expect(yesMintPda(market).equals(find([Buffer.from('yes'), market.toBuffer()]))).toBe(true);
    expect(noMintPda(market).equals(find([Buffer.from('no'), market.toBuffer()]))).toBe(true);
    expect(vaultPda(market).equals(find([Buffer.from('vault'), market.toBuffer()]))).toBe(true);
    const all = marketAddresses(asset, strike, expiry);
    expect(all.market.equals(market)).toBe(true);
    expect(all.yesMint.equals(yesMintPda(market))).toBe(true);
    const user = new PublicKey('11111111111111111111111111111112');
    expect(faucetClaimPda(user).equals(find([Buffer.from('faucet'), user.toBuffer()]))).toBe(true);
    // different strike / expiry → different market
    expect(marketPda(asset, strike + 100_000_000n, expiry).equals(market)).toBe(false);
    expect(marketPda(asset, strike, expiry + 300).equals(market)).toBe(false);
  });
});
