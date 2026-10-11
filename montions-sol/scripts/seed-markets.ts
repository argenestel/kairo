/**
 * Seed a ladder of markets per asset and quote them (idempotent: existing markets are skipped).
 * Expiries: the canonical ~1h / ~1d / ~1w ladder (grid.ts `ladderExpiries`). Strikes: centred on spot on the
 * asset grid, spacing auto-scaled with σ√T. Default: 1 hourly + 3 daily + 3 weekly strikes × 6 assets = 42
 * markets (≈ 0.042 SOL rent each → ≈ 1.8 SOL). Prints the projected SOL cost and requires --yes.
 *
 * Usage: pnpm -C sdk seed-markets -- --cluster devnet [--rpc URL] [--assets SOL,BTC] [--hourly 1] [--daily 3]
 *        [--weekly 3] [--strikes N (all buckets)] [--per-tx 3] [--no-refresh] [--refresh-existing] [--yes]
 */
import {
  CREATE_MARKET_SPACE,
  autoStrikeSpacing,
  e8ToUsd,
  formatE8,
  ladderExpiries,
  strikesAround,
  type AssetView,
  type LadderBucket,
  type PublicKey,
  type PythPriceView,
} from "../sdk/src/index.js";
import {
  confirmPrompt,
  flagNum,
  flagStr,
  fmtTime,
  loadKeypair,
  log,
  makeClient,
  parseArgs,
  sendIxs,
  sol,
  withRetry,
} from "./lib.js";

const args = parseArgs();
const client = makeClient(args);
const conn = client.connection;
const payer = loadKeypair(args.keypairPath);

const all = args.flags.has("strikes") ? flagNum(args, "strikes", 3) : undefined;
const counts: Record<LadderBucket, number> = {
  hourly: all ?? flagNum(args, "hourly", 1),
  daily: all ?? flagNum(args, "daily", 3),
  weekly: all ?? flagNum(args, "weekly", 3),
};
const perTx = Math.max(1, Math.min(4, flagNum(args, "per-tx", 3)));
const refreshPerTx = Math.max(
  1,
  Math.min(3, flagNum(args, "refresh-per-tx", 2))
);
const doRefresh = !args.flags.has("no-refresh");
const assetFilter = flagStr(args, "assets", "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

interface Planned {
  asset: AssetView;
  bucket: LadderBucket;
  strike: bigint;
  expiry: number;
  market: PublicKey;
  exists: boolean;
}

for (const [name, n] of Object.entries(counts)) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 101)
    throw new Error(`${name} strike count must be an integer in 0..101`);
}
let failures = 0;
async function main() {
  if (!(await withRetry("isDeployed", () => client.isDeployed())))
    throw new Error("program not deployed on this cluster");
  const config = await withRetry("config", () => client.fetchConfig());
  if (!config) throw new Error("config missing — run init-devnet first");
  let assets = await withRetry("assets", () => client.fetchAssets());
  if (assetFilter.length)
    assets = assets.filter((a) => assetFilter.includes(a.symbol));
  assets = assets.filter((a) => a.active);
  if (!assets.length) throw new Error("no active assets");
  const prices = await withRetry("prices", () =>
    client.fetchPrices(assets.map((a) => a.priceAccount))
  );
  const now = Math.floor(Date.now() / 1000);

  const plan: Planned[] = [];
  assets.forEach((asset, i) => {
    const p = prices[i] as PythPriceView | null;
    if (!p) {
      log("skip_asset", { symbol: asset.symbol, reason: "no price" }, "warn");
      return;
    }
    for (const { bucket, expiry } of ladderExpiries(now)) {
      const n = counts[bucket];
      if (n <= 0) continue;
      const spacing =
        flagNum(args, "spacing", 0) ||
        autoStrikeSpacing(
          p.priceUsd,
          e8ToUsd(asset.strikeStep),
          asset.volBps / 10_000,
          expiry - now,
          Math.max(n, 3)
        );
      for (const strike of strikesAround(
        p.priceE8,
        asset.strikeStep,
        n,
        spacing
      )) {
        plan.push({
          asset,
          bucket,
          strike,
          expiry,
          market: client.marketAddress(asset.address!, strike, expiry),
          exists: false,
        });
      }
    }
  });
  const infos = await withRetry("markets", () =>
    client.fetchAccounts(plan.map((p) => p.market))
  );
  infos.forEach((info, i) => (plan[i]!.exists = !!info));
  const missing = plan.filter((p) => !p.exists);

  // cost projection
  const rents = await Promise.all(
    Object.values(CREATE_MARKET_SPACE).map((s) =>
      withRetry("rent", () => conn.getMinimumBalanceForRentExemption(s))
    )
  );
  const rentPerMarket = rents.reduce((a, b) => a + b, 0);
  const createTxs = Math.ceil(missing.length / perTx);
  const refreshTxs = doRefresh ? Math.ceil(plan.length / refreshPerTx) : 0;
  const fees = (createTxs + refreshTxs) * 5000;
  const total = missing.length * rentPerMarket + fees;
  const balance = await withRetry("balance", () =>
    conn.getBalance(payer.publicKey)
  );

  for (const p of plan) {
    log("plan", {
      symbol: p.asset.symbol,
      bucket: p.bucket,
      strike: formatE8(p.strike),
      expiry: fmtTime(p.expiry),
      market: p.market.toBase58(),
      exists: p.exists,
    });
  }
  const summary =
    `Markets: ${plan.length} in the ladder, ${missing.length} to create (${
      plan.length - missing.length
    } exist).\n` +
    `Projected cost: ${missing.length} × ${sol(rentPerMarket).toFixed(
      5
    )} SOL rent + ~${sol(fees).toFixed(5)} SOL fees = ${sol(total).toFixed(
      4
    )} SOL ` +
    `(payer ${payer.publicKey.toBase58()} has ${sol(balance).toFixed(4)} SOL).`;
  console.log(`\n${summary}`);
  if (total > balance)
    throw new Error("insufficient SOL for the planned markets");
  if (
    !(await confirmPrompt(
      args,
      "Seeding spends SOL (rent is not reclaimable)."
    ))
  )
    return;

  // create in batches (all creates of one tx share config / asset accounts best when same asset)
  const byAsset = new Map<string, Planned[]>();
  for (const p of missing)
    byAsset.set(p.asset.symbol, [...(byAsset.get(p.asset.symbol) ?? []), p]);
  let created = 0;
  for (const [symbol, list] of byAsset) {
    for (let i = 0; i < list.length; i += perTx) {
      const batch = list.slice(i, i + perTx);
      try {
        const sig = await sendIxs(
          client,
          payer,
          batch.map((p) =>
            client.ixCreateMarket(
              payer.publicKey,
              p.asset.address!,
              p.strike,
              p.expiry
            )
          ),
          {
            label: `create ${symbol} ×${batch.length}`,
            computeUnits: 120_000 * batch.length + 50_000,
            dryRun: args.dryRun,
          }
        );
        created += batch.length;
        log("created", {
          symbol,
          markets: batch.map(
            (p) => `${formatE8(p.strike)}@${fmtTime(p.expiry)}`
          ),
          sig,
        });
      } catch (e) {
        failures++;
        log(
          "create_failed",
          {
            symbol,
            error: (e as Error).message,
            logs: (e as { logs?: string[] }).logs?.slice(-6),
          },
          "error"
        );
      }
    }
  }

  // refresh quotes (new markets, and existing ones with --refresh-existing)
  if (doRefresh && config.makerParams.enabled && !config.paused) {
    const toQuote = plan.filter(
      (p) => !p.exists || args.flags.has("refresh-existing")
    );
    const views = args.dryRun
      ? []
      : await withRetry("markets", () =>
          client.fetchMarketsByAddress(toQuote.map((p) => p.market))
        );
    const ready = toQuote.filter(
      (p, i) =>
        args.dryRun ||
        (views[i] &&
          views[i]!.statusName === "open" &&
          p.expiry - now >= config.makerParams.minTte)
    );
    for (let i = 0; i < ready.length; i += refreshPerTx) {
      const batch = ready.slice(i, i + refreshPerTx);
      try {
        const sig = await sendIxs(
          client,
          payer,
          batch.map((p) =>
            client.ixRefreshQuotes(
              p.market,
              p.asset.address!,
              p.asset.priceAccount
            )
          ),
          {
            label: `refresh ×${batch.length}`,
            computeUnits: Math.min(1_400_000, 450_000 * batch.length),
            dryRun: args.dryRun,
          }
        );
        log("refreshed", {
          markets: batch.map(
            (p) =>
              `${p.asset.symbol} ${formatE8(p.strike)}@${fmtTime(p.expiry)}`
          ),
          sig,
        });
      } catch (e) {
        failures++;
        log(
          "refresh_failed",
          {
            error: (e as Error).message,
            logs: (e as { logs?: string[] }).logs?.slice(-6),
          },
          "error"
        );
      }
    }
  }
  const after = await withRetry("balance", () =>
    conn.getBalance(payer.publicKey)
  );
  log("seed_done", {
    created,
    failures,
    solSpent: sol(balance - after),
    solLeft: sol(after),
  });
  if (failures)
    throw new Error(
      `${failures} seed batches failed; rerun to retry missing markets`
    );
}

main().catch((e) => {
  log("seed_failed", { error: String((e as Error).message ?? e) }, "error");
  process.exit(1);
});
