import { useMemo } from 'react';

/**
 * UwU-only: an original, procedurally drawn cherry-blossom tree that sways in the wind, plus gusts of petals
 * blown off the canopy. Pure SVG + CSS (no rasters); deterministic so it renders the same every visit.
 */

function rng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOSSOM = ['#ffd6e4', '#ffc2d6', '#ffb0ca', '#ff9fbe', '#ffe6ef', '#fff3f7'];
const PETAL = 'M0,-7 C2.4,-7 5.2,-3.6 5.4,-0.6 C5.6,2.4 3.2,5.6 0,7.4 C-3.2,5.6 -5.6,2.4 -5.4,-0.6 C-5.2,-3.6 -2.4,-7 0,-7 Z';

/** Branch tips (x, y) per sway group; clusters of blossoms grow around them. */
const GROUPS: { tips: [number, number, number][]; cls: string }[] = [
  { cls: 'sk-sway-a', tips: [[150, 250, 70], [215, 190, 64], [95, 320, 52]] },
  { cls: 'sk-sway-b', tips: [[300, 150, 78], [370, 205, 66], [255, 215, 54]] },
  { cls: 'sk-sway-c', tips: [[455, 255, 70], [515, 325, 54], [410, 300, 50]] },
];

export function SakuraTree({ compact = false }: { compact?: boolean }) {
  const clusters = useMemo(() => {
    const r = rng(1011);
    return GROUPS.map((g) => ({
      cls: g.cls,
      blobs: g.tips.flatMap(([cx, cy, rad]) =>
        Array.from({ length: 70 }, () => {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * rad;
          return {
            x: cx + Math.cos(a) * d,
            y: cy + Math.sin(a) * d * 0.72,
            r: 4 + r() * 8,
            c: BLOSSOM[Math.floor(r() * BLOSSOM.length)],
            o: 0.78 + r() * 0.22,
          };
        }),
      ),
    }));
  }, []);

  const gust = useMemo(() => {
    const r = rng(77);
    return Array.from({ length: compact ? 10 : 22 }, (_, i) => ({
      id: i,
      left: 18 + r() * 34, // % of the tree box — starts inside the canopy
      top: 14 + r() * 26,
      delay: r() * 9,
      dur: 6 + r() * 5,
      size: 8 + r() * 9,
      dx: `${70 + r() * 70}vw`,
      dy: `${18 + r() * 40}vh`,
      rot: `${360 + Math.round(r() * 540)}deg`,
      c: BLOSSOM[Math.floor(r() * 4)],
    }));
  }, [compact]);

  return (
    <div className={`sk-tree${compact ? ' sk-tree--compact' : ''}`} aria-hidden>
      <svg viewBox="0 0 600 700" className="sk-tree__svg" preserveAspectRatio="xMidYMax meet">
        <defs>
          <linearGradient id="sk-bark" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6b3f4c" />
            <stop offset="0.55" stopColor="#8a5662" />
            <stop offset="1" stopColor="#5a3340" />
          </linearGradient>
          <radialGradient id="sk-glow" cx="0.5" cy="0.35" r="0.6">
            <stop offset="0" stopColor="#fff2f7" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffd3e2" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="300" cy="230" rx="300" ry="190" fill="url(#sk-glow)" />
        <g className="sk-sway-trunk">
          {/* trunk + limbs */}
          <path d="M282 700 C286 610 268 540 290 470 C305 420 300 380 296 330 L318 330 C322 385 330 425 318 475 C300 545 316 615 322 700 Z" fill="url(#sk-bark)" />
          <path d="M296 345 C260 300 220 280 160 258" stroke="#7a4a57" strokeWidth="16" strokeLinecap="round" fill="none" />
          <path d="M236 290 C220 250 222 220 214 192" stroke="#7a4a57" strokeWidth="10" strokeLinecap="round" fill="none" />
          <path d="M190 268 C150 290 120 305 98 322" stroke="#7a4a57" strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M304 335 C304 260 302 210 300 158" stroke="#7a4a57" strokeWidth="15" strokeLinecap="round" fill="none" />
          <path d="M302 250 C330 236 352 222 370 206" stroke="#7a4a57" strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M300 238 C282 230 268 224 256 216" stroke="#7a4a57" strokeWidth="8" strokeLinecap="round" fill="none" />
          <path d="M312 352 C370 320 410 290 452 258" stroke="#7a4a57" strokeWidth="15" strokeLinecap="round" fill="none" />
          <path d="M430 276 C460 296 490 312 514 326" stroke="#7a4a57" strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M392 302 C398 300 404 300 410 300" stroke="#7a4a57" strokeWidth="7" strokeLinecap="round" fill="none" />
        </g>
        {clusters.map((g) => (
          <g key={g.cls} className={g.cls}>
            {g.blobs.map((b, i) =>
              i % 3 === 0 ? (
                <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${(i * 37) % 72}) scale(${b.r / 7})`} opacity={b.o}>
                  {[0, 72, 144, 216, 288].map((a) => (
                    <ellipse key={a} cx="0" cy="-4.2" rx="3.1" ry="4.4" transform={`rotate(${a})`} fill={b.c} />
                  ))}
                  <circle r="1.6" fill="#ff7fa6" />
                </g>
              ) : (
                <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={b.c} opacity={b.o} />
              ),
            )}
          </g>
        ))}
        {/* a few fallen petals at the roots */}
        <g opacity="0.85">
          {[[250, 690, 20], [338, 694, -30], [212, 696, 60], [380, 690, 10], [300, 697, -60]].map(([x, y, a], i) => (
            <path key={i} d={PETAL} transform={`translate(${x} ${y}) rotate(${a}) scale(0.9)`} fill="#ffc2d6" stroke="#ff9fbe" strokeWidth="0.6" />
          ))}
        </g>
      </svg>
      <div className="sk-gust">
        {gust.map((p) => (
          <svg
            key={p.id}
            className="sk-gust__petal"
            viewBox="-8 -8 16 16"
            width={p.size}
            height={p.size}
            style={{
              left: `${p.left}%`, top: `${p.top}%`,
              animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
              ['--dx' as string]: p.dx, ['--dy' as string]: p.dy, ['--rot' as string]: p.rot,
            }}
          >
            <path d={PETAL} fill={p.c} stroke="#ff8fab" strokeWidth="0.6" />
          </svg>
        ))}
      </div>
    </div>
  );
}
