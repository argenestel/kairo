import { useMemo } from 'react';
import { sparklePath } from './geom';
import './mascot.css';

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['#fff4c2', '#ffd6ea', '#c8f5ef', '#e4d4ff', '#ffffff'];

export function Sparkles({
  count = 10,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const items = useMemo(() => {
    const rng = mulberry32(11011);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rng() * 100,
      top: rng() * 100,
      size: 8 + rng() * 16,
      delay: rng() * 2.4,
      duration: 1.4 + rng() * 1.8,
      color: COLORS[Math.floor(rng() * COLORS.length)],
    }));
  }, [count]);

  return (
    <div className={['sparkles', className ?? ''].filter(Boolean).join(' ')} aria-hidden>
      {items.map((s) => (
        <svg
          key={s.id}
          className="sparkle"
          viewBox="-12 -12 24 24"
          width={s.size}
          height={s.size}
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        >
          <path d={sparklePath(0, 0, 10)} fill={s.color} />
        </svg>
      ))}
    </div>
  );
}
