import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuyResult, EventInfo, EventQuote, Outcome } from '../chains/types';
import { useChain } from '../state/chain';
import { useToast } from '../state/toast';
import { useUi } from '../state/ui';
import { Link } from '../state/route';
import { useCopy } from '../copy';
import { ensureConnected, eventSource, noAsk, yesAsk } from '../lib/events';
import { humanError } from '../lib/errors';
import { fmtCents, fmtClock, fmtContracts, fmtCountdown, fmtDayFull, fmtMoney, fmtPct } from '../lib/format';
import { useMedia, useNow, useReducedMotion } from '../lib/hooks';
import { AMOUNTS, amountModel, nearestAmountIndex } from '../lib/timeline';
import { BookDisclosure } from '../components/BookPanel';
import { Check, External, Logo, Plus, Share, Spinner, XLogo } from '../components/Icons';
import { QR } from '../components/QR';
import { Ruler } from '../components/Ruler';
import { FundsHint } from '../components/OfflineBanner';

type Phase = 'pick' | 'printing' | 'ready' | 'signing' | 'placed' | 'error';

export default function EventDetailPage({ eventKey }: { eventKey: string }) {
  const chain = useChain();
  const src = eventSource(chain.adapter);
  const { openWallet } = useUi();
  const toast = useToast();
  const [event, setEvent] = useState<EventInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('yes');
  const [budget, setBudget] = useState(100);
  const [phase, setPhase] = useState<Phase>('pick');
  const [quote, setQuote] = useState<EventQuote | null>(null);
  const [result, setResult] = useState<BuyResult | undefined>();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    src.adapter.listEvents!().then(
      (xs) => {
        if (!live) return;
        setEvent(xs.find((e) => e.key === eventKey || e.id === eventKey) ?? null);
      },
      (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [src.adapter, eventKey, chain.epoch]);

  useEffect(() => {
    if (!event || phase === 'placed') return;
    let live = true;
    src.adapter.quoteEvent!(event.id, outcome, budget).then(
      (q) => { if (live) setQuote(q); },
      () => { if (live) setQuote(null); },
    );
    return () => { live = false; };
  }, [src.adapter, event, outcome, budget, phase]);

  async function buy() {
    if (!event || !src.adapter.buyEvent) return;
    setPhase('signing');
    setErr(null);
    const id = toast({ text: 'Confirm in your wallet…', tone: 'wait', sticky: true });
    try {
      if (src.demo) await ensureConnected(src.adapter);
      const q = await src.adapter.quoteEvent!(event.id, outcome, budget);
      if (!q.tradable) throw new Error(q.reason ?? 'Not tradable');
      toast.update(id, { text: 'Transaction sent…', tone: 'wait', sticky: true });
      const r = await src.adapter.buyEvent(event.id, outcome, budget, Math.min(0.99, q.avgPrice + 0.02));
      setResult(r);
      setQuote(q);
      setPhase('placed');
      toast.update(id, {
        text: src.demo ? 'Demo ticket placed' : 'Confirmed',
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
    if (!src.demo && !chain.address) {
      openWallet(() => { void buy(); });
      return;
    }
    void buy();
  }

  if (error) {
    return <div className="page"><div className="card-error glass"><p>{error}</p></div></div>;
  }
  if (event === undefined) {
    return <div className="page"><div className="page__skel" aria-busy="true"><div className="skel-card skel-text" /></div></div>;
  }
  if (!event) {
    return (
      <div className="page page--404">
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
        demo={src.demo}
        needWallet={!src.demo && !chain.address}
        onBack={() => { setPhase('pick'); setErr(null); }}
        onPrinted={() => setPhase((p) => (p === 'printing' ? 'ready' : p))}
        onSign={sign}
      />
    );
  }

  return (
    <EventPick
      event={event}
      demo={src.demo}
      outcome={outcome}
      budget={budget}
      quote={quote}
      onOutcome={setOutcome}
      onBudget={setBudget}
      onPrint={() => setPhase('printing')}
    />
  );
}

function EventPick({ event, demo, outcome, budget, quote, onOutcome, onBudget, onPrint }: {
  event: EventInfo; demo: boolean; outcome: Outcome; budget: number; quote: EventQuote | null;
  onOutcome: (o: Outcome) => void; onBudget: (n: number) => void; onPrint: () => void;
}) {
  const copy = useCopy();
  const now = useNow(1000);
  const compact = useMedia('(max-width: 640px)');
  const model = useMemo(() => amountModel(compact ? 12 : 14), [compact]);
  const y = yesAsk(event);
  const n = noAsk(event);
  const closed = event.status !== 'open' || event.closeTime <= now;

  return (
    <div className="page page--event">
      <p className="crumb"><Link to="/predictions">Predictions</Link> / {event.category}</p>
      <div className="event-hero">
        <div className="event-hero__meta">
          <span className="chip chip--cat">{event.category}</span>
          {demo && <span className="demo-pill">{copy.predictions.demo}</span>}
          <span className={`status status--${event.status === 'open' ? 'live' : 'muted'}`}>{event.status}</span>
        </div>
        <h1 className="title event-q">{event.question}</h1>
        <p className="event-close">{copy.predictions.closes} {fmtDayFull(event.closeTime)} · {fmtCountdown(event.closeTime, now)}</p>
      </div>
      <section className="event-rules glass">
        <h2>{copy.predictions.rules}</h2>
        <blockquote className="event-rules__body">{event.rules}</blockquote>
        <p className="event-source">
          {copy.predictions.source}:{' '}
          <a href={event.resolutionSource} target="_blank" rel="noreferrer">{event.resolutionSource}</a>
        </p>
      </section>
      <div className="event-sides" role="group" aria-label="Outcome">
        <button type="button" className={`event-side event-side--yes${outcome === 'yes' ? ' is-on' : ''}`} onClick={() => onOutcome('yes')} disabled={closed}>
          <b>{copy.predictions.yes}</b>
          <span className="num">{y != null ? fmtCents(y) : '—'}</span>
        </button>
        <button type="button" className={`event-side event-side--no${outcome === 'no' ? ' is-on' : ''}`} onClick={() => onOutcome('no')} disabled={closed}>
          <b>{copy.predictions.no}</b>
          <span className="num">{n != null ? fmtCents(n) : '—'}</span>
        </button>
      </div>
      <div className="big-amount num" aria-label={`Amount ${fmtMoney(budget)}`}>{fmtMoney(budget)}</div>
      <p className="big-sub">
        {quote && quote.contracts > 0
          ? <>buys <b>{fmtContracts(quote.contracts)}</b> {outcome.toUpperCase()} · max loss {fmtMoney(quote.cost, 2)}</>
          : quote?.reason ?? '—'}
      </p>
      <Ruler
        length={model.length}
        ticks={model.ticks}
        stops={model.stops}
        index={nearestAmountIndex(budget)}
        onChange={(i) => onBudget(AMOUNTS[i])}
        height={compact ? 92 : 104}
        curve={compact ? 10 : 16}
        ariaLabel="Amount to put in"
        valueText={(i) => fmtMoney(AMOUNTS[i])}
        className="ruler--amount"
      />
      <BookDisclosure market={{ id: event.id, symbol: event.key, strike: 0, expiry: event.closeTime, kind: 'event' }} />
      <div className="cta">
        <button className="continue-btn" onClick={onPrint} disabled={closed || !(quote?.tradable)}>
          {copy.predictions.print}
        </button>
      </div>
      {quote && !quote.tradable && quote.reason && <p className="info-warn center">{quote.reason}</p>}
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
