import { CX, SHOULDER_DX, SHOULDER_Y } from '../layout';
import type { MascotPalette, MascotPose, MascotWho } from '../types';

function SleeveStroke({
  d,
  sleeve,
  outline,
}: {
  d: string;
  sleeve: string;
  outline: string;
}) {
  return (
    <g>
      <path d={d} fill="none" stroke={outline} strokeWidth="16.5" strokeLinecap="round" />
      <path d={d} fill="none" stroke={sleeve} strokeWidth="12.5" strokeLinecap="round" />
    </g>
  );
}

function Hand({ x, y, p }: { x: number; y: number; p: MascotPalette }) {
  return <ellipse cx={x} cy={y} rx="8.4" ry="8.8" fill={p.skin} stroke={p.outline} strokeWidth="1.85" />;
}

function PointingHand({ x, y, p }: { x: number; y: number; p: MascotPalette }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(-32)`}>
      <ellipse cx="0" cy="5" rx="8" ry="9" fill={p.skin} stroke={p.outline} strokeWidth="1.8" />
      <rect x="-3.2" y="-20" width="6.6" height="22" rx="3.3" fill={p.skin} stroke={p.outline} strokeWidth="1.8" />
      <ellipse cx="6.2" cy="3" rx="3.8" ry="5" fill={p.skin} stroke={p.outline} strokeWidth="1.5" />
    </g>
  );
}

export function Ticket({
  x,
  y,
  rotate = -12,
  scale = 1,
}: {
  x: number;
  y: number;
  rotate?: number;
  scale?: number;
}) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotate}) scale(${scale})`}>
      <rect x="-30" y="-17" width="60" height="34" rx="5" fill="#fff8f0" stroke="#c47a6a" strokeWidth="1.7" />
      <path d="M -18 -17 V 17" fill="none" stroke="#ff7a6e" strokeWidth="6" />
      {[ -10, -2, 6, 14 ].map((yy) => (
        <circle key={yy} cx="-18" cy={yy} r="1.5" fill="#fff8f0" />
      ))}
      <path d="M -8 -6 H 22" fill="none" stroke="#e8c4b4" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M -8 3 H 16" fill="none" stroke="#e8c4b4" strokeWidth="2.2" strokeLinecap="round" />
      <text
        x="6"
        y="13"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="#ff7a6e"
      >
        YES
      </text>
    </g>
  );
}

const ARM = {
  idle: {
    l: `M ${CX - SHOULDER_DX} ${SHOULDER_Y + 4} Q ${CX - 50} 214 ${CX - 52} 240`,
    r: `M ${CX + SHOULDER_DX} ${SHOULDER_Y + 4} Q ${CX + 50} 214 ${CX + 52} 240`,
    handL: { x: CX - 52, y: 240 },
    handR: { x: CX + 52, y: 240 },
  },
  point: {
    l: `M ${CX - SHOULDER_DX} ${SHOULDER_Y + 4} Q ${CX - 50} 214 ${CX - 52} 240`,
    r: `M ${CX + SHOULDER_DX} ${SHOULDER_Y + 2} Q ${CX + 78} 156 ${CX + 108} 118`,
    handL: { x: CX - 52, y: 240 },
    handR: { x: CX + 112, y: 112 },
  },
  cheer: {
    l: `M ${CX - SHOULDER_DX} ${SHOULDER_Y + 2} Q ${CX - 58} 130 ${CX - 70} 64`,
    r: `M ${CX + SHOULDER_DX} ${SHOULDER_Y + 2} Q ${CX + 58} 130 ${CX + 70} 64`,
    handL: { x: CX - 70, y: 62 },
    handR: { x: CX + 70, y: 62 },
  },
  'hold-ticket': {
    l: `M ${CX - SHOULDER_DX} ${SHOULDER_Y + 4} Q ${CX - 36} 214 ${CX - 22} 226`,
    r: `M ${CX + SHOULDER_DX} ${SHOULDER_Y + 4} Q ${CX + 36} 214 ${CX + 22} 226`,
    handL: { x: CX - 22, y: 226 },
    handR: { x: CX + 22, y: 226 },
  },
} as const;

export function Arms({
  pose,
  p,
  who,
  layer,
}: {
  pose: MascotPose;
  p: MascotPalette;
  who: MascotWho;
  layer: 'back' | 'mid' | 'front';
}) {
  const a = ARM[pose];
  const sleeve = p.topDark;
  const monIdleTicket = who === 'mon' && pose === 'idle' && layer === 'front';

  if (layer === 'back') {
    if (pose === 'cheer' || pose === 'hold-ticket') return null;
    return (
      <g className="mascot__arms-back">
        <SleeveStroke d={a.l} sleeve={sleeve} outline={p.outline} />
        <Hand x={a.handL.x} y={a.handL.y} p={p} />
      </g>
    );
  }

  if (layer === 'mid') {
    if (pose !== 'cheer') return null;
    return (
      <g className="mascot__arms-mid">
        <SleeveStroke d={a.l} sleeve={sleeve} outline={p.outline} />
        <SleeveStroke d={a.r} sleeve={sleeve} outline={p.outline} />
        <Hand x={a.handL.x} y={a.handL.y} p={p} />
        <Hand x={a.handR.x} y={a.handR.y} p={p} />
      </g>
    );
  }

  if (pose === 'cheer') return null;

  if (pose === 'hold-ticket') {
    return (
      <g className="mascot__arms-front">
        <SleeveStroke d={a.l} sleeve={sleeve} outline={p.outline} />
        <SleeveStroke d={a.r} sleeve={sleeve} outline={p.outline} />
        <Ticket x={CX} y={214} rotate={-8} />
        <Hand x={a.handL.x} y={a.handL.y} p={p} />
        <Hand x={a.handR.x} y={a.handR.y} p={p} />
      </g>
    );
  }

  return (
    <g className="mascot__arms-front">
      {pose === 'point' ? (
        <>
          <SleeveStroke d={a.r} sleeve={sleeve} outline={p.outline} />
          <PointingHand x={a.handR.x} y={a.handR.y} p={p} />
        </>
      ) : (
        <>
          <SleeveStroke d={a.r} sleeve={sleeve} outline={p.outline} />
          <Hand x={a.handR.x} y={a.handR.y} p={p} />
        </>
      )}
      {monIdleTicket && <Ticket x={CX - 54} y={236} rotate={-18} scale={0.72} />}
    </g>
  );
}
