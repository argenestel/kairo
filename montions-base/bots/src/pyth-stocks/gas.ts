import { encodeFunctionData, parseAbi } from 'viem';
import { assertBaseBudget, BASE_GAS_PRICE_ORACLE, type BotContext, type GuardedWriteParameters } from '../runtime.js';
const feeAbi = parseAbi(['function getL1FeeUpperBound(uint256 size) view returns(uint256)']);
/** Include payable Pyth fees as well as execution and L1 data fees in the stock keeper budget. */
export function checkCost(start: bigint, balance: bigint, cost: bigint, budget: bigint, reserve: bigint): void {
  const spent = start > balance ? start-balance : 0n;
  if (cost < 0n || budget <= 0n || reserve < 0n || spent+cost > budget || balance < cost+reserve) throw new Error('Pyth stock gas/balance budget exceeded');
}
export async function guardCost(context: BotContext, parameters: GuardedWriteParameters): Promise<bigint> {
  const fees = await assertBaseBudget(context,parameters);
  if (!fees.gas || !fees.maxFeePerGas || context.baseStartBalanceWei === undefined) throw new Error('Missing spend estimate');
  const account = typeof context.account === 'string' ? context.account : context.account?.address;
  if (!account) throw new Error('Missing signer');
  let l1 = 0n;
  if (context.deployment.chainId === 84532) {
    const data = encodeFunctionData(parameters as Parameters<typeof encodeFunctionData>[0]);
    l1 = await context.publicClient.readContract({address:BASE_GAS_PRICE_ORACLE,abi:feeAbi,functionName:'getL1FeeUpperBound',args:[BigInt((data.length-2)/2+68)]});
  }
  // Arbitrum estimateGas includes its L1 calldata component. Base uses the explicit data-fee bound.
  const cost = fees.gas * fees.maxFeePerGas + l1 + (parameters.value ?? 0n);
  const balance = await context.publicClient.getBalance({address:account});
  checkCost(context.baseStartBalanceWei,balance,cost,BigInt(process.env.PYTH_KEEPER_BUDGET_WEI ?? '1000000000000000'),BigInt(process.env.PYTH_MIN_RESERVE_WEI ?? '5000000000000000'));
  return cost;
}
