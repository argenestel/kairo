/**
 * Initialise Montions on a cluster (idempotent):
 *   1. initialize(config, tUSDC mint, maker, treasury) with devnet params (or set_params with --update-params),
 *   2. add the 6 assets from config/assets.devnet.json (or set_asset with --update-assets),
 *   3. top the maker treasury up to --treasury tUSDC (default 1,000,000).
 *
 * Usage: pnpm -C sdk init-devnet -- --cluster devnet|localnet [--rpc URL] [--keypair PATH] [--yes]
 *        [--treasury 1000000] [--update-params] [--update-assets] [--fee-bps 0]
 */
import {
  PublicKey,
  UNIT,
  ata,
  decodePythPrice,
  formatE8,
  formatUsdc,
  parseTokenAccount,
  usdToE8,
  type InitParamsInput,
  type TransactionInstruction,
} from '../sdk/src/index.js';
import {
  confirmPrompt,
  flagNum,
  loadAssetConfig,
  loadKeypair,
  log,
  makeClient,
  parseArgs,
  sendIxs,
  sol,
  withRetry,
} from './lib.js';

const args = parseArgs();
const client = makeClient(args);
const conn = client.connection;
const admin = loadKeypair(args.keypairPath);

const params: InitParamsInput = {
  feeBps: flagNum(args, 'fee-bps', 0),
  faucetAmount: BigInt(flagNum(args, 'faucet', 1_000)) * UNIT,
  faucetCooldown: flagNum(args, 'faucet-cooldown', 600),
  makerParams: {
    enabled: true,
    levels: flagNum(args, 'levels', 3),
    levelSpacing: flagNum(args, 'level-spacing', 2),
    minHalfSpread: flagNum(args, 'min-half-spread', 2),
    levelNotional: BigInt(flagNum(args, 'level-notional', 50)) * UNIT,
    maxMarketExposure: BigInt(flagNum(args, 'max-market-exposure', 1_500)) * UNIT,
    minTte: flagNum(args, 'min-tte', 600),
    maxPriceAge: flagNum(args, 'max-price-age', 60),
  },
};
const treasuryTarget = BigInt(flagNum(args, 'treasury', 1_000_000)) * UNIT;

async function main() {
  log('init_start', { cluster: args.cluster, rpc: args.rpc, admin: admin.publicKey.toBase58(), program: client.programId.toBase58() });
  if (!(await withRetry('isDeployed', () => client.isDeployed()))) {
    throw new Error(`program ${client.programId.toBase58()} is not deployed on ${args.cluster} (${args.rpc})`);
  }
  const balance = await withRetry('balance', () => conn.getBalance(admin.publicKey));
  log('admin_balance', { sol: sol(balance) });

  // 1. config
  const ixs: { label: string; ix: TransactionInstruction; cu?: number }[] = [];
  let config = await withRetry('config', () => client.fetchConfig());
  if (!config) {
    ixs.push({ label: 'initialize', ix: client.ixInitialize(admin.publicKey, params), cu: 200_000 });
  } else {
    log('config_exists', {
      admin: config.admin.toBase58(),
      feeBps: config.feeBps,
      paused: config.paused,
      faucet: formatUsdc(config.faucetAmount),
      cooldown: config.faucetCooldown,
      maker: { ...config.makerParams, maxMarketExposure: formatUsdc(config.makerParams.maxMarketExposure), levelNotional: formatUsdc(config.makerParams.levelNotional) },
      markets: config.marketCount,
    });
    if (!config.admin.equals(admin.publicKey)) throw new Error('the loaded keypair is not the config admin');
    if (args.flags.has('update-params')) {
      ixs.push({
        label: 'set_params',
        ix: client.ixSetParams(admin.publicKey, {
          feeBps: params.feeBps,
          faucetAmount: params.faucetAmount,
          faucetCooldown: params.faucetCooldown,
          makerParams: params.makerParams,
        }),
      });
    }
  }

  // 2. assets
  const wanted = loadAssetConfig();
  const existing = await withRetry('assets', () => client.fetchAccounts(wanted.map((a) => client.assetAddress(a.symbol))));
  const prices = await withRetry('prices', () => client.fetchAccounts(wanted.map((a) => new PublicKey(a.priceAccount))));
  wanted.forEach((a, i) => {
    const priceInfo = prices[i];
    let priceNote = 'missing';
    if (priceInfo) {
      const p = decodePythPrice(priceInfo.data);
      if (p.feedId !== a.feedId.replace(/^0x/, '').toLowerCase()) throw new Error(`${a.symbol}: price account feed id mismatch`);
      priceNote = `$${formatE8(p.priceE8, 6)} (${Math.floor(Date.now() / 1000) - p.publishTime}s old)`;
    }
    const input = {
      symbol: a.symbol,
      feedId: a.feedId,
      strikeStep: usdToE8(String(a.strikeStep)),
      volBps: Math.round(a.vol * 10_000),
      maxConfBps: a.maxConfBps,
      settleWindow: a.settleWindow,
    };
    if (!existing[i]) {
      log('asset_plan', { symbol: a.symbol, strikeStepE8: input.strikeStep, volBps: input.volBps, price: priceNote });
      ixs.push({ label: `add_asset ${a.symbol}`, ix: client.ixAddAsset(admin.publicKey, input, new PublicKey(a.priceAccount)) });
    } else {
      log('asset_exists', { symbol: a.symbol, price: priceNote });
      if (args.flags.has('update-assets')) {
        ixs.push({
          label: `set_asset ${a.symbol}`,
          ix: client.ixSetAsset(admin.publicKey, a.symbol, {
            volBps: input.volBps,
            maxConfBps: input.maxConfBps,
            settleWindow: input.settleWindow,
            strikeStep: input.strikeStep,
            active: true,
          }),
        });
      }
    }
  });

  // 3. treasury top-up (needs config to exist; computed after step 1 is executed)
  const plan = ixs.map((x) => x.label);
  if (!(await confirmPrompt(args, `Planned: ${plan.length ? plan.join(', ') : 'nothing for config/assets'}; then top up the treasury to ${formatUsdc(treasuryTarget)}.`))) return;

  for (const { label, ix, cu } of ixs) {
    const sig = await sendIxs(client, admin, [ix], { label, computeUnits: cu ?? 120_000, dryRun: args.dryRun });
    log('sent', { label, sig });
  }

  config = await withRetry('config', () => client.fetchConfig());
  if (!config) {
    if (args.dryRun) return;
    throw new Error('config still missing after initialize');
  }
  const tInfo = await withRetry('treasury', () => conn.getAccountInfo(config!.treasury));
  const tBal = tInfo ? parseTokenAccount(tInfo.data).amount : 0n;
  if (tBal < treasuryTarget) {
    const amount = treasuryTarget - tBal;
    const sig = await sendIxs(client, admin, [client.ixMintCollateral(admin.publicKey, config.treasury, amount)], {
      label: 'mint_collateral treasury',
      computeUnits: 60_000,
      dryRun: args.dryRun,
    });
    log('treasury_funded', { minted: formatUsdc(amount), sig });
  } else log('treasury_ok', { balance: formatUsdc(tBal) });

  if (args.flags.has('admin-mint')) {
    const amount = BigInt(flagNum(args, 'admin-mint', 10_000)) * UNIT;
    const { createAssociatedTokenAccountIdempotentInstruction } = await import('../sdk/src/index.js');
    const dest = ata(client.collateralMint, admin.publicKey);
    const sig = await sendIxs(
      client,
      admin,
      [
        createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, dest, admin.publicKey, client.collateralMint),
        client.ixMintCollateral(admin.publicKey, dest, amount),
      ],
      { label: 'mint_collateral admin', computeUnits: 80_000, dryRun: args.dryRun },
    );
    log('admin_funded', { minted: formatUsdc(amount), sig });
  }

  const after = await withRetry('balance', () => conn.getBalance(admin.publicKey));
  log('init_done', { solSpent: sol(balance - after), solLeft: sol(after), collateralMint: client.collateralMint.toBase58(), treasury: config.treasury.toBase58() });
}

main().catch((e) => {
  log('init_failed', { error: String((e as Error).message ?? e), logs: (e as { logs?: string[] }).logs?.slice(-12) }, 'error');
  process.exit(1);
});
