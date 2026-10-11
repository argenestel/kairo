import { useChain } from '../state/chain';
import { useCopy } from '../copy';
import { useRoute } from '../state/route';
import { useUi } from '../state/ui';
import { fmtMoney, shortAddr } from '../lib/format';
import { Logo, Ticket, Wallet } from './Icons';
import { ProgressDots } from './ProgressDots';
import { ChainPicker } from './ChainPicker';
import { ModeToggle } from './ModeToggle';
import { ProductNav } from './ProductNav';
import { navigate } from '../state/route';
import { useEffect, useState } from 'react';

interface Props {
  step?: number;
  reached?: number;
  onGo?: (i: number) => void;
  onLogo?: () => void;
  busy?: boolean;
  showDots?: boolean;
}

export function Header({ step = 0, reached = 0, onGo, onLogo, busy = false, showDots = false }: Props) {
  const { key, setKey, demo, loading, address, balances, adapter, retry } = useChain();
  const { openWallet, openTickets, ticketCount } = useUi();
  const copy = useCopy();
  const { route } = useRoute();
  const sym = adapter?.meta.collateralSymbol ?? 'tUSDC';
  const chipLabel = demo?.kind === 'coming-online' ? copy.chain.coming : copy.chain.demo;

  const handleLogo = () => {
    if (onLogo) onLogo();
    else if (route.name !== 'home') navigate('/');
  };

  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [menu]);

  const wallet = (
    <button className={`glass-btn wallet-btn${address ? ' is-connected' : ''}`} onClick={() => openWallet()} aria-label={address ? `Wallet ${address}` : 'Connect wallet'}>
      {address ? (
        <>
          <span className="avatar" style={{ background: avatarBg(address) }} aria-hidden />
          <span className="wallet-btn__addr">{shortAddr(address)}</span>
          {balances && <span className="wallet-btn__bal hide-md">{fmtMoney(balances.collateral, balances.collateral < 1000 ? 2 : 0)} {sym}</span>}
        </>
      ) : (
        <>
          <Wallet size={16} />
          <span>{copy.wallet.connect}</span>
        </>
      )}
    </button>
  );

  return (
    <>
      <header className="top">
        <div className="top__left">
          <button className="top__logo" onClick={handleLogo} disabled={busy} aria-label={`${copy.brand} — start a new ticket`}>
            <Logo />
          </button>
          <div className="top__nav"><ProductNav disabled={busy} /></div>
        </div>
        <div className="top__right">
          {demo && (
            <button
              className={`demo-badge demo-badge--${demo.kind}${demo.forced ? ' is-forced' : ''}`}
              title={demo.reason}
              onClick={() => !demo.forced && retry()}
              aria-label={`${demo.reason}${demo.forced ? '' : ' Click to retry the live adapter.'}`}
            >
              <span className="demo-badge__dot" />
              <span className="demo-badge__label">{chipLabel}</span>
            </button>
          )}
          <span className="top__desk"><ModeToggle disabled={busy} /></span>
          <ChainPicker value={key} onChange={(k) => { if (!busy) setKey(k); }} loading={loading} disabled={busy} />
          <button className="icon-btn top__desk" onClick={openTickets} aria-label={`${copy.wallet.tickets}${ticketCount ? ` (${ticketCount})` : ''}`} title={copy.wallet.tickets}>
            <Ticket size={17} />
            {ticketCount > 0 && <span className="count">{ticketCount}</span>}
          </button>
          {wallet}
          <button className={`icon-btn top__burger${menu ? ' is-open' : ''}`} onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <span /><span /><span />
          </button>
        </div>
        {menu && (
          <>
            <div className="top-menu__scrim" onClick={() => setMenu(false)} />
            <div className="top-menu glass" role="dialog" aria-label="Menu">
              <ProductNav variant="list" disabled={busy} onNavigate={() => setMenu(false)} />
              <div className="top-menu__row">
                <button className="glass-btn" onClick={() => { setMenu(false); openTickets(); }}>
                  <Ticket size={16} /> {copy.wallet.tickets}{ticketCount > 0 ? ` (${ticketCount})` : ''}
                </button>
                <ModeToggle disabled={busy} showLabel />
              </div>
            </div>
          </>
        )}
        {showDots && onGo && (
          <div className="top-dots">
            <ProgressDots step={step} reached={reached} onGo={(i) => { if (!busy) onGo(i); }} />
          </div>
        )}
      </header>
    </>
  );
}

export function avatarBg(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 70 + (h % 90)) % 360;
  return `conic-gradient(from ${h % 180}deg, hsl(${a} 80% 62%), hsl(${b} 80% 58%), hsl(${a} 80% 62%))`;
}
