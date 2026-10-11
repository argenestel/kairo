import { BLUSH_DX, BLUSH_Y, FACE_CX, FACE_CY, FACE_RX, FACE_RY } from '../layout';
import type { MascotMood, MascotPalette } from '../types';

const FACE_D = [
  `M ${FACE_CX} ${FACE_CY - FACE_RY}`,
  `C ${FACE_CX + 34} ${FACE_CY - FACE_RY}, ${FACE_CX + FACE_RX} ${FACE_CY - 28}, ${FACE_CX + FACE_RX} ${FACE_CY + 2}`,
  `C ${FACE_CX + FACE_RX} ${FACE_CY + 32}, ${FACE_CX + 30} ${FACE_CY + FACE_RY - 2}, ${FACE_CX} ${FACE_CY + FACE_RY}`,
  `C ${FACE_CX - 30} ${FACE_CY + FACE_RY - 2}, ${FACE_CX - FACE_RX} ${FACE_CY + 32}, ${FACE_CX - FACE_RX} ${FACE_CY + 2}`,
  `C ${FACE_CX - FACE_RX} ${FACE_CY - 28}, ${FACE_CX - 34} ${FACE_CY - FACE_RY}, ${FACE_CX} ${FACE_CY - FACE_RY} Z`,
].join(' ');

export function Ears({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__ears">
      <ellipse cx={FACE_CX - 48} cy={FACE_CY + 4} rx="9" ry="13" fill={p.skin} stroke={p.outline} strokeWidth="2.05" />
      <ellipse cx={FACE_CX - 48} cy={FACE_CY + 6} rx="4.5" ry="7" fill={p.blush} opacity="0.45" stroke="none" />
      <ellipse cx={FACE_CX + 48} cy={FACE_CY + 4} rx="9" ry="13" fill={p.skin} stroke={p.outline} strokeWidth="2.05" />
      <ellipse cx={FACE_CX + 48} cy={FACE_CY + 6} rx="4.5" ry="7" fill={p.blush} opacity="0.45" stroke="none" />
    </g>
  );
}

export function Head({ p, mood }: { p: MascotPalette; mood: MascotMood }) {
  const blush =
    mood === 'excited' || mood === 'happy' ? 0.58 : mood === 'wink' ? 0.5 : mood === 'worried' ? 0.28 : 0.4;
  return (
    <g className="mascot__head">
      <path d={FACE_D} fill={p.skin} stroke={p.outline} strokeWidth="2.2" />
      {/* cel shade, right/bottom of face */}
      <path
        d={`M ${FACE_CX + 18} ${FACE_CY - 8}
            C ${FACE_CX + 46} ${FACE_CY + 4}, ${FACE_CX + 44} ${FACE_CY + 36}, ${FACE_CX + 14} ${FACE_CY + 50}
            C ${FACE_CX + 36} ${FACE_CY + 36}, ${FACE_CX + 38} ${FACE_CY + 8}, ${FACE_CX + 18} ${FACE_CY - 8} Z`}
        fill={p.skinShadow}
        opacity="0.38"
        stroke="none"
      />
      {/* forehead shine */}
      <ellipse cx={FACE_CX - 14} cy={FACE_CY - 22} rx="16" ry="9" fill="#fff" opacity="0.28" stroke="none" />
      <ellipse cx={FACE_CX - BLUSH_DX} cy={BLUSH_Y} rx="13" ry="7.5" fill={p.blush} opacity={blush} stroke="none" />
      <ellipse cx={FACE_CX + BLUSH_DX} cy={BLUSH_Y} rx="13" ry="7.5" fill={p.blush} opacity={blush} stroke="none" />
    </g>
  );
}

export function Neck({ p }: { p: MascotPalette }) {
  return (
    <path
      d={`M ${FACE_CX - 9} 168
          C ${FACE_CX - 10} 178, ${FACE_CX - 12} 184, ${FACE_CX - 16} 188
          H ${FACE_CX + 16}
          C ${FACE_CX + 12} 184, ${FACE_CX + 10} 178, ${FACE_CX + 9} 168 Z`}
      fill={p.skin}
      stroke={p.outline}
      strokeWidth="2.05"
    />
  );
}
