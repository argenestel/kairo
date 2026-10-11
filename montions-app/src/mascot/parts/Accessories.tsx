import { star5 } from '../geom';
import { CX, EYE_DX, EYE_Y } from '../layout';
import type { MascotMood, MascotPalette, MascotWho } from '../types';

function Glasses({ p }: { p: MascotPalette }) {
  const y = EYE_Y + 1;
  const lx = CX - EYE_DX;
  const rx = CX + EYE_DX;
  return (
    <g className="mascot__glasses" fill="none">
      <ellipse cx={lx} cy={y} rx="17.4" ry="18.2" stroke={p.accessory} strokeWidth="2.35" />
      <ellipse cx={rx} cy={y} rx="17.4" ry="18.2" stroke={p.accessory} strokeWidth="2.35" />
      <path d={`M ${lx + 17.4} ${y} H ${rx - 17.4}`} stroke={p.accessory} strokeWidth="2" />
      <path d={`M ${lx - 17.4} ${y - 2} Q ${lx - 28} ${y - 4} ${lx - 34} ${y - 10}`} stroke={p.accessory} strokeWidth="2" />
      <path d={`M ${rx + 17.4} ${y - 2} Q ${rx + 28} ${y - 4} ${rx + 34} ${y - 10}`} stroke={p.accessory} strokeWidth="2" />
      <ellipse cx={lx - 6} cy={y - 6} rx="5.5" ry="8" fill="#fff" opacity="0.28" stroke="none" />
      <ellipse cx={rx - 6} cy={y - 6} rx="5.5" ry="8" fill="#fff" opacity="0.22" stroke="none" />
    </g>
  );
}

function Headphones({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__headphones">
      <path
        d={`M 66 100 Q ${CX} 32 ${CX + 54} 100`}
        fill="none"
        stroke={p.accessory}
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <path
        d={`M 68 100 Q ${CX} 40 ${CX + 52} 100`}
        fill="none"
        stroke={p.accent}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="48" y="86" width="24" height="38" rx="11" fill={p.accessory} stroke={p.outline} strokeWidth="2" />
      <rect x="168" y="86" width="24" height="38" rx="11" fill={p.accessory} stroke={p.outline} strokeWidth="2" />
      <rect x="53" y="96" width="14" height="20" rx="7" fill={p.accent} stroke="none" />
      <rect x="173" y="96" width="14" height="20" rx="7" fill={p.accent} stroke="none" />
      <circle cx="60" cy="92" r="2.2" fill={p.topLight} stroke="none" />
      <circle cx="180" cy="92" r="2.2" fill={p.topLight} stroke="none" />
    </g>
  );
}

function StarClip({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__starclip">
      <path d={star5(78, 86, 13, 6)} fill={p.accessory} stroke={p.outline} strokeWidth="1.7" />
      <path d={star5(78, 86, 7, 3.2)} fill="#fff6c8" stroke="none" />
    </g>
  );
}

function Sweatdrop({ p }: { p: MascotPalette }) {
  return (
    <path
      d="M 176 96 C 176 96, 186 112, 176 120 C 166 112, 176 96, 176 96 Z"
      fill="#c8e4ff"
      stroke={p.outline}
      strokeWidth="1.5"
      opacity="0.95"
    />
  );
}

function Zzz({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__zzz" fill={p.outline} opacity="0.55" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">
      <text x="176" y="84" fontSize="11">z</text>
      <text x="186" y="72" fontSize="14">z</text>
      <text x="198" y="58" fontSize="17">z</text>
    </g>
  );
}

export function Accessories({
  who,
  mood,
  p,
}: {
  who: MascotWho;
  mood: MascotMood;
  p: MascotPalette;
}) {
  return (
    <g className="mascot__accessories">
      {who === 'base' && <Glasses p={p} />}
      {who === 'hyper' && <Headphones p={p} />}
      {who === 'sol' && <StarClip p={p} />}
      {mood === 'worried' && <Sweatdrop p={p} />}
      {mood === 'sleepy' && <Zzz p={p} />}
    </g>
  );
}
