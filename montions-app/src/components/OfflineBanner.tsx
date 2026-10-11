import { useEffect, useState } from 'react';
import { useCopy } from '../copy';
import { useChain } from '../state/chain';
import { useUi } from '../state/ui';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  const copy = useCopy();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      {copy.offline}
    </div>
  );
}

export function RpcBanner() {
  const copy = useCopy();
  const { demo, retry } = useChain();
  if (!demo || demo.forced) return null;
  return (
    <div className="rpc-banner" role="status">
      <span>{demo.reason}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={retry}>{copy.rpcRetry}</button>
    </div>
  );
}

export function FundsHint({ message }: { message: string | null | undefined }) {
  const { openWallet } = useUi();
  if (!message) return null;
  const gas = /gas|native|insufficient|tUSDC|balance/i.test(message);
  return (
    <p className="info-warn funds-hint" role="alert">
      {message}{' '}
      {gas && <button type="button" className="link-btn" onClick={() => openWallet()}>Get test funds</button>}
    </p>
  );
}
