import { CX, MOUTH_Y } from '../layout';
import type { MascotMood, MascotPalette } from '../types';

export function Mouth({ mood, p }: { mood: MascotMood; p: MascotPalette }) {
  const x = CX;
  const y = MOUTH_Y;
  if (mood === 'excited') {
    return (
      <g className="mascot__mouth">
        <path
          d={`M ${x - 14} ${y - 2} Q ${x} ${y - 4} ${x + 14} ${y - 2} Q ${x} ${y + 18} ${x - 14} ${y - 2} Z`}
          fill={p.mouth}
          stroke={p.outline}
          strokeWidth="1.7"
        />
        <ellipse cx={x} cy={y + 8} rx="7" ry="4.2" fill={p.tongue} stroke="none" />
        <path d={`M ${x - 5} ${y} Q ${x} ${y + 3} ${x + 5} ${y}`} fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.5" />
      </g>
    );
  }
  if (mood === 'happy') {
    return (
      <g className="mascot__mouth">
        <path
          d={`M ${x - 11} ${y} Q ${x} ${y - 1} ${x + 11} ${y} Q ${x} ${y + 13} ${x - 11} ${y} Z`}
          fill={p.mouth}
          stroke={p.outline}
          strokeWidth="1.65"
        />
        <ellipse cx={x} cy={y + 6.5} rx="5.2" ry="3" fill={p.tongue} stroke="none" />
      </g>
    );
  }
  if (mood === 'worried') {
    return (
      <path
        className="mascot__mouth"
        d={`M ${x - 9} ${y + 3} Q ${x - 4} ${y - 2} ${x} ${y + 3} Q ${x + 4} ${y + 8} ${x + 9} ${y + 2}`}
        fill="none"
        stroke={p.mouth}
        strokeWidth="2.05"
        strokeLinecap="round"
      />
    );
  }
  if (mood === 'sleepy') {
    return (
      <ellipse
        className="mascot__mouth"
        cx={x}
        cy={y + 2}
        rx="4.2"
        ry="3.4"
        fill={p.mouth}
        stroke={p.outline}
        strokeWidth="1.5"
      />
    );
  }
  if (mood === 'wink') {
    return (
      <path
        className="mascot__mouth"
        d={`M ${x - 8} ${y + 1} Q ${x - 3} ${y + 7} ${x} ${y + 1} Q ${x + 3} ${y + 7} ${x + 8} ${y + 1}`}
        fill="none"
        stroke={p.mouth}
        strokeWidth="2.15"
        strokeLinecap="round"
      />
    );
  }
  // neutral — tiny cat mouth
  return (
    <path
      className="mascot__mouth"
      d={`M ${x - 7} ${y + 1} Q ${x - 3} ${y + 6.5} ${x} ${y + 1} Q ${x + 3} ${y + 6.5} ${x + 7} ${y + 1}`}
      fill="none"
      stroke={p.mouth}
      strokeWidth="2.05"
      strokeLinecap="round"
    />
  );
}
