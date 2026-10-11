// Node globals that @solana/web3.js, anchor and spl-token expect in the browser.
// Imported first from main.tsx so it runs before any chain adapter is (lazily) loaded.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown; process?: { env: Record<string, string> } };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
if (!g.process) g.process = { env: {} };
