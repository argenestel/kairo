import { useMemo, useState } from 'react';
import { Ruler } from '../components/Ruler';
import { PayoutSimulator } from '../components/Payoff';
import { Spinner } from '../components/Icons';
import { useChain } from '../state/chain';
import { fmtCents, fmtContracts, fmtMoney, fmtMonthDay, fmtClock, isSameUtcDay, nowSec } from '../lib/format';
import { useQuote } from '../lib/hooks';
import { sigmaMove } from '../lib/model';
import { AMOUNTS, amountModel, nearestAmountIndex } from '../lib/timeline';
import { BookDisclosure } from '../components/BookPanel';
import { FundsHint } from '../components/OfflineBanner';
import { effective, type StepProps } from './common';

export function AmountStep({ flow, dispatch, asset, compact }: StepProps) {
  const d = flow.draft;
  const { balances, address, adapter } = useChain();
  const [typing, setTyping] = useState(false);
  const [simPrice, setSimPrice] = useState<number | null>(null);
  const spacing = compact ? 12 : 14;
  const model = useMemo(() => amountModel(spacing), [spacing]);
  const idx = nearestAmountIndex(d.budget);
  const { quote, stale, loading } = useQuote(
    d.symbol && d.strike != null && d.expiry != null ? { symbol: d.symbol, strike: d.strike, expiry: d.expiry, direction: d.direction, budget: d.budget } : null,
  );
  const eff = effective(quote, stale, asset, d.direction, d.strike, d.expiry, d.budget);
  const side = d.direction === 'above' ? 'YES' : 'NO';
  const collateral = adapter?.meta.collateralSymbol ?? 'tUSDC';
  const short = balances && balances.collateral < d.budget;
  const expLabel = d.expiry != null ? (isSameUtcDay(d.expiry, nowSec()) ? `${fmtClock(d.expiry)} UTC` : fmtMonthDay(d.expiry)) : '';

  const setBudget = (v: number) => dispatch({ type: 'set', patch: { budget: Math.max(1, Math.min(1000, Math.round(v * 100) / 100)) }, user: true });

  return (
    <div className="amount-step">
      {typing ? (
        <div className="big-amount-input">
          <span>$</span>
          <label className="sr-only" htmlFor="amount-input">Amount in dollars</label>
          <input
            id="amount-input"
            type="number"
            inputMode="decimal"
            min={1}
            max={1000}
            step={1}
            autoFocus
            defaultValue={d.budget}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = Number((e.target as HTMLInputElement).value); if (v >= 1) setBudget(v); setTyping(false); }
              if (e.key === 'Escape') { e.stopPropagation(); setTyping(false); }
            }}
            onBlur={(e) => { const v = Number(e.target.value); if (v >= 1) setBudget(v); setTyping(false); }}
          />
        </div>
      ) : (
        <button className="big-amount num" onClick={() => setTyping(true)} aria-label={`Amount ${fmtMoney(d.budget)}. Click to type an amount.`}>
          {fmtMoney(d.budget)}
        </button>
      )}
      <p className="big-sub">
        {eff ? (
          <>buys <b className="num">{eff.estimated ? '~' : ''}{fmtContracts(eff.contracts)}</b> {side} contracts at <b>{fmtCents(eff.price)}</b> · max loss <b className="num">{fmtMoney(eff.cost || d.budget, 2)}</b></>
        ) : '—'}
        {loading && <Spinner size={11} />}
      </p>

      <Ruler
        length={model.length}
        ticks={model.ticks}
        stops={model.stops}
        index={idx}
        onChange={(i) => setBudget(AMOUNTS[i])}
        height={compact ? 92 : 104}
        curve={compact ? 10 : 16}
        ariaLabel="Amount to put in"
        valueText={(i) => fmtMoney(AMOUNTS[i])}
        autoFocus
        pageStep={5}
        className="ruler--amount"
      />

      {eff && asset && d.strike != null && d.expiry != null && (
        <PayoutSimulator
          symbol={asset.symbol}
          direction={d.direction}
          spot={asset.price}
          strike={d.strike}
          strikeStep={asset.strikeStep}
          cost={eff.cost || d.budget}
          payout={eff.payout}
          sigma={sigmaMove(asset.vol, d.expiry - Date.now() / 1000)}
          expiryLabel={expLabel}
          value={simPrice}
          onValue={setSimPrice}
        />
      )}
      {eff && !eff.tradable && eff.reason && <p className="info-warn center">{eff.reason}</p>}
      {address && short && (
        <FundsHint message={`Your balance is ${fmtMoney(balances!.collateral, 2)} ${collateral}.`} />
      )}
      {d.symbol && d.strike != null && d.expiry != null && (
        <BookDisclosure market={{ symbol: d.symbol, strike: d.strike, expiry: d.expiry }} />
      )}
    </div>
  );
}
