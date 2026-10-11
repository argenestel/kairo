/**
 * Solana devnet ChainAdapter (owner: sdk agent). Reads accounts over RPC through @montions/solana-sdk, signs with
 * Wallet Standard wallets (Phantom / Solflare / Backpack …) or a built-in "Devnet burner" keypair kept in
 * localStorage. All Solana classes come from the SDK so a single @solana/web3.js copy is used.
 */
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from '@wallet-standard/features';
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  MontionsClient,
  PublicKey,
  Transaction,
  TICKS,
  UNIT,
  bs58,
  e8ToUsd,
  estimateMakerLadder,
  friendlyError,
  ladderToBook,
  modelProbAbove,
  quoteBuy,
  selectableExpiries,
  strikesAround,
  usdToE8,
  type AssetView,
  type BuiltTx,
  type ConfigView,
  type MakerParamsView,
  type MarketView,
  type PythPriceView,
} from '@montions/solana-sdk';
import assetsConfig from '@montions/sol-config/assets.devnet.json';
import type {
  AssetInfo,
  Balances,
  BuyParams,
  BuyResult,
  ChainAdapter,
  ChainMeta,
  Direction,
  ExpiryOption,
  MarketInfo,
  Outcome,
  Position,
  Quote,
  TxResult,
  WalletOption,
} from './types';

// ───────────────────────────── options / constants ─────────────────────────────

export interface SolanaAdapterOptions {
  /** HTTP RPC (default: VITE_SOLANA_RPC or https://api.devnet.solana.com). */
  rpcUrl?: string;
  /** WebSocket RPC (default: derived from rpcUrl). */
  wsUrl?: string;
  /** localStorage key of the burner keypair. */
  burnerStorageKey?: string;
  /** Wallet-standard chain id used for signing requests. */
  chain?: `${string}:${string}`;
}

interface ConfigAsset {
  symbol: string;
  name: string;
  feedId: string;
  priceAccount: string;
  strikeStep: number;
  vol: number;
  maxConfBps: number;
  settleWindow: number;
}

const CONFIG_ASSETS: ConfigAsset[] = (assetsConfig as { assets: ConfigAsset[] }).assets;
const BURNER_ID = 'burner';
const KNOWN_WALLETS = ['Phantom', 'Solflare', 'Backpack'];
/** Rough SOL a user needs to create a market in the buy transaction (rent of market + 2 mints + vault + ATAs + fees). */
const CREATE_MARKET_SOL = 0.05;
/** Default maker params (init-devnet) used to estimate quotes before the program is initialised. */
const DEFAULT_MAKER: MakerParamsView = {
  enabled: true,
  levels: 3,
  levelSpacing: 2,
  minHalfSpread: 2,
  maxMarketExposure: 1_500n * UNIT,
  levelNotional: 50n * UNIT,
  minTte: 600,
  maxPriceAge: 60,
};

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const nowS = () => Math.floor(Date.now() / 1000);
const usd = (base: bigint) => Number(base) / 1e6;

type StandardWallet = Wallet & { features: Record<string, unknown> };

function hasFeature<F extends string>(w: Wallet, f: F): boolean {
  return Object.prototype.hasOwnProperty.call(w.features, f);
}

function isSolanaWallet(w: Wallet): boolean {
  return (
    w.chains.some((c) => c.startsWith('solana:')) &&
    hasFeature(w, StandardConnect) &&
    (hasFeature(w, SolanaSignTransaction) || hasFeature(w, SolanaSignAndSendTransaction))
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ───────────────────────────── adapter ─────────────────────────────

export function createSolanaAdapter(opts: SolanaAdapterOptions = {}): ChainAdapter {
  const rpcUrl = opts.rpcUrl ?? env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com';
  const wsUrl = opts.wsUrl ?? env.VITE_SOLANA_WS;
  const chain = opts.chain ?? 'solana:devnet';
  const burnerKey = opts.burnerStorageKey ?? 'montions:solana:burner';
  const connection = new Connection(rpcUrl, { commitment: 'confirmed', ...(wsUrl ? { wsEndpoint: wsUrl } : {}) });
  const client = new MontionsClient({ connection, commitment: 'confirmed' });
  const isDevnetRpc = /devnet/.test(rpcUrl);
  const clusterQuery = isDevnetRpc ? 'cluster=devnet' : `cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;

  const meta: ChainMeta = {
    id: 'solana-devnet',
    label: 'Solana',
    network: 'Devnet',
    collateralSymbol: 'tUSDC',
    nativeSymbol: 'SOL',
    oracleName: 'Pyth',
    settlementNote:
      'Settles on the Pyth price at expiry: anyone (our keeper, within seconds) submits a verified Pyth print from the first 60 s after expiry; YES iff price ≥ strike. Unresolved markets can be voided 50/50 after 24 h.',
    explorerTx: (sig) => `https://explorer.solana.com/tx/${sig}?${clusterQuery}`,
    explorerAddress: (addr) => `https://explorer.solana.com/address/${addr}?${clusterQuery}`,
  };

  // ── cached chain state ──

  const cache = {
    deployed: null as boolean | null,
    config: null as ConfigView | null,
    statusAt: 0,
    assets: [] as AssetView[],
    assetsAt: 0,
    prices: new Map<string, PythPriceView>(), // symbol → latest price
    markets: new Map<string, { at: number; list: MarketView[] }>(), // asset symbol → header list
  };

  /** Program deployed + config initialised? (cached 30 s) */
  async function status(force = false): Promise<{ deployed: boolean; config: ConfigView | null }> {
    if (!force && cache.deployed !== null && nowS() - cache.statusAt < 30) return { deployed: cache.deployed, config: cache.config };
    try {
      const [deployed, config] = await Promise.all([client.isDeployed(), client.fetchConfig().catch(() => null)]);
      cache.deployed = deployed;
      cache.config = deployed ? config : null;
    } catch {
      cache.deployed = cache.deployed ?? false;
    }
    cache.statusAt = nowS();
    return { deployed: !!cache.deployed, config: cache.config };
  }

  async function requireLive(): Promise<ConfigView> {
    const s = await status();
    if (!s.deployed) throw new Error('The Montions program is not deployed on Solana devnet yet.');
    if (!s.config) throw new Error('Montions is deployed but not initialised on Solana devnet yet.');
    return s.config;
  }

  /** On-chain assets (cached 60 s); falls back to config/assets.devnet.json when the program isn't live. */
  async function onchainAssets(): Promise<AssetView[]> {
    if (cache.assets.length && nowS() - cache.assetsAt < 60) return cache.assets;
    const s = await status();
    if (!s.config) return [];
    try {
      cache.assets = await client.fetchAssets();
      cache.assetsAt = nowS();
    } catch {
      /* keep stale */
    }
    return cache.assets;
  }

  function configAsset(symbol: string): ConfigAsset | undefined {
    return CONFIG_ASSETS.find((a) => a.symbol === symbol);
  }

  /** AssetView for a symbol: on-chain if listed, else synthesised from config (address = its PDA). */
  async function assetView(symbol: string): Promise<{ view: AssetView; onchain: boolean }> {
    const list = await onchainAssets();
    const found = list.find((a) => a.symbol === symbol);
    if (found) return { view: found, onchain: true };
    const c = configAsset(symbol);
    if (!c) throw new Error(`Unknown asset ${symbol}`);
    return {
      onchain: false,
      view: {
        address: client.assetAddress(symbol),
        symbol,
        feedId: c.feedId,
        priceAccount: new PublicKey(c.priceAccount),
        strikeStep: usdToE8(String(c.strikeStep)),
        volBps: Math.round(c.vol * 10_000),
        maxConfBps: c.maxConfBps,
        active: true,
        bump: 0,
        settleWindow: c.settleWindow,
        marketCount: 0,
      },
    };
  }

  async function latestPrice(symbol: string, maxAgeS = 10): Promise<PythPriceView | null> {
    const cached = cache.prices.get(symbol);
    if (cached && nowS() - cached.publishTime <= maxAgeS) return cached;
    const { view } = await assetView(symbol);
    const p = await client.fetchPrice(view.priceAccount).catch(() => null);
    if (p) cache.prices.set(symbol, p);
    return p ?? cached ?? null;
  }

  async function marketsOf(symbol: string, maxAgeS = 20): Promise<MarketView[]> {
    const c = cache.markets.get(symbol);
    if (c && nowS() - c.at < maxAgeS) return c.list;
    const s = await status();
    if (!s.config) return [];
    const { view, onchain } = await assetView(symbol);
    if (!onchain) return [];
    try {
      const list = await client.fetchMarkets({ asset: view.address!, headersOnly: true });
      cache.markets.set(symbol, { at: nowS(), list });
      return list;
    } catch {
      return c?.list ?? [];
    }
  }

  async function allMarkets(): Promise<MarketView[]> {
    const syms = (await onchainAssets()).map((a) => a.symbol);
    const lists = await Promise.all(syms.map((s) => marketsOf(s)));
    return lists.flat();
  }

  function symbolOfAsset(asset: PublicKey): string {
    const a = cache.assets.find((x) => x.address?.equals(asset));
    return a?.symbol ?? '?';
  }

  // ── wallets ──

  const wallets = (() => {
    try {
      return getWallets();
    } catch {
      return null;
    }
  })();

  let current:
    | { kind: 'burner'; keypair: Keypair }
    | { kind: 'standard'; wallet: StandardWallet; account: WalletAccount; offChange?: () => void }
    | null = null;
  const listeners = new Set<(address: string | null) => void>();

  function currentAddress(): string | null {
    if (!current) return null;
    return current.kind === 'burner' ? current.keypair.publicKey.toBase58() : current.account.address;
  }

  function emit() {
    const a = currentAddress();
    for (const cb of listeners) {
      try {
        cb(a);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  function owner(): PublicKey {
    const a = currentAddress();
    if (!a) throw new Error('Connect a wallet first');
    return new PublicKey(a);
  }

  function solanaWallets(): StandardWallet[] {
    return (wallets?.get() ?? []).filter(isSolanaWallet) as StandardWallet[];
  }

  function loadBurner(): Keypair {
    const st = storage();
    const raw = st?.getItem(burnerKey);
    if (raw) {
      try {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
      } catch {
        /* regenerate */
      }
    }
    const kp = Keypair.generate();
    st?.setItem(burnerKey, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }

  /** Sign + send + confirm with the connected wallet. Returns the signature. */
  async function sendBuilt(built: BuiltTx): Promise<string> {
    if (!current) throw new Error('Connect a wallet first');
    const tx = built.tx;
    const blockhash = built.blockhash ?? tx.recentBlockhash!;
    const lastValidBlockHeight = built.lastValidBlockHeight ?? (await connection.getBlockHeight('confirmed')) + 150;
    let signature: string;
    let raw: Uint8Array | null = null;
    try {
      if (current.kind === 'burner') {
        tx.sign(current.keypair);
        raw = tx.serialize();
        signature = await connection.sendRawTransaction(raw, { preflightCommitment: 'confirmed', maxRetries: 0 });
      } else {
        const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        const w = current.wallet;
        if (hasFeature(w, SolanaSignTransaction)) {
          const f = (w.features as unknown as SolanaSignTransactionFeature)[SolanaSignTransaction];
          const [out] = await f.signTransaction({ account: current.account, transaction: unsigned, chain });
          if (!out) throw new Error('Wallet returned no signed transaction');
          raw = out.signedTransaction;
          signature = await connection.sendRawTransaction(raw, { preflightCommitment: 'confirmed', maxRetries: 0 });
        } else {
          const f = (w.features as unknown as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
          const [out] = await f.signAndSendTransaction({
            account: current.account,
            transaction: unsigned,
            chain,
            options: { preflightCommitment: 'confirmed' },
          });
          if (!out) throw new Error('Wallet returned no signature');
          signature = bs58.encode(out.signature);
        }
      }
    } catch (e) {
      throw new Error(friendlyError(e));
    }
    // re-broadcast while waiting (public RPC drops transactions under load)
    let done = false;
    const rebroadcast = raw
      ? (async () => {
          while (!done) {
            await new Promise((r) => setTimeout(r, 2000));
            if (!done) await connection.sendRawTransaction(raw!, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
          }
        })()
      : Promise.resolve();
    try {
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (res.value.err) {
        const t = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
        throw new Error(friendlyError({ message: JSON.stringify(res.value.err), logs: t?.meta?.logMessages ?? [] }));
      }
    } finally {
      done = true;
      await rebroadcast;
    }
    return signature;
  }

  const txResult = (signature: string): TxResult => ({ signature, explorerUrl: meta.explorerTx(signature) });

  // ── helpers for quotes / markets ──

  function toMarketInfo(symbol: string, m: MarketView): MarketInfo {
    return {
      id: m.address!.toBase58(),
      symbol,
      strike: e8ToUsd(m.strike),
      expiry: m.expiry,
      status: m.statusName === 'resolved' ? 'resolved' : m.statusName === 'void' ? 'void' : 'open',
      ...(m.statusName === 'resolved' ? { outcome: (m.outcome === 1 ? 'yes' : 'no') as Outcome, settlePrice: e8ToUsd(m.settlePrice) } : {}),
      bids: m.bids.map((l) => ({ price: l.tick / TICKS, qty: Number(l.qty) })),
      asks: m.asks.map((l) => ({ price: l.tick / TICKS, qty: Number(l.qty) })),
      ...(m.lastTradeTick ? { lastPrice: m.lastTradeTick / TICKS } : {}),
      volume: Number(m.volume),
    };
  }

  const outcomeOf = (d: Direction): Outcome => (d === 'above' ? 'yes' : 'no');

  function emptyQuote(outcome: Outcome, budget: number, chance: number, reason: string, needsMarket = false): Quote {
    return { outcome, budget, contracts: 0, avgPrice: 0, limitPrice: 0, cost: 0, payout: 0, chance, needsMarket, tradable: false, reason };
  }

  // ── the adapter ──

  const adapter: ChainAdapter = {
    meta,

    async listAssets(): Promise<AssetInfo[]> {
      const onchain = await onchainAssets().catch(() => [] as AssetView[]);
      const symbols = onchain.length ? onchain.filter((a) => a.active).map((a) => a.symbol) : CONFIG_ASSETS.map((a) => a.symbol);
      const views = await Promise.all(symbols.map((s) => assetView(s).then((r) => r.view)));
      const prices = await client.fetchPrices(views.map((v) => v.priceAccount)).catch(() => views.map(() => null));
      return views.map((v, i) => {
        const p = prices[i] ?? cache.prices.get(v.symbol) ?? null;
        if (p) cache.prices.set(v.symbol, p);
        return {
          symbol: v.symbol,
          name: configAsset(v.symbol)?.name ?? v.symbol,
          price: p?.priceUsd ?? 0,
          priceTime: p?.publishTime ?? 0,
          strikeStep: e8ToUsd(v.strikeStep),
          vol: v.volBps / 10_000,
        };
      });
    },

    subscribePrices(onPrice) {
      const accounts = CONFIG_ASSETS.map((a) => ({ symbol: a.symbol, key: new PublicKey(a.priceAccount) }));
      let lastWs = 0;
      let stopped = false;
      const deliver = (symbol: string, p: PythPriceView) => {
        const prev = cache.prices.get(symbol);
        if (prev && prev.publishTime > p.publishTime) return;
        cache.prices.set(symbol, p);
        onPrice(symbol, p.priceUsd, p.publishTime);
      };
      const unsubs = accounts.map(({ symbol, key }) => {
        try {
          return client.subscribePrice(key, (p) => {
            lastWs = Date.now();
            deliver(symbol, p);
          });
        } catch {
          return () => {};
        }
      });
      // polling fallback: whenever the websocket has been silent for 10 s
      const poll = async () => {
        if (stopped || Date.now() - lastWs < 10_000) return;
        const ps = await client.fetchPrices(accounts.map((a) => a.key)).catch(() => []);
        ps.forEach((p, i) => p && deliver(accounts[i]!.symbol, p));
      };
      void poll();
      const timer = setInterval(() => void poll(), 5_000);
      return () => {
        stopped = true;
        clearInterval(timer);
        unsubs.forEach((u) => u());
      };
    },

    async strikes(symbol, spot) {
      const { view } = await assetView(symbol);
      let s = spot;
      if (!(s > 0)) s = (await latestPrice(symbol, 60))?.priceUsd ?? 0;
      if (!(s > 0)) return [];
      return strikesAround(usdToE8(s), view.strikeStep, 41).map((k) => e8ToUsd(k));
    },

    async expiries(symbol) {
      const now = nowS();
      const base = selectableExpiries(now, { minAhead: 15 * 60, days: 30 });
      const markets = await marketsOf(symbol).catch(() => [] as MarketView[]);
      const withMarkets = new Set(markets.filter((m) => m.statusName === 'open' && m.expiry > now).map((m) => m.expiry));
      const out = new Map<number, ExpiryOption>();
      for (const e of base) out.set(e.expiry, { expiry: e.expiry, hasMarkets: withMarkets.has(e.expiry), ...(e.tag ? { tag: e.tag } : {}) });
      // existing markets whose expiry is not on the default menu (e.g. user-created 5-min slots)
      for (const e of withMarkets) if (!out.has(e) && e > now + 60) out.set(e, { expiry: e, hasMarkets: true });
      return [...out.values()].sort((a, b) => a.expiry - b.expiry);
    },

    async getMarket(symbol, strike, expiry) {
      const s = await status();
      if (!s.config) return null;
      const { view, onchain } = await assetView(symbol);
      if (!onchain) return null;
      const m = await client.fetchMarketFor(view.address!, usdToE8(strike), expiry).catch(() => null);
      return m ? toMarketInfo(symbol, m) : null;
    },

    async quote(symbol, strike, expiry, direction, budget) {
      const outcome = outcomeOf(direction);
      const now = nowS();
      const { view } = await assetView(symbol);
      const price = await latestPrice(symbol);
      const strikeE8 = usdToE8(strike);
      const fair = price ? modelProbAbove(price.priceUsd, e8ToUsd(strikeE8), view.volBps / 10_000, expiry - now) : 0.5;
      const chance = outcome === 'yes' ? fair : 1 - fair;
      if (!(budget > 0)) return emptyQuote(outcome, budget, chance, 'Enter an amount');
      if (expiry <= now) return emptyQuote(outcome, budget, chance, 'Market closed');
      const s = await status();
      if (!s.deployed || !s.config) {
        // model-only preview with the default maker ladder
        const lad = estimateMakerLadder({ fair, tteSecs: expiry - now, params: DEFAULT_MAKER });
        const q = quoteBuy(ladderToBook(lad.quotes), outcome, budget, { slippageTicks: 2 });
        return {
          outcome,
          budget,
          contracts: Number(q.contracts),
          avgPrice: q.avgPrice,
          limitPrice: q.limitTick / TICKS,
          cost: usd(q.cost),
          payout: usd(q.payout),
          chance,
          needsMarket: true,
          tradable: false,
          reason: s.deployed ? 'Solana program not initialised yet' : 'Solana program not deployed yet',
        };
      }
      try {
        const r = await client.quoteBuyMarket({
          asset: (await assetView(symbol)).view,
          strike: strikeE8,
          expiry,
          outcome,
          budget,
          maxPrice: 0.99,
          config: s.config,
          ...(price ? { price } : {}),
          now,
        });
        const q = r.quote;
        const reason =
          q.contracts > 0n
            ? undefined
            : q.liquidity === 0n
              ? expiry - now < s.config.makerParams.minTte
                ? 'Too close to expiry for the market maker to quote'
                : 'No liquidity at this strike yet'
              : 'Budget too small for one contract';
        return {
          outcome,
          budget,
          contracts: Number(q.contracts),
          avgPrice: q.avgPrice,
          limitPrice: q.limitTick / TICKS,
          cost: usd(q.cost),
          payout: usd(q.payout),
          chance: r.fairProb === null ? chance : outcome === 'yes' ? r.fairProb : 1 - r.fairProb,
          needsMarket: r.needsMarket,
          tradable: q.contracts > 0n,
          ...(reason ? { reason } : {}),
        };
      } catch (e) {
        return emptyQuote(outcome, budget, chance, friendlyError(e));
      }
    },

    // ── wallet ──

    walletOptions(): WalletOption[] {
      const found = solanaWallets().map((w) => ({ id: w.name, name: w.name, icon: w.icon, installed: true }));
      const missing = KNOWN_WALLETS.filter((n) => !found.some((f) => f.name.toLowerCase().startsWith(n.toLowerCase()))).map((n) => ({
        id: n,
        name: n,
        installed: false,
      }));
      return [...found, { id: BURNER_ID, name: 'Devnet burner', installed: true }, ...missing];
    },

    async connect(walletId?: string) {
      const id = walletId ?? solanaWallets()[0]?.name ?? BURNER_ID;
      if (current?.kind === 'standard') current.offChange?.();
      if (id === BURNER_ID) {
        current = { kind: 'burner', keypair: loadBurner() };
        emit();
        return currentAddress()!;
      }
      const w = solanaWallets().find((x) => x.name === id);
      if (!w) throw new Error(`${id} wallet not found in this browser`);
      const { accounts } = await (w.features as unknown as StandardConnectFeature)[StandardConnect].connect();
      const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0];
      if (!account) throw new Error(`${w.name} returned no account`);
      let offChange: (() => void) | undefined;
      if (hasFeature(w, StandardEvents)) {
        offChange = (w.features as unknown as StandardEventsFeature)[StandardEvents].on('change', ({ accounts: next }) => {
          if (!next || current?.kind !== 'standard' || current.wallet !== w) return;
          const acc = next.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? next[0];
          if (!acc) {
            current = null;
          } else current = { ...current, account: acc };
          emit();
        });
      }
      current = { kind: 'standard', wallet: w, account, ...(offChange ? { offChange } : {}) };
      emit();
      return account.address;
    },

    async disconnect() {
      if (current?.kind === 'standard') {
        current.offChange?.();
        const w = current.wallet;
        if (hasFeature(w, StandardDisconnect)) {
          await (w.features as unknown as StandardDisconnectFeature)[StandardDisconnect].disconnect().catch(() => {});
        }
      }
      current = null;
      emit();
    },

    address: () => currentAddress(),

    onAccountChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async balances(): Promise<Balances> {
      const a = currentAddress();
      if (!a) return { native: 0, collateral: 0 };
      const pk = new PublicKey(a);
      const [lamports, coll] = await Promise.all([
        connection.getBalance(pk, 'confirmed').catch(() => 0),
        client.collateralBalance(pk).catch(() => 0n),
      ]);
      return { native: lamports / LAMPORTS_PER_SOL, collateral: usd(coll) };
    },

    async faucet(): Promise<TxResult> {
      const user = owner();
      // Gas: airdrop 1 SOL when low (devnet; rate-limited by the public faucet).
      const lamports = await connection.getBalance(user, 'confirmed').catch(() => 0);
      if (lamports < 0.05 * LAMPORTS_PER_SOL) {
        try {
          const sig = await connection.requestAirdrop(user, LAMPORTS_PER_SOL);
          const bh = await connection.getLatestBlockhash('confirmed');
          await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
        } catch (e) {
          if (lamports < 5_000_000) {
            throw new Error(
              `Devnet SOL airdrop failed (${friendlyError(e)}). Get devnet SOL at https://faucet.solana.com for ${user.toBase58()} and retry.`,
            );
          }
        }
      }
      const config = await requireLive();
      const claim = await client.fetchFaucetClaim(user).catch(() => null);
      if (claim && claim.lastClaim > 0) {
        const wait = claim.lastClaim + config.faucetCooldown - nowS();
        if (wait > 0) throw new Error(`Faucet cooldown: try again in ${Math.ceil(wait / 60)} min`);
      }
      const built = await client.buildFaucetTx(user);
      return txResult(await sendBuilt(built));
    },

    // ── trading ──

    async buy(p: BuyParams): Promise<BuyResult> {
      const user = owner();
      const config = await requireLive();
      const outcome = outcomeOf(p.direction);
      const { view, onchain } = await assetView(p.symbol);
      if (!onchain) throw new Error(`${p.symbol} is not listed on Solana devnet yet`);
      const price = await latestPrice(p.symbol, 5);
      const strike = usdToE8(p.strike);
      const [built, sol, coll] = await Promise.all([
        client.buildBuyTx({
          owner: user,
          asset: view,
          strike,
          expiry: p.expiry,
          outcome,
          budget: p.budget,
          // maxPrice = worst per-contract price accepted (IOC limit): it also caps the average.
          maxPrice: Math.max(0.01, Math.min(0.99, p.maxPrice)),
          config,
          ...(price ? { price } : {}),
        }),
        connection.getBalance(user, 'confirmed').catch(() => 0),
        client.collateralBalance(user).catch(() => 0n),
      ]);
      const needSol = (built.needsMarket ? CREATE_MARKET_SOL : 0.007) * LAMPORTS_PER_SOL;
      if (sol < needSol) {
        throw new Error(
          built.needsMarket
            ? `Creating this market needs ~${CREATE_MARKET_SOL} SOL of rent (you have ${(sol / LAMPORTS_PER_SOL).toFixed(3)}). Use the faucet or pick an expiry that already has markets.`
            : 'Not enough SOL for fees — use the faucet',
        );
      }
      if (coll < built.quote.escrow) {
        throw new Error(`Insufficient tUSDC: this order escrows $${usd(built.quote.escrow).toFixed(2)} (you have $${usd(coll).toFixed(2)}). Use the faucet.`);
      }
      const marketId = built.market.toBase58();
      const signature = await sendBuilt(built);
      cache.markets.delete(p.symbol);
      // contracts / cost from the PlaceResult return data; fall back to balance diffs
      let contracts = Number(built.quote.contracts);
      let cost = usd(built.quote.cost);
      const r = await client.fetchPlaceResult(signature).catch(() => null);
      if (r) {
        contracts = Number(outcome === 'yes' ? r.yesOut : r.noOut);
        const spent = built.quote.escrow - r.cashOut;
        cost = usd(spent > 0n ? spent : 0n);
      } else {
        const after = await client.collateralBalance(user).catch(() => null);
        if (after !== null && after <= coll) cost = usd(coll - after);
      }
      return { ...txResult(signature), marketId, contracts, cost };
    },

    async positions(): Promise<Position[]> {
      const a = currentAddress();
      if (!a) return [];
      const s = await status();
      if (!s.config) return [];
      const user = new PublicKey(a);
      const markets = await allMarkets();
      const pos = await client.positions(user, { markets });
      if (!pos.length) return [];
      // marks: full books of the markets we hold
      const uniq = [...new Map(pos.map((p) => [p.market.address!.toBase58(), p.market.address!])).values()];
      const full: (MarketView | null)[] = await client.fetchMarketsByAddress(uniq).catch(() => uniq.map(() => null));
      const fullBy = new Map(full.filter((m): m is MarketView => !!m).map((m) => [m.address!.toBase58(), m]));
      const now = nowS();
      return pos.map((p) => {
        const id = p.market.address!.toBase58();
        const m = fullBy.get(id) ?? p.market;
        const symbol = symbolOfAsset(m.asset);
        let mark: number;
        if (m.statusName === 'resolved') mark = (m.outcome === 1) === (p.outcome === 'yes') ? 1 : 0;
        else if (m.statusName === 'void') mark = 0.5;
        else {
          const bid = p.outcome === 'yes' ? m.bestBid : m.bestAsk ? TICKS - m.bestAsk : 0;
          if (bid > 0) mark = bid / TICKS;
          else {
            const pr = cache.prices.get(symbol);
            const asset = cache.assets.find((x) => x.address?.equals(m.asset));
            const f = pr && asset ? modelProbAbove(pr.priceUsd, e8ToUsd(m.strike), asset.volBps / 10_000, m.expiry - now) : 0.5;
            mark = p.outcome === 'yes' ? f : 1 - f;
          }
        }
        return {
          marketId: id,
          symbol,
          strike: e8ToUsd(m.strike),
          expiry: m.expiry,
          outcome: p.outcome,
          contracts: Number(p.contracts),
          mark,
          status: m.statusName === 'resolved' ? 'resolved' : m.statusName === 'void' ? 'void' : 'open',
          claimable: usd(p.claimable),
          ...(p.won !== undefined ? { won: p.won } : {}),
        } satisfies Position;
      });
    },

    async claim(marketId: string): Promise<TxResult> {
      const user = owner();
      await requireLive();
      const m = await client.fetchMarket(new PublicKey(marketId));
      if (!m) throw new Error('Market not found');
      const built = await client.buildClaimTx({ owner: user, market: m });
      const sig = await sendBuilt(built);
      cache.markets.clear();
      return txResult(sig);
    },

    async sell(marketId: string, outcome: Outcome, contracts: number, minPrice: number): Promise<TxResult> {
      const user = owner();
      const config = await requireLive();
      if (!(contracts > 0)) throw new Error('Nothing to sell');
      const built = await client.buildSellTx({
        owner: user,
        market: new PublicKey(marketId),
        outcome,
        contracts: BigInt(Math.floor(contracts)),
        minPrice: Math.max(0.01, Math.min(0.99, minPrice)),
        config,
      });
      return txResult(await sendBuilt(built));
    },
  };

  // a wallet extension registering late (after page load) → let the UI re-read walletOptions()
  wallets?.on('register', () => emit());

  return adapter;
}

export default createSolanaAdapter;
