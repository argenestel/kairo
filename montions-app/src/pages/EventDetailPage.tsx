import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BuyResult, EventInfo, EventQuote, Outcome, Position } from '../chains/types';
import { useChain } from '../state/chain';
import { useToast } from '../state/toast';
import { useUi } from '../state/ui';
import { Link } from '../state/route';
import { useCopy } from '../copy';
import { ensureConnected, eventSource, noAsk, yesAsk } from '../lib/events';
import { humanError } from '../lib/errors';
import { fmtCents, fmtClock, fmtContracts, fmtCountdown, fmtDayFull, fmtMoney, fmtPct, fmtVolume } from '../lib/format';
import { useNow, useReducedMotion } from '../lib/hooks';
import { BookDisclosure, BookPanel } from '../components/BookPanel';
import { ChainGlyph, Check, External, Logo, Plus, Share, Spinner, XLogo } from '../components/Icons';
import { QR } from '../components/QR';
import { FundsHint } from '../components/OfflineBanner';
import './predictions/predictions.css';

type Phase = 'pick' | 'printing' | 'ready' | 'signing' | 'placed' | 'error';

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

function eventProbability(event: EventInfo): number | undefined {
  const midpoint = event.bestBid != null && event.bestAsk != null
    ? (event.bestBid + event.bestAsk) / 2
    : event.lastPrice ?? yesAsk(event) ?? (event.bestBid != null ? event.bestBid : undefined);
  return midpoint == null ? undefined : clampProbability(midpoint);
}

function DemoBadge() {
  return <span className="predictions-page__demo"><span className="predictions-page__demo-dot" />Demo only</span>;
}

function ChainBadge({ label, chain }: { label: string; chain: ReturnType<typeof useChain>['key'] }) {
  return <span className="chain-badge"><ChainGlyph chain={chain} size={13} />{label}</span>;
}

type TimelineState = 'done' | 'current' | 'upcoming';
interface TimelineStage { label: string; detail: string; state: TimelineState }

function timelineStages(event: EventInfo, now: number): TimelineStage[] {
  const closed = event.closeTime <= now || event.status !== 'open';
  const final = event.status === 'resolved' || event.status === 'void';
  const disputed = event.status === 'disputed';
  const proposed = event.status === 'proposed' || disputed || final;
  return [
    { label: 'Close', detail: event.closeTime > now && event.status === 'open' ? `Trading closes ${fmtDayFull(event.closeTime)}` : 'Trading is closed', state: closed ? 'done' : 'current' },
    { label: 'Propose', detail: 'Resolver posts an outcome after close', state: final || disputed ? 'done' : proposed ? 'current' : 'upcoming' },
    { label: 'Challenge', detail: 'Challenge window · length set by resolver', state: final ? 'done' : disputed ? 'current' : 'upcoming' },
    { label: 'Resolved', detail: final ? `Final result: ${event.status === 'void' ? 'VOID' : event.outcome?.toUpperCase() ?? 'posted'}` : 'Final outcome after the challenge window', state: final ? 'current' : 'upcoming' },
  ];
}

function PositionRow({ position }: { position: Position }) {
  const side = position.outcome.toUpperCase();
  return (
    <div className="event-position">
      <span className={`event-position__side event-position__side--${position.outcome}`}>{side}</span>
      <span className="event-position__size num">{fmtContracts(position.contracts)} contracts</span>
      <span className="event-position__mark num">Mark {fmtPct(position.mark)} · {position.status}</span>
    </div>
  );
}

function outcomeFromUrl(): Outcome {
  if (typeof location === 'undefined') return 'yes';
  return new URLSearchParams(location.search).get('outcome') === 'no' ? 'no' : 'yes';
}

export default function EventDetailPage({ eventKey }: { eventKey: string }) {
  const chain = useChain();
  const src = eventSource(chain.adapter);
  const sourceAdapter = src.adapter;
  const demoOnly = src.demo || Boolean(chain.demo) || sourceAdapter.meta.id === 'mock';
  const { openWallet } = useUi();
  const toast = useToast();
  const [event, setEvent] = useState<EventInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(outcomeFromUrl);
  const [budget, setBudget] = useState(100);
  const [phase, setPhase] = useState<Phase>('pick');
  const [quote, setQuote] = useState<EventQuote | null>(null);
  const [result, setResult] = useState<BuyResult | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    let live = true;
    setEvent(undefined);
    setError(null);
    setPhase('pick');
    setResult(undefined);
    setErr(null);
    setQuote(null);
    setOutcome(outcomeFromUrl());
    const load = sourceAdapter.listEvents?.() ?? Promise.resolve([]);
    load.then(
      (xs) => {
        if (!live) return;
        setEvent(xs.find((e) => e.key === eventKey || e.id === eventKey) ?? null);
      },
      (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [sourceAdapter, eventKey, chain.epoch]);

  useEffect(() => {
    if (!event || phase === 'placed' || !sourceAdapter.quoteEvent) {
      setQuote(null);
      return;
    }
    let live = true;
    sourceAdapter.quoteEvent(event.id, outcome, budget).then(
      (q) => { if (live) setQuote(q); },
      () => { if (live) setQuote(null); },
    );
    return () => { live = false; };
  }, [sourceAdapter, event, outcome, budget, phase]);

  useEffect(() => {
    if (!event || !chain.address || !sourceAdapter.positions) {
      setPositions([]);
      return;
    }
    let live = true;
    sourceAdapter.positions().then((all) => {
      if (!live) return;
      setPositions(all.filter((position) => position.kind === 'event' && (position.marketId === event.id || position.symbol === event.key)));
    }, () => { if (live) setPositions([]); });
    return () => { live = false; };
  }, [sourceAdapter, event, chain.address, chain.positionsVersion]);

  async function buy() {
    if (!event || !sourceAdapter.buyEvent || !sourceAdapter.quoteEvent) return;
    setPhase('signing');
    setErr(null);
    const id = toast({ text: 'Confirm in your wallet…', tone: 'wait', sticky: true });
    try {
      if (demoOnly) await ensureConnected(sourceAdapter);
      const q = await sourceAdapter.quoteEvent(event.id, outcome, budget);
      if (!q.tradable) throw new Error(q.reason ?? 'Not tradable');
      toast.update(id, { text: 'Transaction sent…', tone: 'wait', sticky: true });
      const r = await sourceAdapter.buyEvent(event.id, outcome, budget, Math.min(0.99, q.avgPrice + 0.02));
      setResult(r);
      setQuote(q);
      setPhase('placed');
      toast.update(id, {
        text: demoOnly ? 'Demo ticket placed' : 'Confirmed',
        tone: 'ok', sticky: false,
        href: r.explorerUrl || undefined, hrefLabel: 'Explorer',
      });
      chain.bumpPositions();
      chain.refreshBalances();
    } catch (e) {
      const msg = humanError(e);
      setErr(msg);
      setPhase('error');
      toast.update(id, { text: msg, tone: 'error', sticky: false });
    }
  }

  function sign() {
    if (!demoOnly && !chain.address) {
      openWallet(() => { void buy(); });
      return;
    }
    void buy();
  }

  if (error) {
    return <div className="page event-detail-page"><div className="predictions-error"><b>Prediction unavailable</b><span>{error}</span></div></div>;
  }
  if (event === undefined) {
    return <div className="page event-detail-page"><div className="predictions-skeleton" aria-busy="true"><div className="predictions-skeleton__card skel-card" /></div></div>;
  }
  if (!event) {
    return (
      <div className="page event-detail-page page--404">
        <h1 className="title">This prediction isn’t listed</h1>
        <p className="subtitle">It may have resolved, or this chain doesn’t carry it.</p>
        <Link to="/predictions" className="continue-btn" style={{ width: 'auto', padding: '0 22px' }}>All predictions</Link>
      </div>
    );
  }

  if (phase !== 'pick') {
    return (
      <EventTicket
        event={event}
        outcome={outcome}
        budget={budget}
        quote={quote}
        phase={phase}
        result={result}
        error={err}
        demo={demoOnly}
        needWallet={!demoOnly && !chain.address}
        onBack={() => { setPhase('pick'); setErr(null); }}
        onPrinted={() => setPhase((p) => (p === 'printing' ? 'ready' : p))}
        onSign={sign}
      />
    );
  }

  return (
    <EventPick
      event={event}
      demo={demoOnly}
      outcome={outcome}
      budget={budget}
      quote={quote}
      positions={positions}
      onOutcome={setOutcome}
      onBudget={setBudget}
      onPrint={() => setPhase('printing')}
    />
  );
}

function EventPick({ event, demo, outcome, budget, quote, positions, onOutcome, onBudget, onPrint }: {
  event: EventInfo; demo: boolean; outcome: Outcome; budget: number; quote: EventQuote | null; positions: Position[];
  onOutcome: (o: Outcome) => void; onBudget: (n: number) => void; onPrint: () => void;
}) {
  const copy = useCopy();
  const chain = useChain();
  const now = useNow(1000);
  const y = yesAsk(event);
  const n = noAsk(event);
  const probability = eventProbability(event);
  const noProbability = probability == null ? undefined : 1 - probability;
  const probabilityStyle = probability == null ? undefined : { '--yes-share': `${probability * 100}%` } as CSSProperties;
  const closed = event.status !== 'open' || event.closeTime <= now;
  const stages = timelineStages(event, now);
  const buyLabel = quote?.tradable ? (demo ? 'Review demo ticket' : 'Review & place ticket') : closed ? 'Market closed' : 'Waiting for liquidity';

  return (
    <div className="page event-detail-page">
      <div className="event-detail__crumb"><Link to="/predictions">Predictions</Link><span>/</span><span>{titleCase(event.category)}</span></div>
      <header className="event-detail__header">
        <span className="event-detail__icon" aria-hidden>{event.icon ?? '◈'}</span>
        <div className="event-detail__meta">
          <span className="category-badge">{titleCase(event.category)}</span>
          <ChainBadge chain={chain.key} label={`${chain.entry.short} · ${chain.entry.network}`} />
          {demo && <DemoBadge />}
          <span className={`status-badge status-badge--${event.status}`}>{event.status}</span>
        </div>
        <span className="event-detail__eyebrow">Prediction market</span>
        <h1>{event.question}</h1>
        <p>{copy.predictions.closes} {fmtDayFull(event.closeTime)} · <strong>{fmtCountdown(event.closeTime, now)}</strong> · {fmtVolume(event.volume)} traded</p>
      </header>

      <div className="event-detail__grid">
        <div className="event-detail__main">
          <section className="event-detail__panel glass" aria-labelledby="market-outlook">
            <div className="event-detail__panel-head"><div><h2 id="market-outlook">Market outlook</h2><small>Probability implied by the current YES/NO book</small></div><span className="status-badge status-badge--open">Live quote</span></div>
            <div className="event-probability">
              <div className="event-probability__big"><b>{probability == null ? '—' : fmtPct(probability)}</b><span>YES chance</span></div>
              <div className="event-probability__detail">
                <div className={`probability-bar${probability == null ? ' is-unknown' : ''}`} style={probabilityStyle} aria-label={probability == null ? 'Probability unavailable' : `YES ${fmtPct(probability)}, NO ${fmtPct(noProbability!)}`}><span className="probability-bar__yes" /><span className="probability-bar__no" /></div>
                <div className="probability-readout__ends"><b>YES {probability == null ? '—' : fmtPct(probability)} · {y != null ? fmtCents(y) : '—'}</b><b>NO {noProbability == null ? '—' : fmtPct(noProbability)} · {n != null ? fmtCents(n) : '—'}</b></div>
              </div>
            </div>
          </section>

          <section className="event-detail__panel glass" aria-labelledby="rules-heading">
            <div className="event-detail__panel-head"><div><h2 id="rules-heading">{copy.predictions.rules}</h2><small>Verbatim market criteria</small></div></div>
            <blockquote className="event-rules-copy">{event.rules}</blockquote>
            <div className="event-rules-source"><span>{copy.predictions.source}</span><a href={event.resolutionSource} target="_blank" rel="noreferrer">{event.resolutionSource}</a></div>
          </section>

          <section className="event-detail__panel glass" aria-labelledby="timeline-heading">
            <div className="event-detail__panel-head"><div><h2 id="timeline-heading">Resolution timeline</h2><small>Optimistic resolver flow · challenge timing is protocol-defined</small></div></div>
            <ol className="event-timeline">
              {stages.map((stage) => <li key={stage.label} className={`event-timeline__step is-${stage.state}`}><span className="event-timeline__dot" aria-hidden /><b>{stage.label}</b><span>{stage.detail}</span></li>)}
            </ol>
          </section>

          <section className="event-detail__panel event-book glass" aria-labelledby="book-heading">
            <div className="event-book__head"><div><h2 id="book-heading">Current book & history</h2><small>YES depth, implied NO prices, and recent trades</small></div></div>
            <BookPanel market={{ id: event.id, symbol: event.key, strike: 0, expiry: event.closeTime, kind: 'event' }} hideHead />
          </section>

          <section className="event-detail__panel event-positions glass" aria-labelledby="positions-heading">
            <div className="event-positions__head"><div><h2 id="positions-heading">Your position</h2><small>Open tickets for this question</small></div></div>
            {positions.length ? <div className="event-positions__list">{positions.map((position) => <PositionRow key={`${position.marketId}-${position.outcome}`} position={position} />)}</div> : <p className="event-positions__empty">Connect a wallet and place a ticket to see your position here.</p>}
          </section>
        </div>

        <aside className="event-buy glass" aria-labelledby="buy-heading">
          <div className="event-buy__head"><div><h2 id="buy-heading">Buy a contract</h2><small>One winning contract pays $1</small></div><span className="event-buy__venue"><ChainGlyph chain={chain.key} size={12} /> {chain.entry.short}</span></div>
          <div className="event-buy__sides" role="group" aria-label="Choose an outcome">
            <button type="button" className={`event-buy__side event-buy__side--yes${outcome === 'yes' ? ' is-on' : ''}`} onClick={() => onOutcome('yes')} disabled={closed}><b>{copy.predictions.yes}</b><strong>{y != null ? fmtCents(y) : '—'}</strong></button>
            <button type="button" className={`event-buy__side event-buy__side--no${outcome === 'no' ? ' is-on' : ''}`} onClick={() => onOutcome('no')} disabled={closed}><b>{copy.predictions.no}</b><strong>{n != null ? fmtCents(n) : '—'}</strong></button>
          </div>
          <label className="event-buy__amount"><span className="event-buy__label">Amount at risk</span><span className="event-buy__input-wrap"><span className="event-buy__currency">$</span><input className="event-buy__input num" type="number" min="1" max="10000" step="1" value={budget} onChange={(input) => onBudget(Math.max(1, Math.min(10000, Number(input.target.value) || 1)))} /></span><span className="event-buy__quick">{[25, 50, 100, 250].map((amount) => <button key={amount} type="button" onClick={() => onBudget(amount)}>${amount}</button>)}</span></label>
          <dl className="event-buy__metrics">
            <div className="event-buy__metric"><dt>Chance</dt><dd className={outcome === 'yes' ? 'up' : 'down'}>{(outcome === 'yes' ? probability : noProbability) == null ? '—' : fmtPct(outcome === 'yes' ? probability! : noProbability!)}</dd></div>
            <div className="event-buy__metric"><dt>Contracts</dt><dd>{quote?.contracts ? fmtContracts(quote.contracts) : '—'}</dd></div>
            <div className="event-buy__metric"><dt>Payout if right</dt><dd>{quote?.payout ? fmtMoney(quote.payout, 2) : '—'}</dd></div>
            <div className="event-buy__metric"><dt>Max loss</dt><dd>{quote?.cost ? fmtMoney(quote.cost, 2) : fmtMoney(budget, 2)}</dd></div>
          </dl>
          {quote && !quote.tradable && quote.reason && <p className="event-buy__error">{quote.reason}</p>}
          <button className="event-buy__cta" type="button" onClick={onPrint} disabled={closed || !quote?.tradable}>{buyLabel}</button>
          <p className="event-buy__note">Prices are probabilities in cents. The order book may move before you sign. {demo ? 'Demo only — no transaction will be sent.' : 'A wallet signature is required to place this ticket.'}</p>
        </aside>
      </div>

      <div className="event-mobile-buybar" aria-label="Buy ticket">
        <div className="event-mobile-buybar__summary"><b>{outcome.toUpperCase()} · {quote?.contracts ? fmtContracts(quote.contracts) : '—'} contracts</b><span>{quote?.cost ? fmtMoney(quote.cost, 2) : fmtMoney(budget, 2)} max loss · {(outcome === 'yes' ? probability : noProbability) == null ? '—' : fmtPct(outcome === 'yes' ? probability! : noProbability!)} chance</span></div>
        <button type="button" onClick={onPrint} disabled={closed || !quote?.tradable}>{buyLabel}</button>
      </div>
    </div>
  );
}

function EventTicket({ event, outcome, budget, quote, phase, result, error, demo, needWallet, onBack, onPrinted, onSign }: {
  event: EventInfo; outcome: Outcome; budget: number; quote: EventQuote | null;
  phase: Phase; result?: BuyResult; error: string | null; demo: boolean; needWallet: boolean;
  onBack: () => void; onPrinted: () => void; onSign: () => void;
}) {
  const { address } = useChain();
  const toast = useToast();
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const signBtn = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState(false);

  const printedRef = useRef(onPrinted);
  printedRef.current = onPrinted;
  useEffect(() => {
    if (phase !== 'printing') return;
    const id = setTimeout(() => printedRef.current(), reduced ? 250 : 2300);
    return () => clearTimeout(id);
  }, [phase, reduced]);

  useEffect(() => {
    if (phase === 'ready') signBtn.current?.focus({ preventScroll: true });
  }, [phase]);

  const printing = phase === 'printing';
  const placed = phase === 'placed' && result;
  const side = outcome === 'yes' ? 'YES' : 'NO';
  const contracts = placed ? result!.contracts : quote?.contracts ?? 0;
  const cost = placed ? result!.cost : quote?.cost ?? budget;
  const avg = contracts > 0 ? cost / contracts : quote?.avgPrice ?? 0;
  const link = typeof location !== 'undefined' ? location.href : '';
  const explorerUrl = placed ? result!.explorerUrl : '';
  const qrText = placed ? explorerUrl || link : link;
  const title = `${side} · ${event.key}`;
  const status = printing ? 'Printing your ticket…'
    : phase === 'signing' ? 'Confirm in your wallet…'
    : placed ? (demo ? 'Demo ticket placed' : 'Placed onchain')
    : phase === 'error' ? 'Not placed yet'
    : 'Your ticket is ready';
  const postText = `${event.question} Put ${fmtMoney(cost, 2)} on ${side} with Kairo.`;

  return (
    <div className={`ticket-step${printing ? ' is-printing' : ''}`}>
      <div className="printer">
        <div className="printer__slot" role="status" aria-live="polite">
          <span className={`dot ${printing || phase === 'signing' ? 'dot--wait' : phase === 'error' ? 'dot--err' : 'dot--live'}`} />
          <span className="printer__status">{status}</span>
          <span className="printer__logo"><Logo compact /></span>
        </div>
        <div className="printer__mouth">
          <article className={`paper${reduced ? ' no-anim' : ''}`} aria-label={`Ticket: ${title}`}>
            {placed && <div className="stamp" aria-hidden>Placed<small>{demo ? 'Demo' : 'Onchain'}</small></div>}
            <h2 className="paper__title">{title}</h2>
            <p className="paper__sentence event-ticket-q">{event.question}</p>
            <div className="perf" aria-hidden><span className="perf__mark"><Logo compact /></span></div>
            <dl className="paper__grid">
              <div><dt>Cost</dt><dd className="num">{fmtMoney(cost, 2)}</dd></div>
              <div><dt>Contracts</dt><dd className="num">{fmtContracts(contracts)} {side}</dd></div>
              <div><dt>Payout if right</dt><dd className="num up-ink">{fmtMoney(contracts, 0)}</dd></div>
              <div><dt>Price</dt><dd className="num">{fmtCents(avg)}</dd></div>
              <div><dt>Chance</dt><dd className="num">{avg ? fmtPct(avg) : '—'}</dd></div>
              <div><dt>Countdown</dt><dd className="num"><span className="dot dot--play" /> {fmtCountdown(event.closeTime, now)}</dd></div>
            </dl>
            <div className="panel">
              <QR text={qrText} label={placed ? 'QR code linking to the transaction' : 'QR code linking to this ticket'} />
              <div className="panel__body">
                {placed ? (
                  <>
                    <h3><Check size={16} className="up" /> {demo ? 'Demo ticket placed' : 'Placed onchain'}</h3>
                    <p className="panel__line">{fmtContracts(contracts)} {side} contracts for {fmtMoney(cost, 2)}</p>
                    <p className="panel__line muted">{explorerUrl ? 'Scan to view the transaction' : 'Demo trade — nothing was sent onchain'}</p>
                  </>
                ) : (
                  <>
                    <h3>Sign to place your trade</h3>
                    <ol className="panel__steps">
                      <li className={address || demo ? 'is-done' : ''}><span>{address || demo ? <Check size={11} /> : 1}</span>{demo ? 'Demo wallet' : address ? <>Wallet connected</> : <>Connect your wallet</>}</li>
                      <li><span>2</span>Approve <b>{fmtMoney(cost, 2)}</b></li>
                    </ol>
                    {phase === 'error' && <FundsHint message={error} />}
                    <button ref={signBtn} className="btn btn--sign" onClick={onSign} disabled={printing || phase === 'signing'}>
                      {phase === 'signing' ? <><Spinner size={15} /> Waiting for wallet…</> : phase === 'error' ? 'Try again' : (needWallet ? 'Connect & place' : 'Sign & place')}
                    </button>
                  </>
                )}
              </div>
            </div>
            <footer className="paper__foot">
              <span>{event.key}</span>
              <span>Resolves via {event.resolutionSource.replace(/^https?:\/\//, '').split('/')[0]} · {fmtClock(event.closeTime)} UTC{demo ? ' · demo data' : ''}</span>
            </footer>
          </article>
        </div>
      </div>
      {!printing && (
        <BookDisclosure market={{ id: event.id, symbol: event.key, strike: 0, expiry: event.closeTime, kind: 'event' }} />
      )}
      {!printing && (
        <div className="dock" role="toolbar" aria-label="Ticket actions">
          {placed && (
            explorerUrl
              ? <a className="dock__btn dock__btn--primary" href={explorerUrl} target="_blank" rel="noreferrer"><External size={15} /> View on explorer</a>
              : <span className="dock__btn dock__btn--primary is-disabled"><External size={15} /> Demo tx</span>
          )}
          <button className="dock__btn" onClick={() => window.open(`https://x.com/intent/post?text=${encodeURIComponent(postText)}`, '_blank', 'noopener,noreferrer')}><XLogo size={13} /> Post on X</button>
          <button className="dock__btn" onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${postText} ${link}`);
              setCopied(true);
              toast({ text: 'Link copied to clipboard', tone: 'ok' });
            } catch { toast({ text: link, tone: 'info' }); }
          }}>{copied ? <Check size={15} /> : <Share size={15} />} Share</button>
          <button className="dock__btn" onClick={onBack} disabled={phase === 'signing'}><Plus size={15} /> Back</button>
        </div>
      )}
    </div>
  );
}
