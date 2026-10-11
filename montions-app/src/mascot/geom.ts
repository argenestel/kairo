/** 4-point sparkle (diamond-star) used in excited eyes and Sparkles. */
export function sparklePath(cx: number, cy: number, r: number): string {
  const n = r * 0.22;
  return [
    `M ${cx} ${cy - r}`,
    `C ${cx + n} ${cy - n}, ${cx + n} ${cy - n}, ${cx + r} ${cy}`,
    `C ${cx + n} ${cy + n}, ${cx + n} ${cy + n}, ${cx} ${cy + r}`,
    `C ${cx - n} ${cy + n}, ${cx - n} ${cy + n}, ${cx - r} ${cy}`,
    `C ${cx - n} ${cy - n}, ${cx - n} ${cy - n}, ${cx} ${cy - r} Z`,
  ].join(' ');
}

/** Classic 5-point star. */
export function star5(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}
