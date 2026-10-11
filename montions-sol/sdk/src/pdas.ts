/** Program-derived addresses (docs/SPEC.md §3). All helpers return the address only; `*WithBump` also the bump. */
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Buffer } from 'buffer';
import {
  PROGRAM_ID,
  PYTH_PUSH_ORACLE_ID,
  SEED_ASSET,
  SEED_COLLATERAL,
  SEED_CONFIG,
  SEED_FAUCET,
  SEED_MAKER,
  SEED_MARKET,
  SEED_NO,
  SEED_TREASURY,
  SEED_VAULT,
  SEED_YES,
} from './constants.js';

export type Pda = [PublicKey, number];

const enc = (s: string) => Buffer.from(s, 'utf8');

export function u64Le(v: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

export function i64Le(v: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
}

export function toPubkey(k: PublicKey | string): PublicKey {
  return typeof k === 'string' ? new PublicKey(k) : k;
}

export function configPdaWithBump(programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_CONFIG)], programId);
}
export const configPda = (programId = PROGRAM_ID) => configPdaWithBump(programId)[0];

export function collateralMintPdaWithBump(programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_COLLATERAL)], programId);
}
export const collateralMintPda = (programId = PROGRAM_ID) => collateralMintPdaWithBump(programId)[0];

export function makerPdaWithBump(programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_MAKER)], programId);
}
export const makerPda = (programId = PROGRAM_ID) => makerPdaWithBump(programId)[0];

export function treasuryPdaWithBump(programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_TREASURY)], programId);
}
export const treasuryPda = (programId = PROGRAM_ID) => treasuryPdaWithBump(programId)[0];

export function assetPdaWithBump(symbol: string, programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_ASSET), enc(symbol)], programId);
}
export const assetPda = (symbol: string, programId = PROGRAM_ID) => assetPdaWithBump(symbol, programId)[0];

/** `["market", asset, strike u64 LE, expiry i64 LE]`. `strike` in 1e-8 USD, `expiry` unix seconds. */
export function marketPdaWithBump(
  asset: PublicKey | string,
  strike: bigint | number,
  expiry: bigint | number,
  programId = PROGRAM_ID,
): Pda {
  return PublicKey.findProgramAddressSync(
    [enc(SEED_MARKET), toPubkey(asset).toBuffer(), u64Le(strike), i64Le(expiry)],
    programId,
  );
}
export const marketPda = (asset: PublicKey | string, strike: bigint | number, expiry: bigint | number, programId = PROGRAM_ID) =>
  marketPdaWithBump(asset, strike, expiry, programId)[0];

export function yesMintPdaWithBump(market: PublicKey | string, programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_YES), toPubkey(market).toBuffer()], programId);
}
export const yesMintPda = (market: PublicKey | string, programId = PROGRAM_ID) => yesMintPdaWithBump(market, programId)[0];

export function noMintPdaWithBump(market: PublicKey | string, programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_NO), toPubkey(market).toBuffer()], programId);
}
export const noMintPda = (market: PublicKey | string, programId = PROGRAM_ID) => noMintPdaWithBump(market, programId)[0];

export function vaultPdaWithBump(market: PublicKey | string, programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_VAULT), toPubkey(market).toBuffer()], programId);
}
export const vaultPda = (market: PublicKey | string, programId = PROGRAM_ID) => vaultPdaWithBump(market, programId)[0];

export function faucetClaimPdaWithBump(user: PublicKey | string, programId = PROGRAM_ID): Pda {
  return PublicKey.findProgramAddressSync([enc(SEED_FAUCET), toPubkey(user).toBuffer()], programId);
}
export const faucetClaimPda = (user: PublicKey | string, programId = PROGRAM_ID) =>
  faucetClaimPdaWithBump(user, programId)[0];

/** All addresses of one market. */
export interface MarketAddresses {
  market: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
}

export function marketAddresses(
  asset: PublicKey | string,
  strike: bigint | number,
  expiry: bigint | number,
  programId = PROGRAM_ID,
): MarketAddresses {
  const market = marketPda(asset, strike, expiry, programId);
  return {
    market,
    yesMint: yesMintPda(market, programId),
    noMint: noMintPda(market, programId),
    vault: vaultPda(market, programId),
  };
}

/** Associated token account (classic SPL Token program) for `owner`'s balance of `mint`. PDA owners allowed. */
export function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
}

/** Pyth push-oracle (sponsored feed) PriceUpdateV2 address: `[shard u16 LE, feed_id]`. */
export function pythPushFeedAddress(feedId: string | Uint8Array, shard = 0): PublicKey {
  const id = typeof feedId === 'string' ? Buffer.from(feedId.replace(/^0x/, ''), 'hex') : Buffer.from(feedId);
  if (id.length !== 32) throw new RangeError('feed id must be 32 bytes');
  const s = Buffer.alloc(2);
  s.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([s, id], PYTH_PUSH_ORACLE_ID)[0];
}
