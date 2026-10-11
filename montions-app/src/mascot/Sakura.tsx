import { useMemo } from 'react';
import './mascot.css';

const PETAL =
  'M0,-7 C2.4,-7 5.2,-3.6 5.4,-0.6 C5.6,2.4 3.2,5.6 0,7.4 C-3.2,5.6 -5.6,2.4 -5.4,-0.6 C-5.2,-3.6 -2.4,-7 0,-7 Z';

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Sakura({
  count = 16,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const petals = useMemo(() => {
    const rng = mulberry32(20261011);
    return Array.from({ length: count }, (_, i) => {
      const n = rng();
      return {
        id: i,
        left: rng() * 100,
        delay: rng() * 10,
        duration: 9 + rng() * 11,
        size: 9 + rng() * 13,
        drift: `${30 + rng() * 150}px`, // biased right: petals ride the same wind as the sakura tree
        rot: `${Math.round(rng() * 360)}deg`,
        opacity: 0.5 + rng() * 0.45,
        color: n > 0.55 ? '#ffb7c5' : n > 0.22 ? '#ffc9d6' : '#ffdfe8',
        stroke: '#ff8fab',
      };
    });
  }, [count]);

  return (
    <div className={['sakura', className ?? ''].filter(Boolean).join(' ')} aria-hidden>
      {petals.map((p) => (
        <svg
          key={p.id}
          className="sakura__petal"
          viewBox="-8 -8 16 16"
          width={p.size}
          height={p.size}
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            opacity: p.opacity,
            ['--drift' as string]: p.drift,
            ['--rot' as string]: p.rot,
          }}
        >
          <path d={PETAL} fill={p.color} stroke={p.stroke} strokeWidth="0.7" />
        </svg>
      ))}
    </div>
  );
}
