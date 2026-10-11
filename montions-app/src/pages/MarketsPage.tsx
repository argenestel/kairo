import { useEffect, useMemo, useState } from 'react';
import { COMPARE_VENUES, collectMarkets, loadVenue, midOf, type VenueMarket } from '../lib/venues';
import { CHAINS, type ChainKey } from '../chains';
import type { AssetCategory, AssetInfo, Direction } from '../chains/types';
import { fmtCents, fmtCountdown, fmtClock, fmtDayLong, fmtMoney, fmtVolume } from '../lib/format';
import { useNow } from '../lib/hooks';
import { BookPanel } from '../components/BookPanel';
import { Sheet } from '../components/Sheet';
import { ChainGlyph, Search } from '../components/Icons';
import { useChain } from '../state/chain';
import { useMode } from '../state/mode';
import { shareUrl } from '../state/flow';
import './markets/markets.css';

const categories: [AssetCategory | 'all', string][] = [['all', 'All assets'], ['crypto', 'Crypto'], ['stock', 'Stocks'], ['etf', 'ETFs'], ['commodity', 'Commodities']];
const label = (key: ChainKey) => CHAINS.find(c => c.key === key)?.short ?? key;
const tradable = (r: VenueMarket, now: number) => r.status === 'open' && r.expiry > now && !r.marketClosed && (r.asks.some(l => l.qty > 0) || r.bids.some(l => l.qty > 0));
export default function MarketsPage() {
  const chain = useChain(); const { mode } = useMode(); const now = useNow(1000);
  const [rows, setRows] = useState<VenueMarket[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [category, setCategory] = useState<AssetCategory | 'all'>('all'); const [search, setSearch] = useState('');
  const [expiry, setExpiry] = useState<number | null>(null); const [venues, setVenues] = useState<ChainKey[]>(['base', 'arbitrum', 'solana', 'mock']);
  const [only, setOnly] = useState(false); const [sort, setSort] = useState('ascending'); const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(location.search).get('focus'));
  const [catalog, setCatalog] = useState<Record<string, AssetInfo>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [bookVenue, setBookVenue] = useState<ChainKey | null>(null);
  useEffect(() => { let live = true; setRows([]); setLoading(true); setError('');
    collectMarkets([...new Set([chain.key, ...COMPARE_VENUES])].filter(k => k !== 'hyperliquid'), chunk => { if(live) setRows(chunk); })
      .then(all => { if(live) { setRows(all); if(!all.length) setError('No markets returned from the venues. Try refreshing the network.'); } })
      .catch(e => { if(live) setError(String(e)); }).finally(() => { if(live) setLoading(false); });
    return () => { live = false; }; }, [chain.key, chain.epoch]);
  useEffect(() => {
    let live = true; const subscriptions: (() => void)[] = []; setCatalog({});
    for (const key of [...new Set([chain.key, ...COMPARE_VENUES])].filter(k => k !== 'hyperliquid')) {
      void loadVenue(key).then(async ({adapter}) => {
        const assets = await adapter.listAssets(); if (!live) return;
        setCatalog(previous => { const next = {...previous}; for (const a of assets) if (!next[a.symbol] || key === chain.key) next[a.symbol] = a; return next; });
        const stop = adapter.subscribePrices((symbol, price, time) => { if (live && price > 0) setCatalog(previous => previous[symbol] ? {...previous, [symbol]: {...previous[symbol], price, priceTime: time}} : previous); });
        if (live) subscriptions.push(stop); else stop();
      }).catch(() => { /* Venue collection reports unavailability in the summary. */ });
    }
    return () => { live = false; subscriptions.forEach(stop => stop()); };
  }, [chain.key, chain.epoch]);
  const expiries = [...new Set(rows.map(r => r.expiry))].sort((a,b) => a-b);
  const filtered = rows.filter(r => venues.includes(r.chain) && (category === 'all' || (r.category ?? 'crypto') === category) && `${r.symbol} ${catalog[r.symbol]?.name ?? ''}`.toLowerCase().includes(search.toLowerCase().trim()) && (!only || tradable(r, now)));
  const groups = useMemo(() => [...new Set(filtered.map(r => r.symbol))].sort().map(symbol => {
    const all = filtered.filter(r => r.symbol === symbol); const date = expiry ?? Math.min(...all.map(r => r.expiry));
    return {symbol, date, rows: all.filter(r => r.expiry === date)};
  }).filter(g => g.rows.length), [filtered, expiry]);
  const selectedRows = rows.filter(r => r.canonical === selected && venues.includes(r.chain));
  const active = selectedRows.find(r => r.chain === bookVenue) ?? [...selectedRows].filter(r => tradable(r, now)).sort((a,b) => (a.asks[0]?.price ?? 1) - (b.asks[0]?.price ?? 1))[0] ?? selectedRows[0];
  const volume = rows.reduce((sum,r) => sum + r.volume, 0);
  function tradeVenue(direction: Direction) {
    return (bookVenue && active ? [active] : selectedRows).filter(r => tradable(r, now) && (direction === 'above' ? r.asks : r.bids).some(l => l.qty > 0))
      .sort((a,b) => direction === 'above' ? (a.asks.find(l => l.qty > 0)!.price - b.asks.find(l => l.qty > 0)!.price) : (b.bids.find(l => l.qty > 0)!.price - a.bids.find(l => l.qty > 0)!.price))[0];
  }
  function ticket(direction: Direction) { const venue = tradeVenue(direction); if(!venue) return '#'; const url = new URL(shareUrl(venue.chain, {symbol:venue.symbol, strike:venue.strike, expiry:venue.expiry, direction, budget:100},mode)); url.pathname='/'; return url.toString(); }
  return <div className="page options-page">
    <header className="options-intro"><div><span className="options-eyebrow">THE OPTIONS BOARD</span><h1>One view. Every strike.</h1><p>Compare YES and NO across venues. Choose your moment.</p></div><span className="options-explainer">YES pays $1 above the strike<br/>NO pays $1 below it</span></header>
    <div className="options-summary" aria-live="polite"><div className="options-status">{(['base','arbitrum','solana'] as ChainKey[]).map(k => {const available=rows.filter(r=>r.chain===k);return <span key={k}><i className={`dot ${available.length ? available.every(r=>r.demo)?'dot--demo':'dot--live':'dot--wait'}`} />{label(k)} <small>{available.length ? available.every(r=>r.demo)?'demo':'connected':loading?'loading':'unavailable'}</small></span>;})}</div><span><b>{new Set(rows.map(r=>r.canonical)).size}</b> markets in view</span>{volume>0 && <span><b>{fmtVolume(volume)}</b> volume</span>}</div>
    <section className="options-filters" aria-label="Market filters"><div className="options-filter-top"><div className="options-tabs" role="group" aria-label="Asset class">{categories.map(([value,name])=><button key={value} className={category===value?'is-on':''} aria-pressed={category===value} onClick={()=>setCategory(value)}>{name}</button>)}</div><label className="options-search"><Search size={16}/><input aria-label="Search symbol or asset name" type="search" placeholder="Search assets…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
    <div className="options-filter-bottom"><div className="options-expiries" aria-label="Expiry"><span>EXPIRY</span><button className={`chip ${expiry===null?'is-on':''}`} aria-pressed={expiry===null} onClick={()=>setExpiry(null)}>Nearest</button>{expiries.map(e=><button key={e} aria-pressed={expiry===e} className={`chip ${expiry===e?'is-on':''}`} onClick={()=>setExpiry(e)}>{fmtDayLong(e)} · {fmtClock(e)}</button>)}</div><div className="options-venues">{(['base','arbitrum','solana',...(chain.key==='mock'?['mock']:[])] as ChainKey[]).map(k=><button key={k} className={`chip ${venues.includes(k)?'is-on':''}`} aria-pressed={venues.includes(k)} onClick={()=>setVenues(v=>v.includes(k)?v.filter(x=>x!==k):[...v,k])}><ChainGlyph chain={k} size={12}/>{label(k)}</button>)}</div><label className="options-only"><input type="checkbox" checked={only} onChange={e=>setOnly(e.target.checked)}/>Only tradable</label><select aria-label="Sort strikes" value={sort} onChange={e=>setSort(e.target.value)}><option value="ascending">Strike ↑</option><option value="descending">Strike ↓</option></select></div></section>
    {loading&&!rows.length && <div className="page__skel" aria-busy="true" aria-label="Loading option chains">{[0,1,2].map(i=><div className="skel-card skel-text" key={i}/>)}</div>}
    {error&&<div className="options-empty" role="alert">{error}<button className="btn btn--ghost" onClick={chain.retry}>Retry</button></div>}
    {!groups.length && rows.length>0 && <div className="options-empty"><h2>No matching strikes</h2><p>Try another expiry, asset class, or venue.</p><button className="btn btn--ghost" onClick={()=>{setCategory('all');setSearch('');setExpiry(null);setOnly(false);setVenues(['base','arbitrum','solana','mock']);}}>Reset filters</button></div>}
    {groups.map(g=>{const asset=chain.assets.find(a=>a.symbol===g.symbol)??catalog[g.symbol];const price=chain.prices[g.symbol]??asset?.price;return <section key={g.symbol} className="options-board"><header className="options-asset"><div className="options-asset-name"><span className="options-symbol">{g.symbol.slice(0,2)}</span><div><h2>{g.symbol} <small>{asset?.name}</small></h2><p>{g.rows[0].oracleNote??g.rows[0].oracleName}{g.rows.some(r=>r.marketClosed)&&<span className="demo-pill">Market closed</span>}</p></div></div><div className="options-spot">{price!=null&&price>0?<b className="num">{fmtMoney(price,2)}</b>:<span>Price unavailable</span>}<small>{fmtDayLong(g.date)} · {fmtClock(g.date)} · {fmtCountdown(g.date,now)}</small></div></header>
    <div className="options-table-scroll"><table className="options-table"><caption className="sr-only">{g.symbol} option chain. Enter opens a strike. Arrow keys move between strikes.</caption><thead><tr><th colSpan={2} className="up">YES · ABOVE</th><th>STRIKE</th><th colSpan={2} className="down">NO · BELOW</th><th><span className="sr-only">Copy key</span></th></tr><tr className="options-subhead"><th>Bid</th><th>Ask</th><th>USD</th><th>Bid</th><th>Ask</th><th/></tr></thead><tbody>{[...new Set(g.rows.map(r=>r.strike))].sort((a,b)=>sort==='ascending'?a-b:b-a).map(strike=>{const matches=g.rows.filter(r=>r.strike===strike); const canon=matches[0].canonical;const executable=matches.filter(r=>tradable(r,now));const prices=(no:boolean,ask:boolean)=>{const quotes=executable.flatMap(r=>{const l=(no?!ask:ask)?r.asks:r.bids;const p=l.find(x=>x.qty>0)?.price;return p==null?[]:[{price:no?1-p:p,venue:r}];}).sort((a,b)=>ask?a.price-b.price:b.price-a.price);const best=quotes[0];return <span className="option-quote">{best?fmtCents(best.price):'—'}{best&&<small title={`${best.venue.chainLabel}${best.venue.demo?' · demo':''}`}><ChainGlyph chain={best.venue.chain} size={10}/>{label(best.venue.chain)}{best.venue.demo?' · demo':''}</small>}</span>;};const mids=matches.map(midOf).filter((p):p is number=>p!=null);const probability=mids.length?mids.reduce((a,b)=>a+b,0)/mids.length:null;return <tr key={canon} className="option-row" tabIndex={0} aria-label={`${g.symbol} strike ${strike}. Open order book`} onClick={()=>{setSelected(canon);setBookVenue(null);setCopiedKey(null);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(canon);setBookVenue(null);}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=e.key==='ArrowDown'?e.currentTarget.nextElementSibling:e.currentTarget.previousElementSibling;(next as HTMLElement|null)?.focus();}}}><td className="up">{prices(false,false)}</td><td className="up">{prices(false,true)}</td><td className="option-strike"><b className="num">{fmtMoney(strike,strike<1?3:strike<100?2:0)}</b>{probability!=null&&<span className="option-prob" title={`${Math.round(probability*100)}% implied YES probability`}><i style={{width:`${probability*100}%`}}/></span>}</td><td className="down">{prices(true,false)}</td><td className="down">{prices(true,true)}</td><td><button className="option-copy" title={`Copy ${canon}`} aria-label={`Copy market key ${canon}`} onClick={e=>{e.stopPropagation();void navigator.clipboard.writeText(canon).then(()=>{setCopiedKey(canon);setTimeout(()=>setCopiedKey(null),1800);}).catch(()=>setCopiedKey(null));}}>{copiedKey===canon?'✓':'⧉'}</button></td></tr>;})}</tbody></table></div></section>;})}
    {loading&&rows.length>0&&<p className="fine">Loading more strikes and venues…</p>}
    <Sheet open={!!active} onClose={()=>setSelected(null)} side title={active?`${active.symbol} ≥ ${fmtMoney(active.strike)}?`:'Order book'}>{active&&<div className="options-drawer"><p>{fmtDayLong(active.expiry)} · {active.oracleNote??active.oracleName}</p><div className="options-venues">{selectedRows.map(r=><button className={`chip ${active.chain===r.chain?'is-on':''}`} key={r.chain} onClick={()=>setBookVenue(r.chain)}>{label(r.chain)}{r.demo?' · demo':''}</button>)}</div><BookPanel market={active} chain={active.chain}/><div className="options-trades">{tradable(active,now)?<>{tradeVenue('above')?<a className="btn up-bg" href={ticket('above')}>Trade YES ↗</a>:<span className="fine">No YES liquidity</span>}{tradeVenue('below')?<a className="btn down-bg" href={ticket('below')}>Trade NO ↗</a>:<span className="fine">No NO liquidity</span>}</>:<p>This venue is currently not tradable.</p>}</div><p className="fine">Fully collateralised. A winning contract pays $1. Review price and amount before signing.</p></div>}</Sheet>
  </div>;
}
