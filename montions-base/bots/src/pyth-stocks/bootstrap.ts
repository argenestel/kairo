import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, fail, isMain, loadEnv } from './common.js';
import { Hermes, validateUpdate } from './hermes.js';
import { verifiedSchedules } from './updater.js';
/** Fetch public signed payloads, never credentials. This command does not submit transactions. */
async function main(): Promise<void> {
  loadEnv();
  const index=process.argv.indexOf('--out'), file=process.argv[index+1];
  if (index === -1 || !file || file.startsWith('--')) throw new Error('Provide --out for bootstrap JSON');
  const hermes=new Hermes(process.env.PYTH_HERMES_API_KEY);
  verifiedSchedules(await hermes.metadata());
  const ids=config.assets.map(a=>a.feedId), update=await hermes.updates(ids);
  // Off-session bootstrap may initialize last prices. Freshness is separately enforced for quoting.
  const data=validateUpdate(update,ids,0,Math.floor(Date.now()/1000));
  writeFileSync(resolve(file),JSON.stringify({updateData:data},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Kairo Pyth bootstrap: 29 feeds verified; signed payload file created.');
}
if (isMain(import.meta.url)) main().catch(fail);
