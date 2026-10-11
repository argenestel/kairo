import type { ReactNode } from 'react';
import type { AssetInfo } from '../chains/types';
import type { Draft } from '../state/flow';
import { S } from '../state/flow';
import { fmtDayShort, fmtMoney, fmtStrike } from '../lib/format';
import { AssetIcon } from './AssetIcon';
import { ArrowDown, ArrowUp } from './Icons';

interface Props {
  draft: Draft;
  asset: AssetInfo | null;
  step: number;
  reached: number;
  onGo: (step: number) => void;
}

/** "I think [SOL] will be [↑ above] [$120.00] by [Oct 18] with [$100]" — filled pills jump back to their step. */
export function SentenceBar({ draft, asset, step, reached, onGo }: Props) {
  const pill = (i: number, filled: boolean, content: ReactNode, label: string) => {
    const shown = filled && i <= reached;
    return (
      <button
        type="button"
        className={`pill${shown ? ' pill--filled' : ' pill--empty'}${i === step ? ' pill--current' : ''}`}
        onClick={() => shown && onGo(i)}
        disabled={!shown || i === step}
        aria-label={shown ? `${label}: change` : `${label}: not chosen yet`}
        tabIndex={shown && i !== step ? 0 : -1}
      >
        {shown ? content : <span className="pill__ghost" />}
      </button>
    );
  };
  const step0 = asset?.strikeStep ?? 1;
  return (
    <div className="sentence" aria-label="Your sentence">
      <span className="sentence__word">I think</span>
      {pill(S.asset, !!draft.symbol, <><AssetIcon symbol={draft.symbol ?? ''} size={16} /><b>{draft.symbol}</b></>, 'Asset')}
      <span className="sentence__word">will be</span>
      {pill(S.direction, true, draft.direction === 'above'
        ? <><ArrowUp size={14} className="up" /><b>above</b></>
        : <><ArrowDown size={14} className="down" /><b>below</b></>, 'Direction')}
      {pill(S.strike, draft.strike != null, <b className="num">{draft.strike != null ? fmtStrike(draft.strike, step0) : ''}</b>, 'Price level')}
      <span className="sentence__word">by</span>
      {pill(S.expiry, draft.expiry != null, <b>{draft.expiry != null ? fmtDayShort(draft.expiry) : ''}</b>, 'Date')}
      <span className="sentence__word">with</span>
      {pill(S.amount, draft.budget > 0, <b className="num">{fmtMoney(draft.budget)}</b>, 'Amount')}
    </div>
  );
}
