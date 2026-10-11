/**
 * Procedural night sky + flowering meadow. One 2D canvas, layered:
 *   sky gradient + static stars (pre-rendered) → twinkling stars → aurora (low-res, upscaled = free blur)
 *   → 4 hill layers (body + foliage + flowers pre-rendered; grass blades and flower heads on the ridge sway live)
 *   → fireflies → occasional shooting star.
 * Pointer parallax, pauses when the tab is hidden, single static frame under prefers-reduced-motion.
 */

export type Mood = 'neutral' | 'up' | 'down';

export interface SceneHandle {
  setMood(m: Mood): void;
  setReduced(r: boolean): void;
  reloadTheme(): void;
  destroy(): void;
}

type RGB = [number, number, number];

interface LayerCfg {
  depth: number;      // parallax + brightness 0..1
  center: number;     // ridge height at the centre (fraction of H)
  left: number;       // ridge height at the left edge
  right: number;      // ridge height at the right edge
  pow: number;        // valley shape
  color: string;      // body colour (top)
  colorLow: string;   // body colour (bottom)
  bladeSpacing: number;
  bladeH: [number, number];
  flowerSpacing: number;
  flowerScale: number;
  bodyFlowerDensity: number; // flowers per 1000 px² of body
  seed: number;
}

interface Blade { x: number; y: number; h: number; lean: number; c: number }
interface Flower { x: number; y: number; h: number; r: number; c: number; glow: boolean; phase: number }

interface Layer {
  cfg: LayerCfg;
  ridge: Float32Array; // ridge y every RIDGE_STEP px from -MARGIN
  canvas: HTMLCanvasElement;
  top: number;         // canvas y offset
  blades: Blade[];
  flowers: Flower[];
}

const MARGIN = 48;
const RIDGE_STEP = 2;

const FLOWER_COLORS = ['#5d7fe0', '#86a7ff', '#e9b949', '#f0973c', '#e3e9f3', '#a993f2', '#6bc3ff'];
const FLOWER_WEIGHTS = [0.22, 0.16, 0.2, 0.1, 0.17, 0.07, 0.08];
const BLADE_COLORS: string[][] = [
  ['rgba(36,62,64,0.9)', 'rgba(28,52,58,0.9)', 'rgba(44,74,70,0.85)'],
  ['rgba(34,66,56,0.92)', 'rgba(26,54,48,0.92)', 'rgba(48,84,64,0.85)'],
  ['rgba(40,78,54,0.95)', 'rgba(30,62,44,0.95)', 'rgba(58,98,62,0.9)'],
  ['rgba(46,92,58,1)', 'rgba(32,70,46,1)', 'rgba(70,116,70,0.95)'],
];

const MOODS: Record<Mood, [RGB, RGB]> = {
  neutral: [[86, 214, 190], [128, 112, 250]],
  up: [[61, 220, 132], [72, 196, 210]],
  down: [[255, 96, 110], [190, 90, 200]],
};

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function cssRgb(name: string, fallback: RGB): RGB {
  const raw = cssVar(name, '');
  if (!raw) return fallback;
  const p = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
  return p.length >= 3 ? [p[0], p[1], p[2]] : fallback;
}

function readMoods(): Record<Mood, [RGB, RGB]> {
  return {
    neutral: [cssRgb('--scene-mood-neutral-a', MOODS.neutral[0]), cssRgb('--scene-mood-neutral-b', MOODS.neutral[1])],
    up: [cssRgb('--scene-mood-up-a', MOODS.up[0]), cssRgb('--scene-mood-up-b', MOODS.up[1])],
    down: [cssRgb('--scene-mood-down-a', MOODS.down[0]), cssRgb('--scene-mood-down-b', MOODS.down[1])],
  };
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rnd: () => number, weights: number[]) {
  let r = rnd();
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function glowSprite(rgb: string, size = 64) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${rgb},0.9)`);
  grd.addColorStop(0.25, `rgba(${rgb},0.35)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export function createScene(canvas: HTMLCanvasElement, opts: { reduced: boolean }): SceneHandle {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let reduced = opts.reduced;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let sky: HTMLCanvasElement | null = null;
  let layers: Layer[] = [];
  let twinkles: { x: number; y: number; r: number; a: number; s: number; p: number }[] = [];
  let fireflies: { x: number; y: number; vx: number; ph: number; f: number; amp: number }[] = [];
  let aurora: HTMLCanvasElement | null = null;
  let auroraCtx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let running = false;
  let last = 0;
  let t = 0;
  let frame = 0;
  let mood: Mood = 'neutral';
  let moods = readMoods();
  const moodNow: [RGB, RGB] = [[...moods.neutral[0]] as RGB, [...moods.neutral[1]] as RGB];
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  let nextShoot = 6 + Math.random() * 8;
  const flowerGlow = glowSprite('255,236,170', 48);
  const blueGlow = glowSprite('150,180,255', 48);
  const fireflySprite = glowSprite('226,255,160', 64);

  function layerCfgs(): LayerCfg[] {
    const portrait = W / H < 0.85;
    const lift = portrait ? 0.05 : 0;
    const flat = portrait ? 0.55 : 1;
    const sc = Math.min(1.25, Math.max(0.75, W / 1440));
    const mk = (c: Omit<LayerCfg, 'center' | 'left' | 'right'> & { center: number; left: number; right: number }): LayerCfg => ({
      ...c,
      center: c.center + lift,
      left: c.center + lift + (c.left - c.center) * flat,
      right: c.center + lift + (c.right - c.center) * flat,
    });
    return [
      mk({ depth: 0.18, center: 0.74, left: 0.6, right: 0.5, pow: 2.1, color: cssVar('--scene-hill-0', '#0a1620'), colorLow: cssVar('--scene-hill-0-low', '#060d14'), bladeSpacing: 6.5, bladeH: [4 * sc, 9 * sc], flowerSpacing: 26, flowerScale: 0.6 * sc, bodyFlowerDensity: 0.55, seed: 11 }),
      mk({ depth: 0.38, center: 0.8, left: 0.66, right: 0.58, pow: 2.3, color: cssVar('--scene-hill-1', '#0b1b20'), colorLow: cssVar('--scene-hill-1-low', '#071015'), bladeSpacing: 5, bladeH: [5 * sc, 12 * sc], flowerSpacing: 17, flowerScale: 0.8 * sc, bodyFlowerDensity: 0.7, seed: 23 }),
      mk({ depth: 0.66, center: 0.87, left: 0.75, right: 0.66, pow: 2.5, color: cssVar('--scene-hill-2', '#0d211f'), colorLow: cssVar('--scene-hill-2-low', '#081311'), bladeSpacing: 3.6, bladeH: [7 * sc, 16 * sc], flowerSpacing: 11, flowerScale: 1.05 * sc, bodyFlowerDensity: 0.85, seed: 37 }),
      mk({ depth: 1.0, center: 0.95, left: 0.82, right: 0.8, pow: 2.8, color: cssVar('--scene-hill-3', '#0f261f'), colorLow: cssVar('--scene-hill-3-low', '#091612'), bladeSpacing: 2.8, bladeH: [9 * sc, 22 * sc], flowerSpacing: 7.5, flowerScale: 1.35 * sc, bodyFlowerDensity: 1.0, seed: 53 }),
    ];
  }

  function ridgeAt(l: Layer, x: number) {
    const i = (x + MARGIN) / RIDGE_STEP;
    const i0 = Math.max(0, Math.min(l.ridge.length - 1, Math.floor(i)));
    const i1 = Math.min(l.ridge.length - 1, i0 + 1);
    const f = i - i0;
    return l.ridge[i0] * (1 - f) + l.ridge[i1] * f;
  }

  function buildSky() {
    sky = makeCanvas(W * dpr, H * dpr);
    const g = sky.getContext('2d')!;
    g.scale(dpr, dpr);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, cssVar('--scene-sky-0', '#03050b'));
    grd.addColorStop(0.45, cssVar('--scene-sky-1', '#060b17'));
    grd.addColorStop(0.72, cssVar('--scene-sky-2', '#0a1424'));
    grd.addColorStop(1, cssVar('--scene-sky-3', '#0b1520'));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // horizon moon-glow
    const rg = g.createRadialGradient(W * 0.5, H * 0.78, 0, W * 0.5, H * 0.78, Math.max(W, H) * 0.65);
    const hz = cssVar('--scene-horizon', '70,120,180');
    rg.addColorStop(0, `rgba(${hz},0.16)`);
    rg.addColorStop(0.5, `rgba(${hz},0.06)`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    // stars
    const rnd = mulberry32(7);
    const n = Math.round((W * H) / 3800);
    twinkles = [];
    for (let i = 0; i < n; i++) {
      const x = rnd() * W;
      const y = Math.pow(rnd(), 1.35) * H * 0.82;
      const r = rnd() < 0.92 ? 0.35 + rnd() * 0.6 : 0.9 + rnd() * 0.7;
      const a = (0.25 + rnd() * 0.65) * (1 - y / (H * 0.95));
      if (rnd() < 0.16) {
        twinkles.push({ x, y, r, a, s: 0.6 + rnd() * 2.2, p: rnd() * Math.PI * 2 });
      } else {
        g.fillStyle = `rgba(${220 + rnd() * 35},${225 + rnd() * 30},255,${a.toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    // a faint milky band
    g.save();
    g.translate(W * 0.15, H * 0.05);
    g.rotate(0.32);
    const band = g.createLinearGradient(0, -H * 0.12, 0, H * 0.12);
    band.addColorStop(0, 'rgba(120,140,200,0)');
    band.addColorStop(0.5, 'rgba(120,140,200,0.045)');
    band.addColorStop(1, 'rgba(120,140,200,0)');
    g.fillStyle = band;
    g.fillRect(-W * 0.2, -H * 0.12, W * 1.4, H * 0.24);
    for (let i = 0; i < n * 0.5; i++) {
      const x = -W * 0.2 + rnd() * W * 1.4;
      const y = (rnd() + rnd() + rnd() - 1.5) * H * 0.07;
      g.fillStyle = `rgba(210,220,255,${(0.1 + rnd() * 0.35).toFixed(3)})`;
      g.fillRect(x, y, 0.8, 0.8);
    }
    g.restore();
  }

  function buildLayer(cfg: LayerCfg): Layer {
    const rnd = mulberry32(cfg.seed * 7919 + Math.round(W));
    const count = Math.ceil((W + MARGIN * 2) / RIDGE_STEP) + 1;
    const ridge = new Float32Array(count);
    const waves = Array.from({ length: 4 }, (_, k) => ({ a: (0.006 + rnd() * 0.012) / (k + 1), f: (0.002 + rnd() * 0.004) * (k + 1), p: rnd() * 10 }));
    let minY = H;
    for (let i = 0; i < count; i++) {
      const x = -MARGIN + i * RIDGE_STEP;
      const u = (x - W / 2) / (W / 2);
      const side = u < 0 ? cfg.left : cfg.right;
      const base = cfg.center + (side - cfg.center) * Math.pow(Math.min(1.15, Math.abs(u)), cfg.pow);
      let n = 0;
      for (const w of waves) n += w.a * Math.sin(x * w.f + w.p);
      const y = H * (base + n);
      ridge[i] = y;
      if (y < minY) minY = y;
    }
    const top = Math.max(0, Math.floor(minY - 40));
    const cw = W + MARGIN * 2;
    const ch = H - top + 30;
    const c = makeCanvas(cw * dpr, ch * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.translate(MARGIN, -top);
    const layer: Layer = { cfg, ridge, canvas: c, top, blades: [], flowers: [] };

    // body
    g.beginPath();
    g.moveTo(-MARGIN, H + 30);
    for (let i = 0; i < count; i++) g.lineTo(-MARGIN + i * RIDGE_STEP, ridge[i]);
    g.lineTo(W + MARGIN, H + 30);
    g.closePath();
    const grd = g.createLinearGradient(0, minY, 0, H);
    grd.addColorStop(0, cfg.color);
    grd.addColorStop(1, cfg.colorLow);
    g.fillStyle = grd;
    g.fill();
    g.save();
    g.clip();
    // foliage clumps (texture)
    const area = cw * (H - minY);
    const clumps = Math.round((area / 1000) * 1.6);
    for (let i = 0; i < clumps; i++) {
      const x = -MARGIN + rnd() * cw;
      const ry = ridgeAt(layer, x);
      const y = ry + Math.pow(rnd(), 1.6) * (H - ry);
      const r = (2 + rnd() * 7) * (0.5 + cfg.depth * 0.8);
      const light = rnd() < 0.5;
      g.fillStyle = light ? `rgba(70,120,100,${0.05 + rnd() * 0.07})` : `rgba(0,6,8,${0.12 + rnd() * 0.18})`;
      g.beginPath();
      g.ellipse(x, y, r * 1.4, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    // static flowers inside the body, brighter near the ridge (moonlight)
    const nf = Math.round((area / 1000) * cfg.bodyFlowerDensity * 1.4);
    const dim = 0.35 + cfg.depth * 0.6;
    for (let i = 0; i < nf; i++) {
      const x = -MARGIN + rnd() * cw;
      const ry = ridgeAt(layer, x);
      const depthIn = Math.pow(rnd(), 1.9);
      const y = ry + 4 + depthIn * (H - ry);
      const ci = pickWeighted(rnd, FLOWER_WEIGHTS);
      const r = (0.7 + rnd() * 1.6) * cfg.flowerScale * (1 - depthIn * 0.35);
      g.globalAlpha = dim * (1 - depthIn * 0.75) * (0.55 + rnd() * 0.45);
      g.fillStyle = FLOWER_COLORS[ci];
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (rnd() < 0.25) {
        // small cluster
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.arc(x + (rnd() - 0.5) * r * 6, y + (rnd() - 0.5) * r * 3, r * (0.5 + rnd() * 0.5), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
    g.restore();
    // rim light
    g.beginPath();
    for (let i = 0; i < count; i++) {
      const x = -MARGIN + i * RIDGE_STEP;
      if (i === 0) g.moveTo(x, ridge[i]); else g.lineTo(x, ridge[i]);
    }
    g.strokeStyle = `rgba(150,200,230,${0.05 + cfg.depth * 0.05})`;
    g.lineWidth = 1;
    g.stroke();

    // live blades along the ridge
    for (let x = -MARGIN; x < W + MARGIN; x += cfg.bladeSpacing * (0.6 + rnd() * 0.8)) {
      const ry = ridgeAt(layer, x);
      layer.blades.push({
        x, y: ry + rnd() * 5 * (0.4 + cfg.depth),
        h: cfg.bladeH[0] + rnd() * (cfg.bladeH[1] - cfg.bladeH[0]),
        lean: (rnd() - 0.5) * 0.7, c: Math.floor(rnd() * 3),
      });
    }
    // live flowers on stems along the ridge
    for (let x = -MARGIN; x < W + MARGIN; x += cfg.flowerSpacing * (0.4 + rnd() * 1.2)) {
      const ry = ridgeAt(layer, x);
      const ci = pickWeighted(rnd, FLOWER_WEIGHTS);
      layer.flowers.push({
        x, y: ry + rnd() * 6 * (0.4 + cfg.depth),
        h: (cfg.bladeH[0] + rnd() * cfg.bladeH[1]) * 0.9,
        r: (1 + rnd() * 1.5) * cfg.flowerScale,
        c: ci, glow: rnd() < 0.09 * cfg.depth, phase: rnd() * Math.PI * 2,
      });
    }
    return layer;
  }

  function buildFireflies() {
    const rnd = mulberry32(99);
    const n = Math.round(Math.min(22, Math.max(8, W / 70)));
    fireflies = Array.from({ length: n }, () => ({
      x: rnd() * W, y: H * (0.6 + rnd() * 0.3), vx: (rnd() - 0.5) * 6,
      ph: rnd() * 10, f: 0.3 + rnd() * 0.6, amp: 8 + rnd() * 18,
    }));
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, W < 700 ? 2 : 1.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    buildSky();
    layers = layerCfgs().map(buildLayer);
    buildFireflies();
    aurora = makeCanvas(Math.ceil(W / 6), Math.ceil(H / 6));
    auroraCtx = aurora.getContext('2d');
    drawAurora();
    draw();
  }

  function wind(x: number, depth: number) {
    const gust = Math.pow(Math.max(0, Math.sin(t * 0.21 + 0.8)), 3);
    return (0.5 * Math.sin(t * 1.05 + x * 0.011) + 0.28 * Math.sin(t * 2.2 + x * 0.029 + 1.7) + gust * 0.55) * (0.35 + depth * 0.65);
  }

  function drawAurora() {
    if (!aurora || !auroraCtx) return;
    const g = auroraCtx;
    const w = aurora.width;
    const h = aurora.height;
    g.clearRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) {
      const [cr, cg, cb] = moodNow[r];
      const baseY = h * (0.2 + r * 0.09);
      const grd = g.createLinearGradient(0, baseY - h * 0.16, 0, baseY + h * 0.16);
      grd.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
      grd.addColorStop(0.55, `rgba(${cr},${cg},${cb},${r === 0 ? 0.035 : 0.02})`);
      grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = grd;
      g.beginPath();
      const ys: number[] = [];
      for (let x = 0; x <= w; x += 3) {
        const y = baseY + Math.sin(x * 0.022 + t * 0.06 + r * 2) * h * 0.05 + Math.sin(x * 0.061 - t * 0.09 + r) * h * 0.018;
        ys.push(y);
        if (x === 0) g.moveTo(x, y - h * 0.12); else g.lineTo(x, y - h * 0.12 - Math.sin(x * 0.04 + t * 0.05) * h * 0.03);
      }
      for (let x = w, i = ys.length - 1; i >= 0; x -= 3, i--) g.lineTo(x, ys[i] + h * 0.06);
      g.closePath();
      g.fill();
    }
  }

  function draw() {
    if (!sky) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sky, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = pointer.x;
    const py = pointer.y;

    // twinkles (tiny parallax)
    for (const s of twinkles) {
      const a = s.a * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.s + s.p)));
      ctx.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`;
      const x = s.x - px * 3;
      const y = s.y - py * 2;
      if (s.r > 1) {
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(x - s.r, y - s.r, s.r * 2, s.r * 2);
    }

    // shooting star
    if (shooting) {
      const s = shooting;
      const tail = 90;
      const grd = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.12 * tail / 40, s.y - s.vy * 0.12 * tail / 40);
      const a = Math.min(1, s.life * 2) * Math.min(1, (1 - s.life) * 4);
      grd.addColorStop(0, `rgba(255,255,255,${(0.85 * a).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grd;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.12 * tail / 40, s.y - s.vy * 0.12 * tail / 40);
      ctx.stroke();
    }

    // aurora
    if (aurora) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(aurora, -px * 6, -py * 3, W + 12, H + 6);
      ctx.globalCompositeOperation = 'source-over';
    }

    // hills
    for (let li = 0; li < layers.length; li++) {
      const l = layers[li];
      const d = l.cfg.depth;
      const ox = -px * d * 22;
      const oy = -py * d * 7 + (1 - d) * 0;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.drawImage(l.canvas, -MARGIN, l.top, (W + MARGIN * 2), l.canvas.height / dpr);

      // blades, batched by colour
      const cols = BLADE_COLORS[li] ?? BLADE_COLORS[3];
      ctx.lineCap = 'round';
      for (let c = 0; c < 3; c++) {
        ctx.beginPath();
        for (const b of l.blades) {
          if (b.c !== c) continue;
          const sway = b.lean + wind(b.x, d) * 0.45;
          ctx.moveTo(b.x, b.y);
          ctx.quadraticCurveTo(b.x + sway * b.h * 0.25, b.y - b.h * 0.6, b.x + sway * b.h, b.y - b.h);
        }
        ctx.strokeStyle = cols[c];
        ctx.lineWidth = 0.7 + d * 0.9;
        ctx.stroke();
      }
      // flower stems
      ctx.beginPath();
      for (const f of l.flowers) {
        const sway = wind(f.x, d) * 0.35 + Math.sin(f.phase) * 0.12;
        ctx.moveTo(f.x, f.y);
        ctx.quadraticCurveTo(f.x + sway * f.h * 0.3, f.y - f.h * 0.6, f.x + sway * f.h, f.y - f.h);
      }
      ctx.strokeStyle = cols[1];
      ctx.lineWidth = 0.6 + d * 0.5;
      ctx.stroke();
      // flower heads, batched by colour
      const alpha = 0.5 + d * 0.48;
      ctx.globalAlpha = alpha;
      for (let c = 0; c < FLOWER_COLORS.length; c++) {
        ctx.beginPath();
        for (const f of l.flowers) {
          if (f.c !== c) continue;
          const sway = wind(f.x, d) * 0.35 + Math.sin(f.phase) * 0.12;
          const hx = f.x + sway * f.h;
          const hy = f.y - f.h;
          ctx.moveTo(hx + f.r, hy);
          ctx.arc(hx, hy, f.r, 0, Math.PI * 2);
        }
        ctx.fillStyle = FLOWER_COLORS[c];
        ctx.fill();
      }
      // a few glowing heads
      ctx.globalCompositeOperation = 'lighter';
      for (const f of l.flowers) {
        if (!f.glow) continue;
        const sway = wind(f.x, d) * 0.35 + Math.sin(f.phase) * 0.12;
        const s = f.r * 9;
        const a = 0.22 + 0.12 * Math.sin(t * 1.3 + f.phase);
        ctx.globalAlpha = a;
        ctx.drawImage(f.c === 2 || f.c === 3 ? flowerGlow : blueGlow, f.x + sway * f.h - s / 2, f.y - f.h - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();

      // fireflies drift between the middle and front layers
      if (li === 2) drawFireflies(px, py);
    }
  }

  function drawFireflies(px: number, py: number) {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      const x = ((f.x + f.vx * t + Math.sin(t * f.f + f.ph) * f.amp) % (W + 40) + W + 40) % (W + 40) - 20 - px * 14;
      const y = f.y + Math.sin(t * f.f * 1.3 + f.ph * 2) * f.amp * 0.6 - py * 5;
      const a = Math.max(0, Math.sin(t * f.f * 1.7 + f.ph)) * 0.85;
      if (a < 0.03) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(fireflySprite, x - 9, y - 9, 18, 18);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function step(ts: number) {
    if (!running) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    t += dt;
    frame++;
    // pointer smoothing
    const k = 1 - Math.exp(-dt * 3);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    // mood colour easing
    const km = 1 - Math.exp(-dt * 1.5);
    const target = moods[mood];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) moodNow[r][c] += (target[r][c] - moodNow[r][c]) * km;
    if (frame % 3 === 0) drawAurora();
    // shooting stars
    nextShoot -= dt;
    if (!shooting && nextShoot <= 0) {
      shooting = { x: W * (0.1 + Math.random() * 0.6), y: H * (0.05 + Math.random() * 0.2), vx: 520 + Math.random() * 300, vy: 160 + Math.random() * 120, life: 0 };
      nextShoot = 9 + Math.random() * 12;
    }
    if (shooting) {
      shooting.x += shooting.vx * dt;
      shooting.y += shooting.vy * dt;
      shooting.life += dt / 0.9;
      if (shooting.life >= 1) shooting = null;
    }
    draw();
    raf = requestAnimationFrame(step);
  }

  function start() {
    if (running || reduced || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(step);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const onVis = () => (document.hidden ? stop() : start());
  const onMove = (e: PointerEvent) => {
    if (reduced) return;
    pointer.tx = (e.clientX / Math.max(1, W)) * 2 - 1;
    pointer.ty = (e.clientY / Math.max(1, H)) * 2 - 1;
  };
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  };

  resize();
  start();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('resize', onResize);

  return {
    setMood(m) {
      mood = m;
      if (reduced) {
        const target = moods[m];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) moodNow[r][c] = target[r][c];
        drawAurora();
        draw();
      }
    },
    setReduced(r) {
      reduced = r;
      if (r) { stop(); pointer.x = pointer.y = pointer.tx = pointer.ty = 0; draw(); } else start();
    },
    reloadTheme() {
      moods = readMoods();
      const target = moods[mood];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) moodNow[r][c] = target[r][c];
      resize();
    },
    destroy() {
      stop();
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
    },
  };
}
