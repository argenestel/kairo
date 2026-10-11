/**
 * Print protocol state: config, treasury, assets with live Pyth prices, markets with best bid/ask.
 * Usage: pnpm -C sdk status -- --cluster devnet|localnet [--rpc URL] [--assets SOL] [--all] (include settled)
 */
import {
  e8ToUsd,
  formatE8,
  formatUsdc,
  modelProbAbove,
  parseTokenAccount,
  type MarketView,
} from '../sdk/src/index.js';
import { flagStr, fmtDur, fmtTime, log, makeClient, parseArgs, withRetry } from './lib.js';

const args = parseArgs();
const client = makeClient(args);
const conn = client.connection;

async function main() {
  const now = Math.floor(Date.now() / 1000);
  console.log(`cluster ${args.cluster} · rpc ${args.rpc} · program ${client.programId.toBase58()}`);
  const deployed = await withRetry('isDeployed', () => client.isDeployed());
  console.log(`program deployed: ${deployed}`);
  if (!deployed) return;
  const config = await withRetry('config', () => client.fetchConfig());
  if (!config) {
    console.log('config: NOT INITIALISED (run init-devnet)');
    return;
  }
  const tInfo = await withRetry('treasury', () => conn.getAccountInfo(config.treasury));
  const mp = config.makerParams;
  console.log(
    `config: admin ${config.admin.toBase58()} · fee ${config.feeBps} bps · paused ${config.paused} · faucet ${formatUsdc(config.faucetAmount)} / ${config.faucetCooldown}s · markets ${config.marketCount}`,
  );
  console.log(
    `maker: enabled ${mp.enabled} · levels ${mp.levels} spacing ${mp.levelSpacing} half-spread ${mp.minHalfSpread} · level ${formatUsdc(mp.levelNotional)} · max/market ${formatUsdc(mp.maxMarketExposure)} · min_tte ${mp.minTte}s · max_age ${mp.maxPriceAge}s`,
  );
  console.log(`collateral mint ${config.collateralMint.toBase58()} · treasury ${config.treasury.toBase58()} = ${tInfo ? formatUsdc(parseTokenAccount(tInfo.data).amount) : 'missing'}`);

  const filter = flagStr(args, 'assets', '').toUpperCase().split(',').filter(Boolean);
  let assets = await withRetry('assets', () => client.fetchAssets());
  if (filter.length) assets = assets.filter((a) => filter.includes(a.symbol));
  const prices = await withRetry('prices', () => client.fetchPrices(assets.map((a) => a.priceAccount)));
  console.log('\nassets:');
  assets.forEach((a, i) => {
    const p = prices[i];
    console.log(
      `  ${a.symbol.padEnd(5)} ${p ? `$${formatE8(p.priceE8, 6).padEnd(14)} ±${formatE8(p.confE8, 6).padEnd(10)} age ${now - p.publishTime}s` : 'no price'.padEnd(40)} step $${formatE8(a.strikeStep)} vol ${(a.volBps / 100).toFixed(0)}% conf≤${a.maxConfBps}bps window ${a.settleWindow}s ${a.active ? '' : 'INACTIVE'} markets ${a.marketCount}`,
    );
  });

  const markets = await withRetry('markets', () => client.fetchMarkets());
  const show = args.flags.has('all') ? markets : markets.filter((m) => m.statusName === 'open');
  const bySym = new Map(assets.map((a, i) => [a.address!.toBase58(), { a, p: prices[i] }]));
  console.log(`\nmarkets: ${markets.length} total, ${markets.filter((m) => m.statusName === 'open').length} open (${markets.filter((m) => m.statusName === 'open' && m.expiry <= now).length} awaiting settlement)`);
  const row = (m: MarketView) => {
    const ap = bySym.get(m.asset.toBase58());
    if (!ap) return;
    const fair = ap.p ? modelProbAbove(ap.p.priceUsd, e8ToUsd(m.strike), ap.a.volBps / 10_000, m.expiry - now) : null;
    const makerSeat = m.seats.find((s) => s.owner.equals(config.maker));
    const st = m.statusName === 'open' ? (m.expiry <= now ? 'EXPIRED' : 'open') : m.statusName === 'resolved' ? `res:${m.outcome ? 'YES' : 'NO'}@${formatE8(m.settlePrice, 4)}` : m.statusName;
    console.log(
      `  ${ap.a.symbol.padEnd(5)} ≥ ${formatE8(m.strike).padEnd(10)} ${fmtTime(m.expiry)} (${fmtDur(m.expiry - now).padStart(6)}) ${st.padEnd(20)} bid ${String(m.bestBid || '-').padStart(2)} / ask ${String(m.bestAsk || '-').padStart(2)}  fair ${fair === null ? '-' : (fair * 100).toFixed(1).padStart(5)}  vol ${String(m.volume).padStart(5)}  OI ${String(m.yesTotal).padStart(5)}  maker ${makerSeat ? `${formatUsdc(makerSeat.cash + makerSeat.locked)} ${makerSeat.openOrders} ord` : '-'}  ${m.address!.toBase58()}`,
    );
  };
  show.forEach(row);
}

main().catch((e) => {
  log('status_failed', { error: String((e as Error).message ?? e) }, 'error');
  process.exit(1);
});
