import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hex } from 'viem';
import { config } from './common.js';
import { validateUpdate, type Update } from './hermes.js';
/** Offline inspection only: never send fixture bytes to a chain. No API key, signer or RPC needed. */
export function offlineFixture(kind: 'latest' | 'settlement'): boolean {
  const index = process.argv.indexOf('--fixture');
  if (index === -1) return false;
  if (!process.argv.includes('--dry-run') || !process.argv.includes('--once')) throw new Error('Fixtures require --once --dry-run');
  const file = process.argv[index+1];
  if (!file || file.startsWith('--')) throw new Error('Provide a fixture JSON path');
  const update = JSON.parse(readFileSync(resolve(file),'utf8')) as Update;
  const ids = update.parsed.map(p => `0x${p.id.replace(/^0x/,'')}` as Hex);
  if (!ids.length || ids.some(id=>!config.assets.some(a=>a.feedId===id))) throw new Error('Fixture contains unknown stocks');
  const expiry = Number(process.env.PYTH_FIXTURE_EXPIRY ?? update.parsed[0]!.price.publish_time);
  if (!Number.isSafeInteger(expiry)) throw new Error('Invalid fixture expiry');
  const data = validateUpdate(update,ids,expiry,expiry+300);
  console.log(JSON.stringify({dryRun:true,offline:true,kind,feeds:ids.length,blobs:data.length,expiry,signatureVerified:false}));
  return true;
}
