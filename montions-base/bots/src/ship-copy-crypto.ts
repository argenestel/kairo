/** Seed exactly the Base economic ladder on the second chain. */
import {readFileSync} from "node:fs";
import {createPublicClient,http} from "viem";
import {parseDeployment} from "../../sdk/src/deployments.js";
import {montionsBookAbi} from "../../sdk/src/abi/index.js";
import {addressAt,loadBotContext,guardedWriteContract,sendAndWait,logLine,makeChain} from "./runtime.js";
import {readAllSeriesIds,decodePriceSeriesData,parseSeriesInfo,encodePriceSeriesData,computeSeriesId,selectMissingSeries,chunk,createSeriesCalldata,CREATE_BATCH_SIZE} from "./seriesOps.js";
const ctx=loadBotContext();
const source=parseDeployment(JSON.parse(readFileSync(process.env.SOURCE_DEPLOYMENT ?? "../deployments/84532.json","utf8")));
const sourceRpc=process.env.SOURCE_RPC ?? source.rpc;
const reader={...ctx,deployment:source,publicClient:createPublicClient({chain:makeChain(source.chainId,sourceRpc),transport:http(sourceRpc)}),rpcUrl:sourceRpc};
const sourceBook=addressAt(source,"book");
const ids=await readAllSeriesIds(reader,sourceBook);
const rows=await reader.publicClient.multicall({contracts:ids.map(id=>({address:sourceBook,abi:montionsBookAbi,functionName:"seriesInfo" as const,args:[id]})),allowFailure:false});
const crypto=new Set(source.assets.filter(a=>a.ladder).map(a=>a.assetId.toLowerCase()));
const book=addressAt(ctx.deployment,"book"),oracle=addressAt(ctx.deployment,"chainlinkOracle"),resolver=addressAt(ctx.deployment,"chainlinkResolver");
const planned=rows.flatMap((row,i)=>{
 const s=parseSeriesInfo(ids[i]!,row),d=decodePriceSeriesData(s.data);
 if(!d||!crypto.has(d.assetId.toLowerCase()))return [];
 const data=encodePriceSeriesData(oracle,d.assetId,d.strikeWad,d.above,d.window);
 return [{data,expiry:s.expiry,id:computeSeriesId(resolver,data,s.expiry),symbol:source.assets.find(a=>a.assetId.toLowerCase()===d.assetId.toLowerCase())!.symbol,assetId:d.assetId}];
});
const missing=await selectMissingSeries(ctx,book,planned);
logLine("copy-crypto",{planned:planned.length,missing:missing.length});
for(const batch of chunk(missing,CREATE_BATCH_SIZE)) {
 const hash=await guardedWriteContract(ctx,{address:book,abi:montionsBookAbi,functionName:"multicall",args:[batch.map(p=>createSeriesCalldata(resolver,p.data,p.expiry))],account:ctx.account});
 await sendAndWait(ctx,hash,"canonical crypto seed");logLine("copy-crypto",{created:batch.length,hash});
}
