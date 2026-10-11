/**
 * Thin re-export: Base Sepolia is the EVM adapter pinned to 'base-sepolia'.
 * Shared implementation lives in ./evm.ts (Base + Arbitrum + HyperEVM).
 */
export {
  createEvmAdapter,
  createBaseAdapter,
  type EvmAdapterOptions,
  type BaseAdapterOptions,
} from './evm';
export { createBaseAdapter as default } from './evm';
