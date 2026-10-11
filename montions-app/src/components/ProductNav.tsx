import { useCopy } from '../copy';
import { Link } from '../state/route';
import { useRoute } from '../state/route';

export function ProductNav({ disabled = false }: { disabled?: boolean }) {
  const copy = useCopy();
  const { route } = useRoute();
  const items = [
    { to: '/', id: 'home' as const, label: copy.nav.prices, match: route.name === 'home' },
    { to: '/predictions', id: 'predictions' as const, label: copy.nav.predictions, match: route.name === 'predictions' || route.name === 'event' },
    { to: '/markets', id: 'markets' as const, label: copy.nav.markets, match: route.name === 'markets' },
  ];
  return (
    <nav className="product-nav" aria-label="Product">
      {items.map((it) => (
        <Link
          key={it.id}
          to={it.to}
          className={`product-nav__btn${it.match ? ' is-on' : ''}`}
          aria-current={it.match ? 'page' : undefined}
          onClick={(e) => { if (disabled) e.preventDefault(); }}
          tabIndex={disabled ? -1 : undefined}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
