import { useEffect, useState } from 'react';
import type { ChainAdapter, Position } from '../chains/types';
import { useChain } from '../state/chain';
import { useToast } from '../state/toast';
import { useUi } from '../state/ui';
import { eventSource } from '../lib/events';
import { humanError } from '../lib/errors';
import { fmtCents, fmtContracts, fmtCountdown, fmtMoney, fmtMonthDay, fmtClock, fmtPrice, fmtStrike } from '../lib/format';
import { useNow } from '../lib/hooks';
import { Sheet } from './Sheet';
import { AssetIcon } from './AssetIcon';
import { FundsHint } from './OfflineBanner';
import { Spinner, Ticket } from './Icons';

export function usePositions(open: boolean): { list: Position[] | null; loading: boolean; error: string | null; reload: () => void } {
  const { adapter, address, positionsVersion, epoch } = useChain();
  const [list, setList] = useState<Position[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!adapter) { setList(null); return; }
    let live = true;
    const load = () => {
      setLoading(true);
      const src = eventSource(adapter);
      const extraP = src.demo && src.adapter !== adapter
        ? src.adapter.positions().then((ps) => ps.filter((p) => p.kind === 'event')).catch(() => [] as Position[])
        : Promise.resolve([] as Position[]);
      const liveP = address ? adapter.positions().catch(() => [] as Position[]) : Promise.resolve([] as Position[]);
      Promise.all([liveP, extraP]).then(
        ([livePs, extra]) => { if (live) { setList([...extra, ...livePs]); setError(null); setLoading(false); } },
        (e) => { if (live) { setError(humanError(e)); setLoading(false); } },
      );
    };
    load();
    const iv = setInterval(load, open ? 12000 : 45000);
    return () => { live = false; clearInterval(iv); };
  }, [adapter, address, positionsVersion, epoch, open, n]);
  return { list, loading, error, reload: () => setN((x) => x + 1) };
}

export function TicketsDrawer({ open, onClose, positions }: { open: boolean; onClose: () => void; positions: ReturnType<typeof usePositions> }) {
  const { adapter, address, assets, prices } = useChain();
  const { openWallet } = useUi();
  const now = useNow(1000);
  const { list, loading, error } = positions;
  const sorted = list ? [...list].sort((a, b) => Number(b.claimable > 0) - Number(a.claimable > 0) || a.expiry - b.expiry) : null;

  return (
    <Sheet open={open} onClose={onClose} side title="My tickets" labelledBy="tickets-title">
      {sorted == null ? (
        <div className="empty"><Spinner /> <p>Loading your tickets…</p></div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          <Ticket size={22} />
          {!address ? (
            <>
              <p>Connect a wallet to see your tickets.</p>
              <button className="btn btn--primary" onClick={() => { onClose(); openWallet(); }}>Connect wallet</button>
            </>
          ) : (
            <p>No tickets yet. Print one and place it — it will show up here with a live mark.</p>
          )}
        </div>
      ) : (
        <ul className="pos-list">
          {sorted.map((p) => {
            const a = assets.find((x) => x.symbol === p.symbol);
            return <PositionRow key={`${p.marketId}:${p.outcome}:${p.kind ?? 'price'}`} p={p} step={a?.strikeStep ?? 1} spot={prices[p.symbol] ?? a?.price ?? 0} now={now} />;
          })}
        </ul>
      )}
      {loading && sorted && <p className="fine center"><Spinner size={12} /> Refreshing marks…</p>}
      {error && <p className="err" role="alert">{error} <button className="link-btn" onClick={positions.reload}>Retry</button></p>}
      {adapter && <p className="fine">{adapter.meta.settlementNote}</p>}
    </Sheet>
  );
}

function adapterFor(p: Position, live: ChainAdapter | null): ChainAdapter | null {
  if (!live) return null;
  if (p.kind === 'event') return eventSource(live).adapter;
  return live;
}

function PositionRow({ p, step, spot, now }: { p: Position; step: number; spot: number; now: number }) {
  const { adapter: live, bumpPositions, refreshBalances } = useChain();
  const adapter = adapterFor(p, live);
  const toast = useToast();
  const [busy, setBusy] = useState<'claim' | 'sell' | null>(null);
  const [confirmSell, setConfirmSell] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const yes = p.outcome === 'yes';
  const event = p.kind === 'event';
  const value = p.contracts * p.mark;
  const minPrice = Math.max(0.01, Math.floor((p.mark - 0.02) * 100) / 100);
  const settled = p.status !== 'open';
  const expired = p.expiry <= now;

  async function run(kind: 'claim' | 'sell') {
    if (!adapter) return;
    setBusy(kind);
    setErr(null);
    const tid = toast({ text: kind === 'claim' ? 'Claiming…' : 'Selling…', tone: 'wait', sticky: true });
    try {
      const r = kind === 'claim' ? await adapter.claim(p.marketId) : await adapter.sell(p.marketId, p.outcome, p.contracts, minPrice);
      toast.update(tid, { text: kind === 'claim' ? `Claimed ${fmtMoney(p.claimable, 2)}` : `Sold ${fmtContracts(p.contracts)} contracts`, tone: 'ok', sticky: false, href: r.explorerUrl || undefined, hrefLabel: 'View tx' });
      bumpPositions();
      refreshBalances();
      setConfirmSell(false);
    } catch (e) {
      const msg = humanError(e);
      setErr(msg);
      toast.update(tid, { text: msg, tone: 'error', sticky: false });
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = p.status === 'void' ? 'Void · 50/50' : settled ? (p.won ? 'Won' : 'Lost') : expired ? 'Settling' : 'Open';
  const statusTone = p.status === 'void' ? 'muted' : settled ? (p.won ? 'up' : 'down') : expired ? 'warn' : 'live';

  return (
    <li className="pos">
      <div className="pos__head">
        <AssetIcon symbol={event ? 'EVENT' : p.symbol} size={26} />
        <div className="pos__title">
          <b>{event ? (p.question ?? p.symbol) : `${p.symbol} ${yes ? '≥' : '<'} ${fmtStrike(p.strike, step)}`}</b>
          <span className={`tag tag--${yes ? 'up' : 'down'}`}>{yes ? 'YES' : 'NO'}</span>
          {event && <span className="tag">event</span>}
        </div>
        <span className={`status status--${statusTone}`}>{statusLabel}</span>
      </div>
      <div className="pos__grid">
        <div><span>Contracts</span><b className="num">{fmtContracts(p.contracts)}</b></div>
        <div><span>{settled ? 'Settled' : 'Mark'}</span><b className="num">{settled ? (p.won ? '$1.00' : '$0') : fmtCents(p.mark)}</b></div>
        <div><span>{settled ? 'Claimable' : 'Worth now'}</span><b className="num">{fmtMoney(settled ? p.claimable : value, 2)}</b></div>
        <div><span>{settled || expired ? 'Expired' : 'Expires in'}</span><b className="num">{settled || expired ? `${fmtMonthDay(p.expiry)} ${fmtClock(p.expiry)}` : fmtCountdown(p.expiry, now)}</b></div>
      </div>
      {!settled && !event && spot > 0 && (
        <p className="pos__note">
          Pays {fmtMoney(p.contracts, 0)} if {p.symbol} is {yes ? 'at or above' : 'below'} {fmtStrike(p.strike, step)} · now {fmtPrice(spot)}
        </p>
      )}
      {!settled && event && p.question && (
        <p className="pos__note">Pays {fmtMoney(p.contracts, 0)} if this resolves {yes ? 'YES' : 'NO'}.</p>
      )}
      <div className="pos__actions">
        {p.claimable > 0 && (
          <button className="btn btn--primary btn--sm" onClick={() => run('claim')} disabled={!!busy}>
            {busy === 'claim' ? <Spinner size={14} /> : null} Claim {fmtMoney(p.claimable, 2)}
          </button>
        )}
        {p.status === 'open' && !expired && !confirmSell && (
          <button className="btn btn--ghost btn--sm" onClick={() => setConfirmSell(true)} disabled={!!busy || p.mark <= 0.01}>Sell</button>
        )}
        {confirmSell && (
          <>
            <span className="pos__confirm">Sell all for ≥ {fmtMoney(p.contracts * minPrice, 2)}?</span>
            <button className="btn btn--primary btn--sm" onClick={() => run('sell')} disabled={!!busy}>
              {busy === 'sell' ? <Spinner size={14} /> : null} Confirm
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmSell(false)} disabled={!!busy}>Cancel</button>
          </>
        )}
      </div>
      {err && <FundsHint message={err} />}
    </li>
  );
}
