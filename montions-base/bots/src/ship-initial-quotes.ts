/** One-time deployment initialization, budgeted separately from daily keeper operation. */
import { montionsBookAbi, makerVaultAbi, quoterAbi } from "../../sdk/src/abi/index.js";
import { addressAt, guardedWriteContract, loadBotContext, logLine, sendAndWait } from "./runtime.js";
import { readAllSeriesIds, parseSeriesInfo } from "./seriesOps.js";
const ctx=loadBotContext();
const book=addressAt(ctx.deployment,"book"), vault=addressAt(ctx.deployment,"vault"), quoter=addressAt(ctx.deployment,"quoter"), resolver=addressAt(ctx.deployment,"chainlinkResolver");
const ids=await readAllSeriesIds(ctx,book);
const rows=await ctx.publicClient.multicall({contracts:ids.map(id=>({address:book,abi:montionsBookAbi,functionName:"seriesInfo" as const,args:[id]})),allowFailure:false});
const series=rows.map((r,i)=>parseSeriesInfo(ids[i]!,r)).filter(s=>s.status===1&&s.resolver.toLowerCase()===resolver.toLowerCase());
const top=await ctx.publicClient.multicall({contracts:series.map(s=>({address:book,abi:montionsBookAbi,functionName:"bestBidAsk" as const,args:[s.id]})),allowFailure:false});
let refreshed=0, skipped=0;
for(let i=0;i<series.length;i++) {
 if(top[i]![0]>0&&top[i]![2]>0) continue;
 const id=series[i]!.id;
 const fair=await ctx.publicClient.readContract({address:quoter,abi:quoterAbi,functionName:"fair",args:[id]});
 if(fair[0]===0){logLine("initial-quotes",{event:"skip_zero_fair",series:id});skipped++;continue;}
 const hash=await guardedWriteContract(ctx,{address:vault,abi:makerVaultAbi,functionName:"refresh",args:[id],account:ctx.account});
 await sendAndWait(ctx,hash,"initial vault refresh");refreshed++;
 logLine("initial-quotes",{event:"refreshed",series:id,hash});
}
logLine("initial-quotes",{event:"done",refreshed,skipped});
