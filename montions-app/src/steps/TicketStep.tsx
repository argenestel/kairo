import { useEffect, useRef, useState } from 'react';
import { useChain } from '../state/chain';
import { useMode } from '../state/mode';
import { useToast } from '../state/toast';
import { useUi } from '../state/ui';
import { S, shareUrl, clearShareParam } from '../state/flow';
import { humanError } from '../lib/errors';
import {
  fmtCents, fmtClock, fmtContracts, fmtCountdown, fmtDayFull, fmtMMDD, fmtMoney, fmtMonthDay, fmtPct, fmtStrike,
  fmtStrikeShort, isSameUtcDay, nowSec, shortAddr,
} from '../lib/format';
import { useNow, useQuote, useReducedMotion } from '../lib/hooks';
import { sigmaMove } from '../lib/model';
import { PayoutSimulator } from '../components/Payoff';
import { AssetIcon } from '../components/AssetIcon';
import { BookDisclosure } from '../components/BookPanel';
import { FundsHint } from '../components/OfflineBanner';
import { QR } from '../components/QR';
import { ArrowDown, ArrowUp, Check, Edit, External, Logo, Plus, Share, Spinner, XLogo } from '../components/Icons';
import { effective, type StepProps } from './common';

export function TicketStep({ flow, dispatch, asset }: StepProps) {
  const d = flow.draft;
  const t = flow.ticket;
  const { adapter, key, demo, address, bumpPositions, refreshBalances } = useChain();
  const { mode } = useMode();
  const { openWallet } = useUi();
  const toast = useToast();
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const signBtn = useRef<HTMLButtonElement | null>(null);
  const [placedChance, setPlacedChance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const { quote, stale } = useQuote(
    d.symbol && d.strike != null && d.expiry != null && t.phase !== 'placed'
      ? { symbol: d.symbol, strike: d.strike, expiry: d.expiry, direction: d.direction, budget: d.budget }
      : null,
  );
  const eff = effective(quote, stale, asset, d.direction, d.strike, d.expiry, d.budget);

  // printing → ready
  useEffect(() => {
    if (t.phase !== 'printing') return;
    const id = setTimeout(() => dispatch({ type: 'ticket', patch: { phase: 'ready' } }), reduced ? 250 : 2300);
    return () => clearTimeout(id);
  }, [t.phase, dispatch, reduced]);

  useEffect(() => {
    if (t.phase === 'ready') signBtn.current?.focus({ preventScroll: true });
  }, [t.phase]);

  if (!asset || d.strike == null || d.expiry == null || !d.symbol) {
    return <div className="ticket-step"><p className="hint">This ticket is missing a detail. <button className="link-btn" onClick={() => dispatch({ type: 'goto', step: S.asset })}>Start over</button></p></div>;
  }

  const symbol = d.symbol;
  const strike = d.strike;
  const expiry = d.expiry;
  const up = d.direction === 'above';
  const side = up ? 'YES' : 'NO';
  const step = asset.strikeStep;
  const placed = t.phase === 'placed' && t.result;
  const contracts = placed ? t.result!.contracts : eff?.contracts ?? 0;
  const cost = placed ? t.result!.cost : eff?.cost ?? d.budget;
  const payout = contracts;
  const avg = contracts > 0 ? cost / contracts : eff?.price ?? 0;
  const chance = placed ? placedChance ?? eff?.chance ?? 0 : eff?.chance ?? 0;
  const meta = adapter?.meta;
  const netName = meta ? `${meta.label} ${meta.network}` : '';
  const link = shareUrl(key, d, mode);
  const explorerUrl = placed ? t.result!.explorerUrl : '';
  const qrText = placed ? explorerUrl || link : link;
  const sameDay = isSameUtcDay(expiry, nowSec());
  const dateChip = sameDay ? `Today, ${fmtClock(expiry)} UTC` : fmtDayFull(expiry);
  const title = `${symbol} ${fmtStrikeShort(strike, step)} ${side} · ${sameDay ? fmtClock(expiry) : fmtMMDD(expiry)}`;
  const ref = placed ? shortAddr(t.result!.signature, 6, 6) : `MNT-${fmtMMDD(expiry).replace('/', '')}-${symbol}${fmtStrikeShort(strike, step).replace(/[$,]/g, '')}-${side[0]}`;
  const sentence = `I think $${symbol} will be ${d.direction} ${fmtStrike(strike, step)} by ${sameDay ? `${fmtClock(expiry)} UTC today` : fmtMonthDay(expiry)}.`;
  const postText = placed
    ? `${sentence} Put ${fmtMoney(cost, cost % 1 ? 2 : 0)} on it at ${fmtCents(avg)} a contract, pays ${fmtMoney(payout)} if I'm right. ${demo ? 'Simulated' : 'Placed onchain'} on ${netName} with Kairo.`
    : `${sentence} ${fmtMoney(d.budget)} in, ${fmtMoney(payout)} out if I'm right (${fmtPct(chance)} chance). Printed on Kairo.`;

  async function doBuy() {
    if (!adapter) return;
    dispatch({ type: 'ticket', patch: { phase: 'signing', note: 'Getting a fresh quote…', error: undefined } });
    const tid = toast({ text: 'Signing…', tone: 'wait', sticky: true });
    try {
      const q = await adapter.quote(symbol, strike, expiry, d.direction, d.budget);
      if (!q.tradable || q.contracts <= 0) throw new Error(q.reason ?? 'This ticket cannot be placed right now');
      dispatch({ type: 'ticket', patch: { note: q.needsMarket ? 'Creating the market — confirm in your wallet…' : 'Confirm in your wallet…' } });
      toast.update(tid, { text: 'Confirm in your wallet…', tone: 'wait', sticky: true });
      const r = await adapter.buy({ symbol, strike, expiry, direction: d.direction, budget: d.budget, maxPrice: Math.min(0.99, q.avgPrice + 0.02) });
      toast.update(tid, { text: 'Transaction sent…', tone: 'wait', sticky: true, href: r.explorerUrl || undefined, hrefLabel: 'Explorer' });
      setPlacedChance(q.chance);
      dispatch({ type: 'ticket', patch: { phase: 'placed', result: r, note: undefined } });
      clearShareParam();
      toast.update(tid, {
        text: `Confirmed: ${fmtContracts(r.contracts)} ${side} contracts`,
        tone: 'ok', sticky: false,
        href: r.explorerUrl || undefined, hrefLabel: 'Explorer',
      });
      bumpPositions();
      refreshBalances();
    } catch (e) {
      const msg = humanError(e);
      dispatch({ type: 'ticket', patch: { phase: 'error', error: msg, note: undefined } });
      toast.update(tid, { text: msg, tone: 'error', sticky: false });
    }
  }

  function sign() {
    if (!adapter || t.phase === 'signing') return;
    if (!adapter.address()) {
      openWallet(() => { void doBuy(); });
      return;
    }
    void doBuy();
  }

  async function share() {
    const data = { title: 'My Kairo ticket', text: postText, url: link };
    try {
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${postText} ${link}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast({ text: 'Link copied to clipboard', tone: 'ok' });
    } catch {
      toast({ text: link, tone: 'info' });
    }
  }

  const post = () => {
    const u = `https://x.com/intent/post?text=${encodeURIComponent(postText)}&url=${encodeURIComponent(link)}`;
    window.open(u, '_blank', 'noopener,noreferrer');
  };

  const printing = t.phase === 'printing';
  const status = printing ? 'Printing your ticket…'
    : t.phase === 'signing' ? (t.note ?? 'Confirm in your wallet…')
    : placed ? (demo ? 'Demo ticket placed' : `Placed on ${netName}`)
    : t.phase === 'error' ? 'Not placed yet'
    : 'Your ticket is ready';
  const dotClass = printing || t.phase === 'signing' ? 'dot--wait' : t.phase === 'error' ? 'dot--err' : 'dot--live';

  return (
    <div className={`ticket-step${printing ? ' is-printing' : ''}`}>
      <div className="printer">
        <div className="printer__slot" role="status" aria-live="polite">
          <span className={`dot ${dotClass}`} />
          <span className="printer__status">{status}</span>
          <span className="printer__logo"><Logo compact /></span>
        </div>
        <div className="printer__mouth">
          <article className={`paper${reduced ? ' no-anim' : ''}`} aria-label={`Ticket: ${title}`}>
            {placed && <div className="stamp" aria-hidden>Placed<small>{netName}</small></div>}
            <h2 className="paper__title">{title}</h2>
            <p className="paper__sentence">
              <span>You're betting that</span>
              <span className="pchip"><AssetIcon symbol={symbol} size={16} /> {symbol}</span>
              <span>will be</span>
              <span className={`pchip ${up ? 'pchip--up' : 'pchip--down'}`}>{up ? <ArrowUp size={13} /> : <ArrowDown size={13} />} {d.direction}</span>
              <span className="pchip num">{fmtStrike(strike, step)}</span>
              <span>by</span>
              <span className="pchip">{dateChip}</span>
            </p>
            <div className="perf" aria-hidden><span className="perf__mark"><Logo compact /></span></div>
            <dl className="paper__grid">
              <div><dt>Cost</dt><dd className="num">{fmtMoney(cost, 2)}</dd></div>
              <div><dt>Contracts</dt><dd className="num">{eff?.estimated && !placed ? '~' : ''}{fmtContracts(contracts)} {side}</dd></div>
              <div><dt>Payout if right</dt><dd className="num up-ink">{fmtMoney(payout, 0)}</dd></div>
              <div><dt>Price</dt><dd className="num">{fmtCents(avg)} <small>/ contract</small></dd></div>
              <div><dt>Chance</dt><dd className="num">{fmtPct(chance)}</dd></div>
              <div><dt>Countdown</dt><dd className="num"><span className="dot dot--play" /> {fmtCountdown(expiry, now)}</dd></div>
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
                      <li className={address ? 'is-done' : ''}><span>{address ? <Check size={11} /> : 1}</span>{address ? <>Wallet <b>{shortAddr(address)}</b></> : <>Connect your <b>{meta?.label ?? ''} wallet</b></>}</li>
                      <li><span>2</span>Approve <b>{fmtMoney(cost, 2)}</b> in your wallet</li>
                    </ol>
                    {t.phase === 'error' && <FundsHint message={t.error} />}
                    <button
                      ref={signBtn}
                      className="btn btn--sign"
                      onClick={sign}
                      disabled={printing || t.phase === 'signing' || !adapter || (!!eff && !eff.tradable && !eff.estimated)}
                    >
                      {t.phase === 'signing' ? <><Spinner size={15} /> {t.note?.includes('wallet') ? 'Waiting for wallet…' : 'Preparing…'}</>
                        : t.phase === 'error' ? 'Try again'
                        : address ? 'Sign & place' : 'Connect & place'}
                    </button>
                    {eff && !eff.tradable && eff.reason && <p className="panel__warn">{eff.reason}</p>}
                  </>
                )}
              </div>
            </div>
            <footer className="paper__foot">
              <span>Ref {ref}</span>
              <span>
                {placed ? `Settles via ${meta?.oracleName ?? 'oracle'} at ${fmtClock(expiry)} UTC` : `Indicative pricing · ${meta?.oracleName ?? ''} settles at ${fmtClock(expiry)} UTC`}
                {demo ? ' · demo data' : ''}
              </span>
            </footer>
          </article>
        </div>
      </div>

      {/* ui-chart: payout */}
      {eff && !printing && (
        <PayoutSimulator
          symbol={symbol}
          direction={d.direction}
          spot={asset.price}
          strike={strike}
          strikeStep={step}
          cost={cost}
          payout={payout}
          sigma={sigmaMove(asset.vol, expiry - Date.now() / 1000)}
          expiryLabel={sameDay ? `${fmtClock(expiry)} UTC` : fmtMonthDay(expiry)}
          compact
        />
      )}
      {d.symbol && d.strike != null && d.expiry != null && !printing && (
        <BookDisclosure market={{ symbol: d.symbol, strike: d.strike, expiry: d.expiry }} />
      )}
      {!printing && (
        <div className="dock" role="toolbar" aria-label="Ticket actions">
          {placed && (
            explorerUrl
              ? <a className="dock__btn dock__btn--primary" href={explorerUrl} target="_blank" rel="noreferrer"><External size={15} /> View on explorer</a>
              : <span className="dock__btn dock__btn--primary is-disabled" title="Demo trade — no explorer link"><External size={15} /> Demo tx</span>
          )}
          <button className="dock__btn" onClick={post}><XLogo size={13} /> Post on X</button>
          <button className="dock__btn" onClick={share}>{copied ? <Check size={15} /> : <Share size={15} />} Share</button>
          <button className="dock__btn" onClick={() => dispatch({ type: 'goto', step: S.amount })} disabled={t.phase === 'signing'}><Edit size={15} /> Edit</button>
          <button className="dock__btn" onClick={() => dispatch({ type: 'reset', keepSymbol: true })} disabled={t.phase === 'signing'}><Plus size={15} /> New ticket</button>
        </div>
      )}
    </div>
  );
}
