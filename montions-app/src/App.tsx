import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { ExpiryOption } from './chains/types';
import { ChainProvider, useAsset, useChain } from './state/chain';
import { ModeProvider, useMode } from './state/mode';
import { ToastProvider } from './state/toast';
import { RouteProvider, useRoute } from './state/route';
import { UiCtx, useUi, type UiApi } from './state/ui';
import { canContinue, flowReducer, initialFlow, S, type FlowState } from './state/flow';
import { useCopy } from './copy';
import { useExpiries, useMedia, useStrikes } from './lib/hooks';
import { fmtPrice, fmtStrike } from './lib/format';
import { sigmaMove } from './lib/model';
import { NightScene } from './scene/NightScene';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UwuLayer } from './uwu/UwuLayer';
import { Header } from './components/Header';
import { SentenceBar } from './components/SentenceBar';
import { StepStage } from './components/StepStage';
import { WalletSheet } from './components/WalletSheet';
import { TicketsDrawer, usePositions } from './components/TicketsDrawer';
import { OfflineBanner, RpcBanner } from './components/OfflineBanner';
import { ArrowLeft, Enter } from './components/Icons';
import { AssetStep } from './steps/AssetStep';
import { DirectionStep } from './steps/DirectionStep';
import { StrikeStep } from './steps/StrikeStep';
import { ExpiryStep } from './steps/ExpiryStep';
import { AmountStep } from './steps/AmountStep';
import { TicketStep } from './steps/TicketStep';
import type { StepProps } from './steps/common';

const MarketsPage = lazy(() => import('./pages/MarketsPage'));
const PredictionsPage = lazy(() => import('./pages/PredictionsPage'));
const EventDetailPage = lazy(() => import('./pages/EventDetailPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export function App() {
  return (
    <ToastProvider>
      <ModeProvider>
        <ErrorBoundary>
          <ChainProvider>
            <RouteProvider>
              <AppShell />
            </RouteProvider>
          </ChainProvider>
        </ErrorBoundary>
      </ModeProvider>
    </ToastProvider>
  );
}

function AppShell() {
  const { route } = useRoute();
  const [wallet, setWallet] = useState<{ open: boolean; then?: (a: string) => void }>({ open: false });
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const positions = usePositions(ticketsOpen);
  const ui = useMemo<UiApi>(() => ({
    openWallet: (then) => setWallet({ open: true, then }),
    openTickets: () => setTicketsOpen(true),
    overlayOpen: wallet.open || ticketsOpen,
    ticketCount: positions.list?.length ?? 0,
  }), [wallet.open, ticketsOpen, positions.list?.length]);

  return (
    <UiCtx.Provider value={ui}>
      <a className="skip-link" href="#main">Skip to content</a>
      <OfflineBanner />
      <Suspense fallback={<PageSkeleton />}>
        {route.name === 'home' && <TicketFlow />}
        {route.name === 'markets' && <PageFrame><MarketsPage /></PageFrame>}
        {route.name === 'predictions' && <PageFrame uwuStep={0}><PredictionsPage /></PageFrame>}
        {route.name === 'event' && <PageFrame uwuStep={4}><EventDetailPage eventKey={route.key} /></PageFrame>}
        {route.name === 'notfound' && <PageFrame><NotFoundPage /></PageFrame>}
      </Suspense>
      <WalletSheet
        open={wallet.open}
        onClose={() => setWallet({ open: false })}
        onConnected={(a) => { const then = wallet.then; setWallet({ open: false }); then?.(a); }}
      />
      <TicketsDrawer open={ticketsOpen} onClose={() => setTicketsOpen(false)} positions={positions} />
    </UiCtx.Provider>
  );
}

function PageSkeleton() {
  return (
    <div className="app app--page">
      <Header />
      <main className="main" id="main">
        <div className="page__skel" aria-busy="true">
          <div className="skel-card skel-text" />
          <div className="skel-card skel-text" />
        </div>
      </main>
    </div>
  );
}

function PageFrame({ children, uwuStep = 0 }: { children: ReactNode; uwuStep?: number }) {
  const { mode } = useMode();
  const chain = useChain();
  const compact = useMedia('(max-width: 640px), (max-height: 760px)');
  const { overlayOpen } = useUi();
  const copy = useCopy();
  return (
    <>
      <NightScene mood="neutral" />
      {mode === 'uwu' && (
        <UwuLayer step={uwuStep} direction="above" phase="ready" chain={chain.key} compact={compact} />
      )}
      <div className="app app--page" inert={overlayOpen}>
        <Header />
        <RpcBanner />
        <main className="main" id="main">{children}</main>
        <footer className="foot">
          <span className="foot__left">
            <span className="foot__badge">{copy.footer.testnet}</span>
            <span className="hide-sm">{copy.footer.product}</span>
          </span>
          <span className="foot__note" title={chain.adapter?.meta.settlementNote}>
            {chain.adapter ? chain.adapter.meta.settlementNote : 'Loading network…'}
          </span>
        </footer>
      </div>
    </>
  );
}

function defaultExpiry(list: ExpiryOption[], now: number): number | null {
  if (!list.length) return null;
  const weekly = list.find((e) => e.hasMarkets && e.expiry - now >= 3 * 86400 && /week/i.test(e.tag ?? ''));
  if (weekly) return weekly.expiry;
  const live = list.find((e) => e.hasMarkets && e.expiry - now >= 86400);
  if (live) return live.expiry;
  const day = list.find((e) => e.expiry - now >= 86400);
  return (day ?? list[list.length - 1]).expiry;
}

function defaultStrike(strikes: number[], spot: number, vol: number, seconds: number, up: boolean): number | null {
  if (!strikes.length) return null;
  if (!(spot > 0)) return strikes[Math.floor(strikes.length / 2)];
  const m = Math.min(0.12, Math.max(0.01, 0.6 * sigmaMove(vol, seconds)));
  if (up) {
    const target = spot * (1 + m);
    return strikes.find((k) => k >= target) ?? strikes[strikes.length - 1];
  }
  const target = spot * (1 - m);
  const below = strikes.filter((k) => k <= target);
  return below.length ? below[below.length - 1] : strikes[0];
}

function TicketFlow() {
  const chain = useChain();
  const copy = useCopy();
  const { mode } = useMode();
  const { overlayOpen } = useUi();
  const [flow, dispatch] = useReducer(flowReducer, undefined, initialFlow);
  const compact = useMedia('(max-width: 640px), (max-height: 760px)');
  const asset = useAsset(flow.draft.symbol);
  const spot = asset?.price ?? 0;
  const strikes = useStrikes(flow.draft.symbol, spot);
  const expiries = useExpiries(flow.draft.symbol);
  const d = flow.draft;

  useEffect(() => {
    const list = expiries.data;
    if (!list || !list.length) return;
    if (d.expiry != null && list.some((e) => e.expiry === d.expiry)) return;
    if (d.expiry != null && flow.touched.expiry) {
      const near = list.reduce((b, e) => (Math.abs(e.expiry - d.expiry!) < Math.abs(b.expiry - d.expiry!) ? e : b), list[0]);
      dispatch({ type: 'set', patch: { expiry: near.expiry } });
      return;
    }
    const e = defaultExpiry(list, Date.now() / 1000);
    if (e != null) dispatch({ type: 'set', patch: { expiry: e } });
  }, [expiries.data, d.expiry, flow.touched.expiry]);

  useEffect(() => {
    const list = strikes.data;
    if (!list || !list.length || !asset || d.strike != null) return;
    const secs = (d.expiry ?? Date.now() / 1000 + 7 * 86400) - Date.now() / 1000;
    const k = defaultStrike(list, asset.price, asset.vol, secs, d.direction === 'above');
    if (k != null) dispatch({ type: 'set', patch: { strike: k } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strikes.data, d.strike, d.direction, d.expiry, asset?.symbol]);

  useEffect(() => {
    if (chain.loading || !chain.assets.length || !d.symbol) return;
    if (!chain.assets.some((a) => a.symbol === d.symbol)) dispatch({ type: 'reset' });
  }, [chain.loading, chain.assets, d.symbol]);

  const prevKey = useRef(chain.key);
  useEffect(() => {
    if (prevKey.current === chain.key) return;
    prevKey.current = chain.key;
    dispatch({ type: 'chainChanged' });
  }, [chain.key]);

  const ok = canContinue(flow, !chain.loading && chain.assets.length > 0);
  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const go = useCallback((i: number) => dispatch({ type: 'goto', step: i }), []);

  const flowRef = useRef<FlowState>(flow);
  flowRef.current = flow;
  const okRef = useRef(ok);
  okRef.current = ok;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || overlayOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const f = flowRef.current;
      if (e.key === 'Enter') {
        const isRadio = t?.getAttribute('role') === 'radio';
        if ((tag === 'BUTTON' || tag === 'A') && !isRadio) return;
        if (f.step < S.ticket && okRef.current) { e.preventDefault(); dispatch({ type: 'next' }); }
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        if (f.step > 0) { e.preventDefault(); dispatch({ type: 'back' }); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen]);

  const stepProps: StepProps = { flow, dispatch, asset, strikes, expiries, compact };
  const name = asset?.name ?? d.symbol ?? '';
  const step = asset?.strikeStep ?? 1;
  const heading: { title: string; sub: string } = (() => {
    switch (flow.step) {
      case S.asset: return { title: copy.steps.asset.title, sub: copy.steps.asset.sub };
      case S.direction: return { title: copy.steps.direction.title, sub: spot > 0 ? copy.steps.direction.subPrice(name, fmtPrice(spot)) : copy.steps.direction.subAsk(name) };
      case S.strike: return { title: copy.steps.strike.title(name), sub: copy.steps.strike.sub(d.symbol ?? '', d.direction) };
      case S.expiry: return { title: copy.steps.expiry.title, sub: d.strike != null ? copy.steps.expiry.sub(name, d.direction, fmtStrike(d.strike, step)) : '' };
      case S.amount: return { title: copy.steps.amount.title, sub: copy.steps.amount.sub };
      default: return { title: '', sub: '' };
    }
  })();

  const mood = flow.step >= S.direction ? (d.direction === 'above' ? 'up' : 'down') : 'neutral';
  const isTicket = flow.step === S.ticket;

  const body = (() => {
    switch (flow.step) {
      case S.asset: return <AssetStep {...stepProps} />;
      case S.direction: return <DirectionStep {...stepProps} />;
      case S.strike: return <StrikeStep {...stepProps} />;
      case S.expiry: return <ExpiryStep {...stepProps} />;
      case S.amount: return <AmountStep {...stepProps} />;
      default: return <TicketStep {...stepProps} />;
    }
  })();

  return (
    <>
      <NightScene mood={mood} />
      {mode === 'uwu' && (
        <UwuLayer step={flow.step} direction={d.direction} phase={flow.ticket.phase} chain={chain.key} compact={compact} />
      )}
      <div className={`app${isTicket ? ' app--ticket' : ''}`} inert={overlayOpen}>
        <Header
          step={flow.step}
          reached={flow.reached}
          onGo={go}
          onLogo={() => dispatch({ type: 'reset' })}
          busy={flow.ticket.phase === 'signing'}
          showDots={!isTicket}
        />
        <RpcBanner />
        <main className="main" id="main">
          {!isTicket && (
            <div className="intro">
              <StepStage k={flow.step} nav={flow.nav} className="stage--title">
                <h1 className="title">{heading.title}</h1>
                <p className="subtitle">{heading.sub}</p>
              </StepStage>
              <SentenceBar draft={d} asset={asset} step={flow.step} reached={flow.reached} onGo={go} />
            </div>
          )}
          <StepStage k={flow.step} nav={flow.nav} className="stage--body">
            {body}
          </StepStage>
        </main>
        {!isTicket && (
          <div className="cta">
            {flow.step > 0 && (
              <button className="back-btn" onClick={back} aria-label="Back (Esc)">
                <ArrowLeft size={18} />
              </button>
            )}
            <button className="continue-btn" onClick={next} disabled={!ok}>
              {flow.step === S.amount ? copy.cta.print : copy.cta.continue}
              <span className="continue-btn__key" aria-hidden><Enter size={13} /></span>
            </button>
          </div>
        )}
        <footer className="foot">
          <span className="foot__left">
            <span className="foot__badge">{copy.footer.testnet}</span>
            <span className="hide-sm">{copy.footer.product}</span>
          </span>
          <span className="foot__note" title={chain.adapter?.meta.settlementNote}>
            {chain.adapter ? chain.adapter.meta.settlementNote : 'Loading network…'}
          </span>
        </footer>
      </div>
    </>
  );
}
