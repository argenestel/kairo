import fs from 'node:fs';
import {createPublicClient, http} from '../bots/node_modules/viem/_esm/index.js';
const path = process.env.DEPLOYMENT ?? 'deployments/84532.json';
const d = JSON.parse(fs.readFileSync(path));
const client = createPublicClient({transport:http(process.env.RPC_URL ?? d.rpc)});
const abi = name => JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`)).abi;
if (await client.getChainId() !== 84532) throw Error('Wrong chain');
const read = (contract, name, functionName, args=[]) => client.readContract({address:d.contracts[contract],abi:abi(name),functionName,args});
for (const [name,address] of Object.entries(d.contracts)) {
 if (!address || await client.getCode({address}) === undefined) throw Error(`Missing code ${name}`);
}
const count = await read('book','MontionsBook','seriesCount');
const nav = await read('vault','MakerVault','totalAssets');
const assets = await read('chainlinkOracle','ChainlinkOracle','assetCount');
if (!count || !nav || assets < 3n) throw Error('Empty deployment');
const ids = await read('book','MontionsBook','seriesIds',[0n,1n]);
const id = ids[0];
const fair = await read('quoter','Quoter','fair',[id]);
const depth = await read('book','MontionsBook','bestBidAsk',[id]);
const quote = await read('quoter','Quoter','quoteBuy',[id,true,1n,99]);
if (!fair[0] || !quote.filled) throw Error('Sample series has no executable quote');
const result = {chainId:84532,seriesCount:count,assetCount:assets,vaultNAV:nav,sampleSeries:id,fair,bestBidAsk:depth,quote};
const output = JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2);
console.log(output);
fs.writeFileSync(process.env.VERIFY_OUT ?? 'deployments/base-logs/live-readback.json',output+'\n');
