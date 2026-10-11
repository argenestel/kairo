import { defineChain } from "viem";

/** The canonical Multicall3 deployment used by Montions on Monad testnet. */
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** Base Sepolia chain id and the canonical Multicall3 deployment. */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Arbitrum Sepolia (Chainlink). */
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/** HyperEVM testnet (HyperCore native oracle). */
export const HYPEREVM_TESTNET_CHAIN_ID = 998;

/** Monad testnet (chain 10143), as used by the Montions demo deployment. */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
    public: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Vision",
      url: "https://testnet.monadvision.com",
    },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3_ADDRESS,
    },
  },
});

export type MonadTestnet = typeof monadTestnet;

/** Base Sepolia (84532), the Chainlink-settled Montions deployment. */
export const baseSepolia = defineChain({
  id: BASE_SEPOLIA_CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
    public: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: "https://sepolia.basescan.org",
      apiUrl: "https://api-sepolia.basescan.org/api",
    },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3_ADDRESS,
    },
  },
});

export type BaseSepolia = typeof baseSepolia;

/** Arbitrum Sepolia (421614), Chainlink-settled Montions deployment. */
export const arbitrumSepolia = defineChain({
  id: ARBITRUM_SEPOLIA_CHAIN_ID,
  name: "Arbitrum Sepolia",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] },
    public: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] },
  },
  blockExplorers: {
    default: {
      name: "Arbiscan",
      url: "https://sepolia.arbiscan.io",
      apiUrl: "https://api-sepolia.arbiscan.io/api",
    },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3_ADDRESS,
    },
  },
});

export type ArbitrumSepolia = typeof arbitrumSepolia;

/** HyperEVM testnet (998). Settlement uses the HyperCore `oraclePx` precompile. */
export const hyperEvmTestnet = defineChain({
  id: HYPEREVM_TESTNET_CHAIN_ID,
  name: "HyperEVM Testnet",
  nativeCurrency: {
    name: "HYPE",
    symbol: "HYPE",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] },
    public: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] },
  },
  blockExplorers: {
    default: {
      name: "HyperEVM explorer",
      url: "https://explorer.hyperliquid-testnet.xyz",
    },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3_ADDRESS,
    },
  },
});

export type HyperEvmTestnet = typeof hyperEvmTestnet;

/** Selects the built-in chain definition for a Montions deployment. */
export function chainForId(chainId: number) {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseSepolia;
  if (chainId === ARBITRUM_SEPOLIA_CHAIN_ID) return arbitrumSepolia;
  if (chainId === HYPEREVM_TESTNET_CHAIN_ID) return hyperEvmTestnet;
  if (chainId === monadTestnet.id) return monadTestnet;
  // Keep manifests for local/future EVM networks usable without bundling a
  // chain registry. Callers can still provide a richer viem Chain explicitly.
  return defineChain({
    id: chainId,
    name: `Montions chain ${chainId}`,
    nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] }, public: { http: [] } },
  });
}
