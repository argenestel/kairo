import { useEffect, useRef, useState } from 'react';
import { CHAINS, type ChainKey } from '../chains';
import { useCopy } from '../copy';
import { ChainGlyph, ChevronDown, Spinner } from './Icons';

interface Props {
  value: ChainKey;
  onChange: (k: ChainKey) => void;
  loading: boolean;
  disabled?: boolean;
}

export function ChainPicker({ value, onChange, loading, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const copy = useCopy();
  const current = CHAINS.find((c) => c.key === value) ?? CHAINS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const tag = (c: (typeof CHAINS)[number]) =>
    c.paused ? copy.chain.soon : c.status === 'live' ? copy.chain.live : c.status === 'coming-online' ? copy.chain.coming : copy.chain.demo;

  return (
    <div className={`chain-switch${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`chain-switch__trigger${current.status !== 'live' ? ' is-demo' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${copy.chain.network}: ${current.label} ${current.network}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {loading ? <Spinner size={14} /> : <ChainGlyph chain={current.key} size={15} />}
        <span className="chain-switch__label">{current.label}</span>
        <span className="chain-switch__net hide-sm">{current.network}</span>
        <ChevronDown size={12} className="chain-switch__chev" />
      </button>
      {open && (
        <ul className="chain-menu glass" role="listbox" aria-label={copy.chain.network}>
          {CHAINS.map((c) => {
            const active = c.key === value;
            const paused = !!c.paused;
            return (
              <li key={c.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-disabled={paused}
                  disabled={paused}
                  className={`chain-menu__opt${active ? ' is-active' : ''}${c.status === 'coming-online' || paused ? ' is-soon' : ''}`}
                  onClick={() => { if (paused) return; onChange(c.key); setOpen(false); }}
                >
                  <ChainGlyph chain={c.key} size={18} />
                  <span className="chain-menu__text">
                    <b>{c.label}</b>
                    <small>{c.network} · {c.oracleName}</small>
                  </span>
                  <span className={`chain-menu__tag chain-menu__tag--${paused ? 'coming-online' : c.status}`}>{tag(c)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
