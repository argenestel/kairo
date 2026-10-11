import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Direction } from '../chains/types';
import { PayoffMini } from '../components/Payoff';
import { ArrowDown, ArrowUp } from '../components/Icons';
import type { StepProps } from './common';

export function DirectionStep({ flow, dispatch, asset }: StepProps) {
  const dir = flow.draft.direction;
  const name = asset?.name ?? flow.draft.symbol ?? '';
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const set = (d: Direction) => dispatch({ type: 'set', patch: { direction: d } });

  useEffect(() => {
    refs.current[dir === 'above' ? 0 : 1]?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '1') { e.preventDefault(); set('above'); refs.current[0]?.focus(); }
      if (e.key === '2') { e.preventDefault(); set('below'); refs.current[1]?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const next: Direction = dir === 'above' ? 'below' : 'above';
      set(next);
      refs.current[next === 'above' ? 0 : 1]?.focus();
    }
  };

  const card = (d: Direction, i: number) => {
    const active = dir === d;
    const up = d === 'above';
    return (
      <button
        ref={(el) => { refs.current[i] = el; }}
        role="radio"
        aria-checked={active}
        tabIndex={active ? 0 : -1}
        className={`dir-card ${up ? 'dir-card--up' : 'dir-card--down'}${active ? ' is-active' : ''}`}
        onClick={() => set(d)}
        onKeyDown={onKeyDown}
      >
        <div className="dir-card__chart"><PayoffMini direction={d} active={active} /></div>
        <div className="dir-card__foot">
          <span className={`dir-card__icon ${up ? 'up-bg' : 'down-bg'}`}>{up ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</span>
          <span className="dir-card__text">
            <b>{name} will go {up ? 'up' : 'down'}</b>
            <small>{up ? 'YES · pays if above' : 'NO · pays if below'}</small>
          </span>
          <kbd className="kbd">{i + 1}</kbd>
        </div>
      </button>
    );
  };

  return (
    <div className="dir-step">
      <div className="dir-cards glass" role="radiogroup" aria-label="Your prediction">
        {card('above', 0)}
        {card('below', 1)}
      </div>
      <p className="hint">Each winning contract pays $1. If you're wrong, you lose only what you put in.</p>
    </div>
  );
}
