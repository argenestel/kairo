import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kairo/paper': r('../paper'),
      // SDKs are consumed from source so the app always matches the programs/contracts.
      '@montions/solana-sdk': r('../montions-sol/sdk/src/index.ts'),
      '@montions/base-sdk': r('../montions-base/sdk/src/index.ts'),
      '@montions/sol-config': r('../montions-sol/config'),
      '@montions/base-deployments': r('../montions-base/deployments'),
    },
  },
  define: { 'process.env': {} },
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('node_modules/viem')) return 'viem';
          if (id.includes('node_modules/qrcode')) return 'qr';
          if (id.includes('@solana/web3.js') || id.includes('@coral-xyz/anchor') || id.includes('@solana/spl-token')) return 'solana';
        },
      },
    },
  },
});
