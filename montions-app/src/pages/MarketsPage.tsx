import { useEffect, useMemo, useState } from 'react';
import { COMPARE_VENUES, collectMarkets, midOf, type VenueMarket } from '../lib/venues';
import { canonicalMarketKey } from '../chains/types';
import { CHAINS, type ChainKey } from '../chains';
import { useCopy } from '../copy';
import { fmtCents, fmtCountdown, fmtDayLong, fmtStrike, fmtVolume } from '../lib/format';
import { useNow } from '../lib/hooks';
import { BookPanel } from '../components/BookPanel';
import { ChainGlyph, Spinner } from '../components/Icons';
import { Link } from '../state/route';
import { useChain } from '../state/chain';

export default function MarketsPage() {
  const copy = useCopy();
  const now = useNow(1000);
  const { key: current } = useChain();
  const [rows, setRows] = useState<VenueMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<string>('all');
  const [openKey, setOpenKey] = useState<string | null>(() => {
    try { return new URLSearchParams(location.search).get('focus'); } catch { return null; }
  });

  useEffect(() => {
    let live = true;
    setLoading(true);
    const keys = Array.from(new Set<ChainKey>([current, ...COMPARE_VENUES])).filter((k) => k !== 'hyperliquid');
    collectMarkets(keys, (chunk) => { if (live) { setRows(chunk); setLoading(false); } })
      .then((all) => { if (live) { setRows(all); setError(all.length ? null : 'No markets returned.'); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [current]);

  const assets = useMemo(() => {
    const s = new Set(rows.map((r) => r.symbol));
    const pref = ['BTC', 'ETH', 'SOL'];
    return ['all', ...[...s].sort((a, b) => {
      const ia = pref.indexOf(a); const ib = pref.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.localeCompare(b);
    })];
  }, [rows]);

  const filtered = useMemo(() => asset === 'all' ? rows : rows.filter((r) => r.symbol === asset), [rows, asset]);

  const groups = useMemo(() => {
    const map = new Map<string, { symbol: string; expiry: number; step: number; rows: VenueMarket[] }>();
    for (const r of filtered) {
      const k = `${r.symbol}:${r.expiry}`;
      const g = map.get(k);
      if (g) g.rows.push(r);
      else map.set(k, { symbol: r.symbol, expiry: r.expiry, step: strikeStep(r.strike), rows: [r] });
    }
    const pref = ['BTC', 'ETH', 'SOL'];
    return [...map.values()].sort((a, b) => {
      const ia = pref.indexOf(a.symbol); const ib = pref.indexOf(b.symbol);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.symbol.localeCompare(b.symbol) || a.expiry - b.expiry;
    });
  }, [filtered]);

  return (
    <div className="page page--markets">
      <header className="page__intro">
        <h1 className="title">{copy.markets.title}</h1>
        <p className="subtitle">{copy.markets.sub}</p>
      </header>
      <div className="page__filters" role="tablist" aria-label="Asset">
        {assets.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={asset === s}
            className={`chip${asset === s ? ' is-on' : ''}`}
            onClick={() => setAsset(s)}
          >
            {s === 'all' ? copy.predictions.all : s}
          </button>
        ))}
      </div>
      {loading && !rows.length && (
        <div className="page__skel" aria-busy="true" aria-label="Loading markets">
          {[0, 1, 2].map((i) => <div key={i} className="skel-card skel-text" />)}
        </div>
      )}
      {error && !rows.length && (
        <div className="card-error glass">
          <p>{error}</p>
        </div>
      )}
      {!loading && !filtered.length && rows.length > 0 && (
        <p className="empty">{copy.markets.none}</p>
      )}
      {groups.map((g) => (
        <section key={`${g.symbol}:${g.expiry}`} className="mkt-group glass">
          <h2 className="mkt-group__h">
            <span>{g.symbol}</span>
            <span className="mkt-group__exp">{fmtDayLong(g.expiry)} · {fmtCountdown(g.expiry, now)}</span>
          </h2>
          <GroupTable
            g={g}
            openKey={openKey}
            setOpenKey={setOpenKey}
            copyBest={copy.markets.best}
            copyKey={copy.markets.key}
          />
        </section>
      ))}
      {loading && rows.length > 0 && (
        <p className="fine center"><Spinner size={12} /> Filling in more venues…</p>
      )}
    </div>
  );
}

function GroupTable({ g, openKey, setOpenKey, copyBest, copyKey }: {
  g: { symbol: string; expiry: number; step: number; rows: VenueMarket[] };
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  copyBest: string;
  copyKey: string;
}) {
  const venues = CHAINS.filter((c) => !c.paused && g.rows.some((r) => r.chain === c.key));
  return (
    <div className="mkt-table-wrap">
      <table className="mkt-table">
        <thead>
          <tr>
            <th>Strike</th>
            {venues.map((v) => (
              <th key={v.key}>
                <span className="mkt-th-chain"><ChainGlyph chain={v.key} size={14} /> {v.short}</span>
              </th>
            ))}
            <th>{copyKey}</th>
          </tr>
        </thead>
        <tbody>
          {strikesOf(g.rows).map((k) => {
            const canon = canonicalMarketKey(g.symbol, k, g.expiry);
            const byChain = Object.fromEntries(
              g.rows.filter((r) => r.strike === k).map((r) => [r.chain, r]),
            ) as Record<string, VenueMarket>;
            const best = bestVenue(Object.values(byChain));
            const open = openKey === canon;
            return (
              <FragmentRow
                key={canon}
                strike={k}
                step={g.step}
                canon={canon}
                venues={venues.map((v) => v.key)}
                byChain={byChain}
                best={best}
                open={open}
                copyBest={copyBest}
                onToggle={() => setOpenKey(open ? null : canon)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ strike, step, canon, venues, byChain, best, open, copyBest, onToggle }: {
  strike: number; step: number; canon: string; venues: ChainKey[];
  byChain: Record<string, VenueMarket>; best: ChainKey | null; open: boolean;
  copyBest: string; onToggle: () => void;
}) {
  const sample = Object.values(byChain)[0];
  return (
    <>
      <tr className={open ? 'is-open' : ''} onClick={onToggle} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        aria-label={`${fmtStrike(strike, step)} ${canon}`}
      >
        <td className="num">{fmtStrike(strike, step)}</td>
        {venues.map((v) => {
          const m = byChain[v];
          if (!m) return <td key={v} className="muted">—</td>;
          const bid = m.bids[0]?.price;
          const ask = m.asks[0]?.price;
          return (
            <td key={v} className={best === v ? 'is-best' : ''}>
              <div className="mkt-cell">
                <span className="num">{bid != null ? fmtCents(bid) : '—'} / {ask != null ? fmtCents(ask) : '—'}</span>
                <small>{fmtVolume(m.volume)} · {m.oracleName}{m.demo ? ' · demo' : ''}</small>
                {best === v && <span className="mkt-best">{copyBest}</span>}
              </div>
            </td>
          );
        })}
        <td>
          <code className="mkt-key" title={canon}>{canon}</code>
        </td>
      </tr>
      {open && sample && (
        <tr className="mkt-book-row">
          <td colSpan={venues.length + 2}>
            <div className="mkt-book-grid">
              {venues.map((v) => {
                const m = byChain[v];
                if (!m) return null;
                return (
                  <div key={v} className="mkt-book-col">
                    <h3><ChainGlyph chain={v} size={14} /> {m.chainLabel} · {m.oracleName}</h3>
                    <BookPanel market={{ id: m.id, symbol: m.symbol, strike: m.strike, expiry: m.expiry }} chain={v} compact />
                    <Link className="link-btn" to={`/?t=${m.symbol}~a~${m.strike}~${m.expiry}~100`}>Print a ticket</Link>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function strikesOf(rows: VenueMarket[]): number[] {
  return [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
}

function strikeStep(k: number): number {
  if (k >= 1000) return 1;
  if (k >= 1) return 0.01;
  return 0.001;
}

function bestVenue(rows: VenueMarket[]): ChainKey | null {
  let best: VenueMarket | null = null;
  for (const r of rows) {
    const mid = midOf(r);
    const ask = r.asks[0]?.price;
    if (ask == null && mid == null) continue;
    if (!best) { best = r; continue; }
    const bAsk = best.asks[0]?.price ?? midOf(best) ?? 1;
    const aAsk = ask ?? mid ?? 1;
    if (aAsk < bAsk) best = r;
  }
  return best?.chain ?? null;
}
