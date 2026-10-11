import { useState } from 'react';
import { useChain } from '../state/chain';
import { useToast } from '../state/toast';
import { humanError } from '../lib/errors';
import { fmtMoney, shortAddr } from '../lib/format';
import { Sheet } from './Sheet';
import { Check, Copy, Drop, External, Spinner, Wallet } from './Icons';
import { avatarBg } from './Header';
import { FundsHint } from './OfflineBanner';

export function WalletSheet({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected?: (addr: string) => void }) {
  const { adapter, address, balances, refreshBalances, demo, bumpPositions } = useChain();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!adapter) return null;
  const meta = adapter.meta;
  let options: ReturnType<typeof adapter.walletOptions> = [];
  try { options = adapter.walletOptions(); } catch { options = []; }
  const sorted = [...options].sort((a, b) => Number(b.installed) - Number(a.installed));

  async function connect(id?: string) {
    setBusy(id ?? 'default');
    setError(null);
    try {
      const addr = await adapter!.connect(id);
      refreshBalances();
      bumpPositions();
      toast({ text: `Connected ${shortAddr(addr)}`, tone: 'ok' });
      onConnected?.(addr);
      onClose();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(null);
    }
  }

  async function faucet() {
    setBusy('faucet');
    setError(null);
    try {
      const r = await adapter!.faucet();
      toast({ text: `Test funds on the way`, tone: 'ok', href: r.explorerUrl || undefined, hrefLabel: 'View tx' });
      setTimeout(refreshBalances, 1200);
      setTimeout(refreshBalances, 5000);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    try { await adapter!.disconnect(); } catch { /* ignore */ }
    bumpPositions();
    onClose();
  }

  const explorer = address ? meta.explorerAddress(address) : '';

  return (
    <Sheet open={open} onClose={onClose} title={address ? 'Your wallet' : 'Connect a wallet'} labelledBy="wallet-title">
      <p className="sheet__net">
        <span className={`dot ${demo ? 'dot--demo' : 'dot--live'}`} /> {meta.label} {meta.network}{demo ? (demo.kind === 'coming-online' ? ' · coming online' : ' · demo data') : ''}
      </p>
      {address ? (
        <div className="acct">
          <div className="acct__row">
            <span className="avatar avatar--lg" style={{ background: avatarBg(address) }} aria-hidden />
            <div className="acct__addr">
              <code title={address}>{shortAddr(address, 6, 6)}</code>
              <div className="acct__links">
                <button className="link-btn" onClick={() => { navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {}); }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                </button>
                {explorer && (
                  <a className="link-btn" href={explorer} target="_blank" rel="noreferrer"><External size={13} /> Explorer</a>
                )}
              </div>
            </div>
          </div>
          <div className="acct__bals">
            <div className="stat">
              <span className="stat__k">{meta.collateralSymbol}</span>
              <span className="stat__v num">{balances ? fmtMoney(balances.collateral, 2) : '—'}</span>
            </div>
            <div className="stat">
              <span className="stat__k">{meta.nativeSymbol} (gas)</span>
              <span className="stat__v num">{balances ? balances.native.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</span>
            </div>
          </div>
          <button className="btn btn--primary btn--block" onClick={faucet} disabled={busy === 'faucet'}>
            {busy === 'faucet' ? <Spinner /> : <Drop size={16} />} Get test funds
          </button>
          <p className="fine">Testnet tokens only — play money with no value.</p>
          <button className="btn btn--ghost btn--block" onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <div className="wallets">
          {sorted.length === 0 && (
            <div className="empty">
              <Wallet size={20} />
              <p>No wallet options on this network. Install a {meta.label} wallet extension and reload.</p>
            </div>
          )}
          {sorted.map((w) => (
            <button key={w.id} className="wallet-opt" onClick={() => connect(w.id)} disabled={!!busy || !w.installed}>
              {w.icon ? <img src={w.icon} alt="" width={28} height={28} /> : <span className="wallet-opt__icon"><Wallet size={16} /></span>}
              <span className="wallet-opt__name">{w.name}</span>
              <span className={`wallet-opt__tag${w.installed ? ' is-ok' : ''}`}>
                {busy === w.id ? <Spinner size={14} /> : w.installed ? 'Detected' : 'Not installed'}
              </span>
            </button>
          ))}
          <p className="fine">Kairo never holds your keys. You sign every trade in your wallet.</p>
        </div>
      )}
      {error && <FundsHint message={error} />}
    </Sheet>
  );
}
