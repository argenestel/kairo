import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBaseBudget, type BotContext } from "../src/runtime.js";

const account = "0x4fcDca6181Cd22ca253c69b891a7Fc3370DD3E39";
const parameters = { address: account, abi: [{ type: "function", name: "push", stateMutability: "nonpayable", inputs: [], outputs: [] }], functionName: "push", account } as const;
function context(balance: bigint): BotContext {
  return { deployment: { chainId: 421614 } as BotContext["deployment"], account, baseStartBalanceWei: balance,
    publicClient: { estimateContractGas: vi.fn().mockResolvedValue(100_000n), getGasPrice: vi.fn().mockResolvedValue(20_000_000n), getBalance: vi.fn().mockResolvedValue(balance), readContract: vi.fn().mockResolvedValue(0n) } as unknown as BotContext["publicClient"], rpcUrl: "" };
}
afterEach(() => vi.unstubAllEnvs());
describe("native reserve", () => {
  it("refuses a transaction whose estimated fee crosses the reserve", async () => {
    vi.stubEnv("MIN_RESERVE_WEI", "10000000000000000");
    await expect(assertBaseBudget(context(10_001_000_000_000_000n), parameters)).rejects.toThrow("breach reserve");
  });
  it("accepts a transaction with enough balance for both fee and reserve", async () => {
    vi.stubEnv("MIN_RESERVE_WEI", "10000000000000000");
    await expect(assertBaseBudget(context(11_000_000_000_000_000n), parameters)).resolves.toMatchObject({ gas: 120_000n });
  });
  it("caps Base padding while preserving a raw estimate below the transaction cap", async () => {
    const ctx = context(100_000_000_000_000_000n);
    ctx.deployment.chainId = 84532;
    vi.mocked(ctx.publicClient.estimateContractGas).mockResolvedValue(15_000_000n);
    await expect(assertBaseBudget(ctx, parameters)).resolves.toMatchObject({ gas: 16_777_216n });
  });
  it("rejects raw Base estimates above the transaction cap", async () => {
    const ctx = context(100_000_000_000_000_000n);
    ctx.deployment.chainId = 84532;
    vi.mocked(ctx.publicClient.estimateContractGas).mockResolvedValue(17_000_000n);
    await expect(assertBaseBudget(ctx, parameters)).rejects.toThrow("transaction gas cap");
  });
});
