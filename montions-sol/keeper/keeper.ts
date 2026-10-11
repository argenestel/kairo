/**
 * Montions keeper (long-running, permissionless actions only):
 *  - resolve expired markets as soon as the sponsored Pyth account holds a print >= expiry (fast 1 s settle loop;
 *    the program only accepts prints inside [expiry, expiry + settle_window] unless it is provably the first one),
 *  - maker_sweep settled markets (and open ones inside min_tte, which cancels the maker's quotes),
 *  - refresh_quotes when |fair − last quoted fair| >= 1 tick, every --refresh-max-age s, or after fills,
 *  - roll the ladder: keep markets ~1h / ~1d / ~1w out (budget-capped: --max-sol-per-day, --min-sol),
 *  - void markets still unresolved after expiry + 24 h.
 * Rate-limit friendly: one getMultipleAccounts for prices + one per 100 open markets per tick; headers-only
 * getProgramAccounts scan every --scan-every s. Structured JSON logs. SIGINT = clean shutdown.
 *
 * Usage: pnpm -C sdk keeper -- --cluster devnet [--rpc URL] [--keypair PATH] [--interval 5000] [--dry-run] [--once]
 *        [--hourly 1] [--daily 3] [--weekly 3] [--hourly-assets SOL] [--no-create] [--max-sol-per-day 0.5]
 *        [--min-sol 0.5] [--refresh-max-age 120] [--refresh-min-gap 15] [--assets SOL,BTC]
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  CREATE_MARKET_SPACE,
  STATUS_OPEN,
  VOID_GRACE,
  autoStrikeSpacing,
  e8ToUsd,
  formatE8,
  fairTickE8,
  ladderExpiries,
  strikesAround,
  type AssetView,
  type ConfigView,
  type LadderBucket,
  type MarketView,
  type PublicKey,
  type PythPriceView,
  type TransactionInstruction,
} from "../sdk/src/index.js";
import {
  ROOT,
  flagNum,
  flagStr,
  fmtTime,
  loadKeypair,
  log,
  makeClient,
  parseArgs,
  sendIxs,
  sleep,
  sol,
  withRetry,
} from "../scripts/lib.js";

const args = parseArgs();
const client = makeClient(args);
const conn = client.connection;
const payer = loadKeypair(args.keypairPath);

const opt = {
  intervalMs: flagNum(args, "interval", 5000),
  once: args.flags.has("once"),
  dryRun: args.dryRun,
  create: !args.flags.has("no-create"),
  counts: {
    hourly: flagNum(args, "hourly", 1),
    daily: flagNum(args, "daily", 3),
    weekly: flagNum(args, "weekly", 3),
  } as Record<LadderBucket, number>,
  hourlyAssets: flagStr(args, "hourly-assets", "")
    .toUpperCase()
    .split(",")
    .filter(Boolean),
  assets: flagStr(args, "assets", "").toUpperCase().split(",").filter(Boolean),
  maxNewMarketsPerHour: flagNum(args, "max-new-markets-per-hour", 12),
  maxSolPerDay: flagNum(args, "max-sol-per-day", 0.5),
  minSol: flagNum(args, "min-sol", 0.5),
  refreshMaxAge: flagNum(args, "refresh-max-age", 120),
  refreshMinGap: flagNum(args, "refresh-min-gap", 15),
  scanEvery: flagNum(args, "scan-every", 60),
  rollEvery: flagNum(args, "roll-every", 60),
  settlePollMs: flagNum(args, "settle-poll", 1000),
  refreshPerTx: Math.max(1, Math.min(3, flagNum(args, "refresh-per-tx", 2))),
};

interface MarketState {
  address: PublicKey;
  view: MarketView;
  lastRefresh: number;
  lastFairTick: number;
  lastTradeCount: number;
  done: boolean;
  missedLogged: boolean;
}

const state = {
  config: null as ConfigView | null,
  assets: [] as AssetView[],
  assetsAt: 0,
  prices: new Map<string, PythPriceView>(), // asset address → price
  markets: new Map<string, MarketState>(),
  scannedAt: 0,
  rolledAt: 0,
  created: [] as { at: number; lamports: number }[],
  inflight: new Set<string>(),
  stopping: false,
  rentPerMarket: 0,
};

const budgetPath = flagStr(
  args,
  "budget-file",
  join(
    ROOT,
    "keeper",
    ".state",
    `budget-${createHash("sha256")
      .update(args.rpc + payer.publicKey.toBase58())
      .digest("hex")
      .slice(0, 16)}.json`
  )
);
if (!opt.dryRun) {
  try {
    const saved: unknown = JSON.parse(readFileSync(budgetPath, "utf8"));
    if (
      !Array.isArray(saved) ||
      saved.some(
        (c) =>
          !Number.isFinite(c.at) ||
          !Number.isFinite(c.lamports) ||
          c.lamports < 0
      )
    )
      throw new Error("invalid keeper budget file");
    state.created = saved;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
function saveBudget() {
  if (opt.dryRun) return;
  mkdirSync(dirname(budgetPath), { recursive: true });
  writeFileSync(budgetPath + ".tmp", JSON.stringify(state.created), {
    mode: 0o600,
  });
  renameSync(budgetPath + ".tmp", budgetPath);
}
for (const [name, value] of Object.entries({
  interval: opt.intervalMs,
  settlePoll: opt.settlePollMs,
  scanEvery: opt.scanEvery,
  rollEvery: opt.rollEvery,
  refreshMaxAge: opt.refreshMaxAge,
})) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be positive`);
}
for (const [name, value] of Object.entries({
  ...opt.counts,
  maxNewMarketsPerHour: opt.maxNewMarketsPerHour,
})) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a nonnegative integer`);
}
let hadFailures = false;
const key = (k: PublicKey) => k.toBase58();
const nowS = () => Math.floor(Date.now() / 1000);

function assetOf(m: MarketView): AssetView | undefined {
  return state.assets.find((a) => a.address!.equals(m.asset));
}

async function loadStatic(force = false) {
  const now = nowS();
  if (!force && now - state.assetsAt < 300 && state.config) return;
  state.config = await withRetry("config", () => client.fetchConfig());
  if (!state.config) throw new Error("config missing — run init-devnet first");
  let assets = await withRetry("assets", () => client.fetchAssets());
  if (opt.assets.length)
    assets = assets.filter((a) => opt.assets.includes(a.symbol));
  state.assets = assets;
  state.assetsAt = now;
  if (!state.rentPerMarket) {
    const rents = await Promise.all(
      Object.values(CREATE_MARKET_SPACE).map((s) =>
        withRetry("rent", () => conn.getMinimumBalanceForRentExemption(s))
      )
    );
    state.rentPerMarket = rents.reduce((a, b) => a + b, 0) + 10_000;
  }
}

async function refreshPrices(assets = state.assets) {
  if (!assets.length) return;
  const ps = await withRetry("prices", () =>
    client.fetchPrices(assets.map((a) => a.priceAccount))
  );
  assets.forEach((a, i) => {
    const p = ps[i];
    if (p) state.prices.set(key(a.address!), p);
    else state.prices.delete(key(a.address!));
  });
}

async function scanMarkets() {
  const views = await withRetry("scan", () =>
    client.fetchMarkets({ headersOnly: true })
  );
  const assetKeys = new Set(state.assets.map((a) => key(a.address!)));
  for (const v of views) {
    if (!v.address || !assetKeys.has(key(v.asset))) continue;
    const k = key(v.address);
    if (!state.markets.has(k)) {
      state.markets.set(k, {
        address: v.address,
        view: v,
        lastRefresh: 0,
        lastFairTick: 0,
        lastTradeCount: -1,
        done: false,
        missedLogged: false,
      });
    }
  }
  state.scannedAt = nowS();
}

async function loadActiveFull() {
  const active = [...state.markets.values()].filter((s) => !s.done);
  if (!active.length) return;
  const views = await withRetry("markets", () =>
    client.fetchMarketsByAddress(active.map((s) => s.address))
  );
  views.forEach((v, i) => {
    // A concurrent read started before resolve must not reopen our settled view.
    if (
      v &&
      !(active[i]!.view.status !== STATUS_OPEN && v.status === STATUS_OPEN)
    )
      active[i]!.view = v;
  });
}

function makerSeat(m: MarketView) {
  const maker = state.config!.maker;
  return m.seats.find((s) => s.owner.equals(maker));
}

function seatHasValue(m: MarketView): boolean {
  const s = makerSeat(m);
  return (
    !!s &&
    (s.cash > 0n ||
      s.locked > 0n ||
      s.yes > 0n ||
      s.no > 0n ||
      s.yesLocked > 0n ||
      s.noLocked > 0n ||
      s.openOrders > 0)
  );
}

function fairTickOf(
  m: MarketView,
  now: number
): { tick: number; fresh: boolean } | null {
  const a = assetOf(m);
  const p = a && state.prices.get(key(a.address!));
  if (!a || !p) return null;
  // exactly the program's fair tick (pricing.ts twin): N(d2) on (spot e8, strike e8, vol bps, expiry − now)
  const tick = fairTickE8(p.priceE8, m.strike, a.volBps, m.expiry - now);
  const fresh =
    p.verification === "full" &&
    p.feedId === a.feedId &&
    p.priceE8 > 0n &&
    p.conf * 10_000n <= BigInt(a.maxConfBps) * p.price &&
    p.publishTime <= now + 5 &&
    now - p.publishTime <=
      Math.max(0, state.config!.makerParams.maxPriceAge - 5);
  return { tick, fresh };
}

/** Seed per-market memory from the book after a restart: last refresh = newest maker order ts, fair ≈ maker mid. */
function hydrate(s: MarketState) {
  if (s.lastRefresh || !s.view.full) return;
  const maker = state.config!.maker;
  const mine = s.view.orders.filter((o) => o.owner?.equals(maker));
  if (!mine.length) return;
  s.lastRefresh = Math.max(...mine.map((o) => o.ts));
  const bids = mine.filter((o) => o.side === 0).map((o) => o.tick);
  const asks = mine.filter((o) => o.side === 1).map((o) => o.tick);
  if (bids.length && asks.length)
    s.lastFairTick = Math.round((Math.max(...bids) + Math.min(...asks)) / 2);
  s.lastTradeCount = s.view.tradeCount;
}

async function sendBatch(
  label: string,
  ixs: TransactionInstruction[],
  cu: number
): Promise<string | null> {
  return sendIxs(client, payer, ixs, {
    label,
    computeUnits: Math.min(1_400_000, cu),
    dryRun: opt.dryRun,
  });
}

// ───────────────────────── settle loop (fast) ─────────────────────────

/** Markets past expiry still inside (expiry, expiry + window + slack]. */
function settleCandidates(now: number): MarketState[] {
  return [...state.markets.values()].filter((s) => {
    if (s.done || s.view.status !== STATUS_OPEN || now <= s.view.expiry)
      return false;
    const a = assetOf(s.view);
    const p = a && state.prices.get(key(a.address!));
    const validPrint =
      p &&
      p.publishTime >= s.view.expiry &&
      (p.publishTime <= s.view.expiry + a!.settleWindow ||
        p.prevPublishTime < s.view.expiry);
    return (
      !!a &&
      (now <= s.view.expiry + a.settleWindow + 30 || validPrint) &&
      !state.inflight.has(key(s.address))
    );
  });
}

async function settleOnce(): Promise<void> {
  const now = nowS();
  const cands = settleCandidates(now);
  if (!cands.length) return;
  const assets = [
    ...new Map(
      cands.map((s) => [key(s.view.asset), assetOf(s.view)!])
    ).values(),
  ];
  await refreshPrices(assets);
  const groups = new Map<string, MarketState[]>();
  for (const s of cands) {
    const a = assetOf(s.view)!;
    const p = state.prices.get(key(a.address!));
    if (!p || p.publishTime < s.view.expiry) continue; // PriceNotReady — keep polling
    const firstPrint = p.prevPublishTime < s.view.expiry;
    if (!firstPrint && p.publishTime > s.view.expiry + a.settleWindow) {
      if (!s.missedLogged) {
        log(
          "settle_window_missed",
          {
            market: key(s.address),
            symbol: a.symbol,
            expiry: fmtTime(s.view.expiry),
            publishTime: p.publishTime,
          },
          "warn"
        );
        s.missedLogged = true;
      }
      continue;
    }
    groups.set(a.symbol, [...(groups.get(a.symbol) ?? []), s]);
  }
  for (const [symbol, list] of groups) {
    const a = assetOf(list[0]!.view)!;
    for (let i = 0; i < list.length; i += 8) {
      const batch = list.slice(i, i + 8);
      batch.forEach((s) => state.inflight.add(key(s.address)));
      try {
        const sig = await sendBatch(
          `resolve ${symbol} ×${batch.length}`,
          batch.map((s) =>
            client.ixResolve(s.address, a.address!, a.priceAccount)
          ),
          40_000 * batch.length + 20_000
        );
        for (const s of batch) {
          log("resolved", {
            market: key(s.address),
            symbol,
            strike: formatE8(s.view.strike),
            expiry: fmtTime(s.view.expiry),
            sig,
            lagS: nowS() - s.view.expiry,
          });
          if (!opt.dryRun)
            s.view = { ...s.view, status: 2, statusName: "resolved" };
        }
      } catch (e) {
        const err = e as Error & { program?: string; logs?: string[] };
        log(
          "resolve_failed",
          {
            symbol,
            markets: batch.map((s) => key(s.address)),
            error: err.message,
            logs: err.logs?.slice(-5),
          },
          "warn"
        );
        // one bad market must not block the others: fall back to singles next round
        if (batch.length === 1) hadFailures = true;
        if (batch.length > 1) {
          for (const s of batch) {
            try {
              const sig = await sendBatch(
                `resolve ${symbol}`,
                [client.ixResolve(s.address, a.address!, a.priceAccount)],
                60_000
              );
              log("resolved", {
                market: key(s.address),
                symbol,
                sig,
                lagS: nowS() - s.view.expiry,
              });
              if (!opt.dryRun)
                s.view = { ...s.view, status: 2, statusName: "resolved" };
            } catch (e2) {
              hadFailures = true;
              log(
                "resolve_failed",
                { market: key(s.address), error: (e2 as Error).message },
                "warn"
              );
            }
          }
        }
      } finally {
        batch.forEach((s) => state.inflight.delete(key(s.address)));
      }
    }
  }
}

async function settleLoop() {
  while (!state.stopping) {
    try {
      if (state.config) await settleOnce();
    } catch (e) {
      log(
        "settle_loop_error",
        { error: String((e as Error).message ?? e) },
        "warn"
      );
    }
    await sleep(opt.settlePollMs);
  }
}

// ───────────────────────── main tick ─────────────────────────

async function tick() {
  await loadStatic();
  const now = nowS();
  if (now - state.scannedAt >= opt.scanEvery) await scanMarkets();
  await refreshPrices();
  await loadActiveFull();
  const cfg = state.config!;
  const mp = cfg.makerParams;

  const sweeps: MarketState[] = [];
  const refreshes: { s: MarketState; fair: number; reason: string }[] = [];
  const voids: MarketState[] = [];

  for (const s of state.markets.values()) {
    if (s.done || state.inflight.has(key(s.address))) continue;
    const m = s.view;
    hydrate(s);
    if (m.status !== STATUS_OPEN) {
      if (seatHasValue(m)) sweeps.push(s);
      else s.done = true;
      continue;
    }
    if (now > m.expiry) {
      if (now >= m.expiry + VOID_GRACE) voids.push(s);
      continue; // resolution is the settle loop's job
    }
    const tte = m.expiry - now;
    if (tte < mp.minTte) {
      const seat = makerSeat(m);
      if (seat && (seat.openOrders > 0 || seat.cash > 0n)) sweeps.push(s);
      continue;
    }
    if (!mp.enabled || cfg.paused) continue;
    const f = fairTickOf(m, now);
    if (!f || !f.fresh) continue;
    if (now - s.lastRefresh < opt.refreshMinGap) continue;
    const seat = makerSeat(m);
    let reason = "";
    if (!seat || seat.openOrders === 0) reason = "no_quotes";
    else if (s.lastFairTick && Math.abs(f.tick - s.lastFairTick) >= 1)
      reason = `fair_moved ${s.lastFairTick}→${f.tick}`;
    else if (s.lastTradeCount >= 0 && m.tradeCount !== s.lastTradeCount)
      reason = "fills";
    else if (now - s.lastRefresh >= opt.refreshMaxAge) reason = "stale";
    if (reason) refreshes.push({ s, fair: f.tick, reason });
  }

  // sweeps (3 per tx)
  for (let i = 0; i < sweeps.length; i += 3) {
    const batch = sweeps.slice(i, i + 3);
    try {
      const sig = await sendBatch(
        `maker_sweep ×${batch.length}`,
        batch.map((s) => client.ixMakerSweep(s.address)),
        250_000 * batch.length
      );
      log("swept", { markets: batch.map((s) => key(s.address)), sig });
    } catch (e) {
      hadFailures = true;
      log(
        "sweep_failed",
        {
          markets: batch.map((s) => key(s.address)),
          error: (e as Error).message,
          logs: (e as { logs?: string[] }).logs?.slice(-5),
        },
        "warn"
      );
    }
  }

  // voids (8 per tx)
  for (let i = 0; i < voids.length; i += 8) {
    const batch = voids.slice(i, i + 8);
    try {
      const sig = await sendBatch(
        `void ×${batch.length}`,
        batch.map((s) => client.ixVoidMarket(s.address)),
        30_000 * batch.length + 20_000
      );
      log("voided", { markets: batch.map((s) => key(s.address)), sig });
    } catch (e) {
      hadFailures = true;
      log("void_failed", { error: (e as Error).message }, "warn");
    }
  }

  // refreshes (closest-to-expiry first; refreshPerTx per tx)
  refreshes.sort((a, b) => a.s.view.expiry - b.s.view.expiry);
  for (
    let i = 0;
    i < refreshes.length && !state.stopping;
    i += opt.refreshPerTx
  ) {
    const batch = refreshes.slice(i, i + opt.refreshPerTx);
    const ixs = batch.map(({ s }) => {
      const a = assetOf(s.view)!;
      return client.ixRefreshQuotes(s.address, a.address!, a.priceAccount);
    });
    try {
      const sig = await sendBatch(
        `refresh ×${batch.length}`,
        ixs,
        450_000 * batch.length
      );
      const t = nowS();
      for (const r of batch) {
        r.s.lastRefresh = t;
        r.s.lastFairTick = r.fair;
        r.s.lastTradeCount = r.s.view.tradeCount;
      }
      log("refreshed", {
        markets: batch.map(
          (r) =>
            `${assetOf(r.s.view)!.symbol} ${formatE8(
              r.s.view.strike
            )}@${fmtTime(r.s.view.expiry)} fair=${r.fair} (${r.reason})`
        ),
        sig,
      });
    } catch (e) {
      const t = nowS();
      // back off these markets for one min-gap period
      batch.forEach((r) => (r.s.lastRefresh = t));
      hadFailures = true;
      log(
        "refresh_failed",
        {
          markets: batch.map((r) => key(r.s.address)),
          error: (e as Error).message,
          logs: (e as { logs?: string[] }).logs?.slice(-5),
        },
        "warn"
      );
    }
  }

  if (opt.create && now - state.rolledAt >= opt.rollEvery) {
    await rollLadder(now);
    state.rolledAt = now;
  }
}

// ───────────────────────── ladder roll ─────────────────────────

function createdLast24h(now: number): number {
  state.created = state.created.filter((c) => now - c.at < 86_400);
  return state.created.reduce((a, c) => a + c.lamports, 0);
}

async function rollLadder(now: number) {
  const cfg = state.config!;
  if (cfg.paused) return;
  const balance = await withRetry("balance", () =>
    conn.getBalance(payer.publicKey)
  );
  const wants: {
    asset: AssetView;
    bucket: LadderBucket;
    strike: bigint;
    expiry: number;
    dist: bigint;
  }[] = [];
  for (const a of state.assets) {
    if (!a.active) continue;
    const p = state.prices.get(key(a.address!));
    if (!p || now - p.publishTime > 120) continue;
    for (const { bucket, expiry } of ladderExpiries(now)) {
      let n = opt.counts[bucket];
      if (
        bucket === "hourly" &&
        opt.hourlyAssets.length &&
        !opt.hourlyAssets.includes(a.symbol)
      )
        n = 0;
      if (n <= 0) continue;
      const spacing = autoStrikeSpacing(
        p.priceUsd,
        e8ToUsd(a.strikeStep),
        a.volBps / 10_000,
        expiry - now,
        Math.max(n, 3)
      );
      const desired = strikesAround(p.priceE8, a.strikeStep, n, spacing);
      const lo = desired[0]! - a.strikeStep * BigInt(spacing);
      const hi = desired[desired.length - 1]! + a.strikeStep * BigInt(spacing);
      const existing = [...state.markets.values()].filter(
        (s) =>
          s.view.asset.equals(a.address!) &&
          s.view.expiry === expiry &&
          s.view.strike >= lo &&
          s.view.strike <= hi
      );
      if (existing.length >= n) continue;
      const have = new Set(existing.map((s) => s.view.strike.toString()));
      const missing = desired
        .filter(
          (k) =>
            !have.has(k.toString()) &&
            !state.markets.has(key(client.marketAddress(a.address!, k, expiry)))
        )
        .map((k) => ({
          asset: a,
          bucket,
          strike: k,
          expiry,
          dist: k > p.priceE8 ? k - p.priceE8 : p.priceE8 - k,
        }))
        .sort((x, y) => (x.dist < y.dist ? -1 : 1))
        .slice(0, n - existing.length);
      wants.push(...missing);
    }
  }
  if (!wants.length) return;
  // priority: weekly > daily > hourly (longer-lived markets first), then nearest to spot
  const prio: Record<LadderBucket, number> = { weekly: 0, daily: 1, hourly: 2 };
  wants.sort(
    (x, y) => prio[x.bucket] - prio[y.bucket] || (x.dist < y.dist ? -1 : 1)
  );
  let spentToday = createdLast24h(now);
  let createdThisHour = state.created.filter((c) => now - c.at < 3600).length;
  let bal = balance;
  for (const w of wants) {
    if (state.stopping) break;
    if (createdThisHour >= opt.maxNewMarketsPerHour) {
      log("roll_hourly_cap", {
        createdThisHour,
        maxNewMarketsPerHour: opt.maxNewMarketsPerHour,
      });
      break;
    }
    const cost = state.rentPerMarket;
    if (sol(spentToday + cost) > opt.maxSolPerDay) {
      log(
        "roll_budget_cap",
        {
          spentTodaySol: sol(spentToday),
          maxSolPerDay: opt.maxSolPerDay,
          pending: wants.length,
        },
        "warn"
      );
      break;
    }
    if (sol(bal - cost) < opt.minSol) {
      log(
        "roll_low_balance",
        { balanceSol: sol(bal), minSol: opt.minSol },
        "warn"
      );
      break;
    }
    const market = client.marketAddress(w.asset.address!, w.strike, w.expiry);
    const ixs = [
      client.ixCreateMarket(
        payer.publicKey,
        w.asset.address!,
        w.strike,
        w.expiry
      ),
    ];
    const quote =
      cfg.makerParams.enabled && w.expiry - now >= cfg.makerParams.minTte;
    if (quote)
      ixs.push(
        client.ixRefreshQuotes(market, w.asset.address!, w.asset.priceAccount)
      );
    try {
      // Reserve before broadcast: an ambiguous timeout must not reset the budget on restart.
      state.created.push({ at: nowS(), lamports: cost });
      saveBudget();
      createdThisHour++;
      const sig = await sendBatch(
        `create ${w.asset.symbol} ${w.bucket}`,
        ixs,
        quote ? 700_000 : 200_000
      );
      spentToday += cost;
      bal -= cost;
      if (!opt.dryRun) {
        const v = await withRetry("market", () => client.fetchMarket(market));
        if (v)
          state.markets.set(key(market), {
            address: market,
            view: v,
            lastRefresh: quote ? nowS() : 0,
            lastFairTick: 0,
            lastTradeCount: v.tradeCount,
            done: false,
            missedLogged: false,
          });
      }
      log("created", {
        symbol: w.asset.symbol,
        bucket: w.bucket,
        strike: formatE8(w.strike),
        expiry: fmtTime(w.expiry),
        market: key(market),
        quoted: quote,
        sig,
        spentTodaySol: sol(spentToday),
      });
    } catch (e) {
      hadFailures = true;
      log(
        "create_failed",
        {
          symbol: w.asset.symbol,
          strike: formatE8(w.strike),
          expiry: fmtTime(w.expiry),
          error: (e as Error).message,
          logs: (e as { logs?: string[] }).logs?.slice(-5),
        },
        "warn"
      );
    }
  }
}

// ───────────────────────── lifecycle ─────────────────────────

async function main() {
  log("keeper_start", {
    cluster: args.cluster,
    rpc: args.rpc,
    payer: payer.publicKey.toBase58(),
    dryRun: opt.dryRun,
    create: opt.create,
    ladder: opt.counts,
    hourlyAssets: opt.hourlyAssets,
    maxSolPerDay: opt.maxSolPerDay,
    maxNewMarketsPerHour: opt.maxNewMarketsPerHour,
    minSol: opt.minSol,
  });
  if (!(await withRetry("isDeployed", () => client.isDeployed())))
    throw new Error("program not deployed on this cluster");
  await loadStatic(true);
  const assetsForRent = state.assets.filter((a) => a.active).length;
  const perDay =
    (opt.counts.hourly *
      288 *
      (opt.hourlyAssets.length ? opt.hourlyAssets.length : assetsForRent) +
      opt.counts.daily * assetsForRent +
      (opt.counts.weekly * assetsForRent) / 7) *
    state.rentPerMarket;
  log("ladder_budget", {
    projectedSolPerDay: Number(sol(perDay).toFixed(3)),
    cappedAt: opt.maxSolPerDay,
    rentPerMarketSol: Number(sol(state.rentPerMarket).toFixed(5)),
  });
  await scanMarkets();
  await refreshPrices();
  await loadActiveFull();
  await settleOnce();
  log("markets_loaded", {
    markets: state.markets.size,
    assets: state.assets.map((a) => a.symbol),
  });

  const settle = opt.once ? Promise.resolve() : settleLoop();
  let backoff = opt.intervalMs;
  while (!state.stopping) {
    const t0 = Date.now();
    try {
      await tick();
      if (opt.once) {
        await settleOnce();
        await tick();
      }
      backoff = opt.intervalMs;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      hadFailures = true;
      log("tick_error", { error: msg.slice(0, 300) }, "error");
      if (/429|Too Many/i.test(msg)) backoff = Math.min(backoff * 2, 60_000);
    }
    if (opt.once) break;
    const wait = Math.max(250, backoff - (Date.now() - t0));
    for (let waited = 0; waited < wait && !state.stopping; waited += 250)
      await sleep(250);
  }
  state.stopping = true;
  await settle;
  log("keeper_stopped", {});
}

let sigints = 0;
process.on("SIGINT", () => {
  sigints++;
  if (sigints > 1) process.exit(130);
  log("shutdown_requested", {});
  state.stopping = true;
});
process.on("SIGTERM", () => {
  state.stopping = true;
});

main()
  .then(() => process.exit(opt.once && hadFailures ? 1 : 0))
  .catch((e) => {
    log("keeper_failed", { error: String((e as Error).message ?? e) }, "error");
    process.exit(1);
  });
