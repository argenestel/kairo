import { useEffect, useRef, useState } from 'react';
import { useCopy } from '../copy';
import { Link, useRoute } from '../state/route';

/** Primary product links + a "Learn" menu (paper, docs, thesis). `variant="list"` renders everything flat (mobile menu). */
export function ProductNav({ disabled = false, variant = 'bar', onNavigate }: { disabled?: boolean; variant?: 'bar' | 'list'; onNavigate?: () => void }) {
  const copy = useCopy();
  const { route } = useRoute();
  const path = typeof location !== 'undefined' ? location.pathname : '/';
  const primary = [
    { to: '/', id: 'home', label: copy.nav.prices, match: route.name === 'home' },
    { to: '/predictions', id: 'predictions', label: copy.nav.predictions, match: route.name === 'predictions' || route.name === 'event' },
    { to: '/markets', id: 'markets', label: copy.nav.markets, match: route.name === 'markets' },
  ];
  const learn = (['paper', 'docs', 'thesis'] as const).map((p) => ({
    to: `/${p}`, id: p, label: p[0].toUpperCase() + p.slice(1),
    match: path === `/${p}` || path.startsWith(`/${p}/`),
  }));
  const learnOn = learn.some((l) => l.match);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);

  const link = (it: { to: string; id: string; label: string; match: boolean }, cls: string) => (
    <Link
      key={it.id}
      to={it.to}
      className={`${cls}${it.match ? ' is-on' : ''}`}
      aria-current={it.match ? 'page' : undefined}
      onClick={(e) => { if (disabled) { e.preventDefault(); return; } setOpen(false); onNavigate?.(); }}
      tabIndex={disabled ? -1 : undefined}
    >
      {it.label}
    </Link>
  );

  if (variant === 'list') {
    return (
      <nav className="menu-nav" aria-label="Product">
        {primary.map((it) => link(it, 'menu-nav__link'))}
        <span className="menu-nav__group">Learn</span>
        {learn.map((it) => link(it, 'menu-nav__link menu-nav__link--sub'))}
      </nav>
    );
  }

  return (
    <nav className="product-nav" aria-label="Product">
      {primary.map((it) => link(it, 'product-nav__btn'))}
      <div className={`learn${open ? ' is-open' : ''}`} ref={ref}>
        <button
          type="button"
          className={`product-nav__btn learn__btn${learnOn ? ' is-on' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          disabled={disabled}
        >
          Learn <span className="learn__chev" aria-hidden>▾</span>
        </button>
        {open && (
          <div className="learn__menu glass" role="menu">
            {learn.map((it) => link(it, 'learn__item'))}
          </div>
        )}
      </div>
    </nav>
  );
}
