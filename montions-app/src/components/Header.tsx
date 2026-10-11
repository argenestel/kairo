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

  return (
    <header className="top">
      <button className="top__logo" onClick={handleLogo} disabled={busy} aria-label={`${copy.brand} — start a new ticket`}>
        <Logo />
      </button>
      <div className="top__mid">
        <ProductNav disabled={busy} />
        {showDots && onGo && (
          <ProgressDots step={step} reached={reached} onGo={(i) => { if (!busy) onGo(i); }} />
        )}
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
        <ModeToggle disabled={busy} />
        <ChainPicker value={key} onChange={(k) => { if (!busy) setKey(k); }} loading={loading} disabled={busy} />
        <button className="glass-btn tickets-btn" onClick={openTickets} aria-label={`${copy.wallet.tickets}${ticketCount ? ` (${ticketCount})` : ''}`}>
          <Ticket size={16} />
          <span className="hide-sm">{copy.wallet.tickets}</span>
          {ticketCount > 0 && <span className="count">{ticketCount}</span>}
        </button>
        <button className={`glass-btn wallet-btn${address ? ' is-connected' : ''}`} onClick={() => openWallet()} aria-label={address ? `Wallet ${address}` : 'Connect wallet'}>
          {address ? (
            <>
              <span className="avatar" style={{ background: avatarBg(address) }} aria-hidden />
              <span className="wallet-btn__addr">{shortAddr(address)}</span>
              {balances && <span className="wallet-btn__bal hide-sm">{fmtMoney(balances.collateral, balances.collateral < 1000 ? 2 : 0)} {sym}</span>}
            </>
          ) : (
            <>
              <Wallet size={16} />
              <span className="hide-xs">{copy.wallet.connect}</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}

export function avatarBg(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 70 + (h % 90)) % 360;
  return `conic-gradient(from ${h % 180}deg, hsl(${a} 80% 62%), hsl(${b} 80% 58%), hsl(${a} 80% 62%))`;
}
