/** Seed the shared (asset, strike, expiry) ladder on a Chainlink EVM venue.
 *
 *   CHAIN_ID=84532 DEPLOYMENT=../deployments/84532.json BOT_PRIVATE_KEY=0x… \
 *     pnpm exec tsx src/evm-seed.ts [--dry-run]
 */
import type { Hex } from "viem";
import { chainlinkOracleAbi, montionsBookAbi } from "../../sdk/src/abi/index.js";
import { ladderAssets, loadChain, loadChainsConfig, strikeStepFor } from "./chains.js";
import { plannedSeries, type LadderAsset } from "./ladder.js";
import {
  addressAt,
  guardedWriteContract,
  isDryRun,
  loadBotContext,
  logLine,
  sendAndWait,
  SerialTx,
  withRpcRetry,
} from "./runtime.js";
import { CREATE_BATCH_SIZE, chunk, createSeriesCalldata, encodePlannedSeries, selectMissingSeries } from "./seriesOps.js";

function onlySymbols(): Set<string> {
  return new Set((process.env.ONLY_SYMBOLS ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean));
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const context = loadBotContext(!dryRun);
  const chainId = context.deployment.chainId;
  const chain = loadChain(chainId);
  if (chain.oracle !== "chainlink") throw new Error(`evm-seed requires a Chainlink venue, got oracle=${chain.oracle}`);
  const config = loadChainsConfig();
  const book = addressAt(context.deployment, "book");
  const oracle = addressAt(context.deployment, "chainlinkOracle", "oracle");
  const resolver = addressAt(context.deployment, "chainlinkResolver", "resolver");
  const symbols = onlySymbols();
  const wanted = ladderAssets(chain, symbols);
  const deploymentBySymbol = new Map(context.deployment.assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  const assets: LadderAsset[] = [];
  for (const spec of wanted) {
    const deployed = deploymentBySymbol.get(spec.symbol.toUpperCase());
    if (!deployed) throw new Error(`${spec.symbol} is in chains.json but missing from the deployment manifest`);
    if (deployed.settleDelay === undefined) throw new Error(`${spec.symbol} is missing settleDelay in the manifest`);
    try {
      const latest = await withRpcRetry(
        () => context.publicClient.readContract({ address: oracle, abi: chainlinkOracleAbi, functionName: "latestPrice", args: [deployed.assetId] }),
        { label: `${spec.symbol} Chainlink latestPrice` },
      );
      const spotWad = latest[0];
      if (spotWad <= 0n) throw new Error("oracle returned a non-positive spot");
      assets.push({
        symbol: spec.symbol,
        assetId: deployed.assetId,
        spotWad,
        settleDelay: deployed.settleDelay,
        strikeStep: strikeStepFor(config, spec.symbol, spec),
        ladder: true,
      });
      logLine("evm-seed", { event: "spot", chain: chainId, asset: spec.symbol, spot_wad: spotWad, quote: spec.quote ?? "USD" });
    } catch (error) {
      logLine("evm-seed", { event: "spot_skip", asset: spec.symbol, error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Unable to read a healthy Chainlink spot for ${spec.symbol}`, { cause: error });
    }
  }
  if (assets.length === 0) throw new Error("No healthy Chainlink assets are eligible for ladder seeding");

  const block = await context.publicClient.getBlock();
  const strikeCount = Number(process.env.EVM_STRIKE_COUNT ?? process.env.BASE_STRIKE_COUNT ?? config.strikeCount);
  const plan = plannedSeries(block.timestamp, assets, { strikeCount });
  const encoded = plan.map((item) => encodePlannedSeries(item, oracle, resolver));
  const missing = await selectMissingSeries(context, book, encoded);
  logLine("evm-seed", {
    event: "plan",
    chain: chainId,
    now: block.timestamp,
    assets: assets.length,
    planned: plan.length,
    missing: missing.length,
    dry_run: dryRun,
  });
  if (missing.length === 0 || dryRun) {
    if (dryRun) logLine("evm-seed", { event: "dry_run", would_create: missing.length });
    else logLine("evm-seed", { event: "done", created: 0 });
    return;
  }
  if (!context.walletClient || !context.account) throw new Error("evm-seed needs BOT_PRIVATE_KEY or BOT_ADDRESS");

  const tx = new SerialTx();
  const batches = chunk(missing, CREATE_BATCH_SIZE);
  let created = 0;
  for (const [index, batch] of batches.entries()) {
    const calls = batch.map((item) => createSeriesCalldata(resolver, item.data, item.expiry));
    await tx.run(async () => {
      let hash: Hex | undefined;
      await withRpcRetry(async () => {
        if (!hash) {
          hash = await guardedWriteContract(context, {
            address: book,
            abi: montionsBookAbi,
            functionName: "multicall",
            args: [calls],
            account: context.account!,
            chain: undefined,
          });
        }
        await sendAndWait(context, hash, "EVM seed series batch");
      }, { label: "EVM seed series multicall" });
    });
    created += batch.length;
    logLine("evm-seed", { event: "batch", index: index + 1, batches: batches.length, created });
  }
  logLine("evm-seed", { event: "done", chain: chainId, created });
}

main().catch((error: unknown) => {
  console.error(`EVM-SEED failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
