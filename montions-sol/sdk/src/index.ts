/**
 * @montions/solana-sdk — TypeScript SDK for Montions on Solana (docs/SPEC.md §8).
 *
 * Consumers (app, scripts, keeper) should import Solana classes (PublicKey, Connection, Transaction, …) from
 * this package rather than from @solana/web3.js directly, so that exactly one copy of web3.js is in play.
 */
import './polyfill.js';

export * from './constants.js';
export * from './pdas.js';
export * from './ticks.js';
export * from './grid.js';
export * from './decode.js';
export * from './model.js';
export * from './quote.js';
export * from './payoff.js';
export * from './sentence.js';
export * from './errors.js';
export * from './client.js';
export * from './pricing.js';
export { IDL, type Montions } from './idl/index.js';

// Re-exports so consumers share this package's copy of the Solana libraries.
export {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  type Commitment,
  type Signer,
  type AccountInfo,
} from '@solana/web3.js';
export { BN, BorshCoder } from '@coral-xyz/anchor';
export { bs58 } from './client.js';
export {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
export { Buffer } from 'buffer';
