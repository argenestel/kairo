import { useEffect, useRef, useState } from 'react';
import { fmtPrice } from '../lib/format';

/** Price text that flashes green/red on each tick. */
export function LivePrice({ value, className }: { value: number; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    const p = prev.current;
    prev.current = value;
    if (fmtPrice(value) === fmtPrice(p)) return;
    setDir(value > p ? 'up' : 'down');
    const t = setTimeout(() => setDir(null), 650);
    return () => clearTimeout(t);
  }, [value]);
  return <span className={`live-price num${dir ? ` flash-${dir}` : ''} ${className ?? ''}`}>{value > 0 ? fmtPrice(value) : '—'}</span>;
}
