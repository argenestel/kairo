/** Browser support: some Solana libraries (spl-token) use the global `Buffer` at call time. */
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;

export {};
