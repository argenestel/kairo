/**
 * Seed Kairo equity series: 3 ATM catalog strikes × next Friday 20:00 UTC.
 *
 * Identical canonical keys on every chain (`SYMBOL:strike:expiry`). Uses the
 * catalog grid (not a live-spot re-centre) so Base and Arbitrum list the same
 * markets. Weekend feeder prints keep the keeper-reported spot near last close.
 *
 *   CHAIN_ID=84532 DEPLOYMENT=../deployments/84532.json BOT_PRIVATE_KEY=0x… \
 *     pnpm exec tsx src/stock-seed.ts [--dry-run]
 *
 * Env: ONLY_SYMBOLS=SPY,QQQ  MIN_RESERVE_WEI  EVM_BUDGET_WEI
 */
import type { Hex } from "viem";
import { chainlinkOracleAbi, montionsBookAbi } from "../../sdk/src/abi/index.js";
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
import { CREATE_BATCH_SIZE, chunk, createSeriesCalldata, encodePriceSeriesData, computeSeriesId, selectMissingSeries } from "./seriesOps.js";
import {
  LIQUID_12,
  loadStocksConfig,
  nextFridayCloseUtc,
  strikeToWad,
  threeAtmStrikes,
  type StockAsset,
} from "./stock-feeder.js";

function onlySymbols(): string[] {
  return (process.env.ONLY_SYMBOLS ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function minReserveWei(): bigint {
  const raw = process.env.MIN_RESERVE_WEI ?? process.env.LIVE_MIN_RESERVE_WEI ?? "0";
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const context = loadBotContext(!dryRun);
  const chainId = context.deployment.chainId;
  const book = addressAt(context.deployment, "book");
  const oracle = addressAt(context.deployment, "chainlinkOracle", "oracle");
  const resolver = addressAt(context.deployment, "chainlinkResolver", "resolver");
  const catalog = loadStocksConfig();
  const wanted = onlySymbols();
  const assets: StockAsset[] = catalog.assets.filter((asset) => wanted.length === 0 || wanted.includes(asset.symbol));
  if (assets.length === 0) throw new Error("stock-seed: no symbols selected");

  const expiryDate = nextFridayCloseUtc(new Date());
  const expiry = BigInt(Math.floor(expiryDate.getTime() / 1000));
  const settleDelay = catalog.oracle.settleDelay;
  const planned = [];
  for (const asset of assets) {
    const deployed = context.deployment.assets.find((row) => row.symbol.toUpperCase() === asset.symbol);
    if (!deployed) {
      logLine("stock-seed", { event: "skip_not_in_manifest", asset: asset.symbol });
      continue;
    }
    const strikes = threeAtmStrikes(asset.strikes, asset.price);
    for (const strike of strikes) {
      const strikeWad = strikeToWad(strike);
      const data = encodePriceSeriesData(oracle, deployed.assetId, strikeWad, true, settleDelay);
      planned.push({
        data,
        expiry,
        id: computeSeriesId(resolver, data, expiry),
        symbol: asset.symbol,
        assetId: deployed.assetId,
        strike,
      });
    }
  }
  const encoded = planned.map(({ data, expiry: exp, id, symbol, assetId }) => ({ data, expiry: exp, id, symbol, assetId }));
  const missing = dryRun ? encoded : await selectMissingSeries(context, book, encoded);
  logLine("stock-seed", {
    event: "plan",
    chain: chainId,
    expiry: expiry.toString(),
    expiry_iso: expiryDate.toISOString(),
    assets: assets.length,
    planned: planned.length,
    missing: missing.length,
    dry_run: dryRun,
  });
  if (missing.length === 0 || dryRun) {
    if (dryRun) logLine("stock-seed", { event: "dry_run", would_create: missing.length });
    else logLine("stock-seed", { event: "done", created: 0 });
    return;
  }
  if (!context.walletClient || !context.account) throw new Error("stock-seed needs BOT_PRIVATE_KEY or BOT_ADDRESS");

  const account = typeof context.account === "string" ? context.account : context.account.address;
  const reserve = minReserveWei();
  const tx = new SerialTx();
  const batches = chunk(missing, CREATE_BATCH_SIZE);
  let created = 0;
  for (const [index, batch] of batches.entries()) {
    const bal = await context.publicClient.getBalance({ address: account });
    if (reserve > 0n && bal <= reserve) {
      logLine("stock-seed", {
        event: "stop_reserve",
        balance: bal.toString(),
        reserve: reserve.toString(),
        created,
        remaining: missing.length - created,
      });
      break;
    }
    const healthy = await withRpcRetry(
      () => context.publicClient.readContract({
        address: oracle,
        abi: chainlinkOracleAbi,
        functionName: "isHealthy",
        args: [batch[0]!.assetId],
      }),
      { label: "stock isHealthy" },
    );
    if (!healthy) {
      throw new Error(`stock-seed: ${batch[0]!.symbol} feed is not healthy — push the feeder first`);
    }
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
        await sendAndWait(context, hash, "stock seed series batch");
      }, { label: "stock seed series multicall" });
    });
    created += batch.length;
    logLine("stock-seed", {
      event: "batch",
      index: index + 1,
      batches: batches.length,
      created,
      symbols: [...new Set(batch.map((item) => item.symbol))].join(","),
    });
  }
  logLine("stock-seed", { event: "done", chain: chainId, created, planned: planned.length });
}

export { LIQUID_12 };

if (process.argv[1] && /(?:^|[/\\])stock-seed(?:\.[cm]?[jt]s)?$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`STOCK-SEED failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
