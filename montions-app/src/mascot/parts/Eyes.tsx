import { sparklePath } from '../geom';
import { BROW_Y, CX, EYE_DX, EYE_RX, EYE_RY, EYE_Y } from '../layout';
import type { MascotMood, MascotPalette } from '../types';

function EyeSleepy({
  cx,
  cy,
  p,
  uid,
  side,
}: {
  cx: number;
  cy: number;
  p: MascotPalette;
  uid: string;
  side: 'left' | 'right';
}) {
  const clip = `${uid}-sleepy-${side}`;
  const lid = cy + 2;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={cx - EYE_RX - 1} y={lid} width={EYE_RX * 2 + 2} height={EYE_RY + 6} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={cx} cy={cy} rx={EYE_RX} ry={EYE_RY} fill="#fff" />
        <circle cx={cx} cy={cy + 4} r={9.2} fill={`url(#${uid}-iris)`} />
        <circle cx={cx} cy={cy + 5} r={5} fill={p.pupil} />
        <circle cx={cx - 2.4} cy={cy + 2.2} r="2.2" fill="#fff" />
      </g>
      <path
        d={`M ${cx - EYE_RX} ${cy} A ${EYE_RX} ${EYE_RY} 0 0 0 ${cx + EYE_RX} ${cy}`}
        fill="none"
        stroke={p.outline}
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - EYE_RX} ${lid} Q ${cx} ${lid + 3.2} ${cx + EYE_RX} ${lid}`}
        fill="none"
        stroke={p.lash}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - EYE_RX + 2} ${cy + 9} Q ${cx} ${cy + EYE_RY} ${cx + EYE_RX - 2} ${cy + 9}`}
        fill="none"
        stroke={p.lash}
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path
        d={
          side === 'left'
            ? `M ${cx - EYE_RX + 2} ${lid + 1} L ${cx - EYE_RX - 3} ${lid - 2}`
            : `M ${cx + EYE_RX - 2} ${lid + 1} L ${cx + EYE_RX + 3} ${lid - 2}`
        }
        fill="none"
        stroke={p.lash}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </g>
  );
}

function EyeOpen({
  cx,
  cy,
  p,
  uid,
  side,
  mood,
}: {
  cx: number;
  cy: number;
  p: MascotPalette;
  uid: string;
  side: 'left' | 'right';
  mood: MascotMood;
}) {
  const clip = `${uid}-eye-${side}`;
  const excited = mood === 'excited';
  const worried = mood === 'worried';
  const happy = mood === 'happy';

  const irisR = excited ? 11.4 : 10;
  const pupilR = excited ? 6 : 5.2;
  const shiftX = worried ? (side === 'left' ? 2.2 : -2.2) : 0;
  const shiftY = worried ? 2.4 : happy ? 1.2 : 1.0;
  const ix = cx + shiftX;
  const iy = cy + shiftY;
  const lidY = happy ? cy - 6 : cy - EYE_RY + 1;

  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <ellipse cx={cx} cy={cy} rx={EYE_RX} ry={EYE_RY} />
        </clipPath>
      </defs>
      <ellipse cx={cx} cy={cy} rx={EYE_RX} ry={EYE_RY} fill="#fff" stroke={p.outline} strokeWidth="1.15" />
      <g clipPath={`url(#${clip})`}>
        <circle cx={ix} cy={iy} r={irisR} fill={`url(#${uid}-iris)`} />
        <circle cx={ix} cy={iy + 1.2} r={irisR * 0.72} fill={p.irisDark} opacity="0.35" />
        <circle cx={ix} cy={iy + 0.6} r={pupilR} fill={p.pupil} />
        {excited ? (
          <>
            <path d={sparklePath(ix - 2.4, iy - 3.2, 5.2)} fill="#fff" stroke="none" />
            <circle cx={ix + 3.6} cy={iy + 3.4} r="1.7" fill="#fff" />
          </>
        ) : (
          <>
            <circle cx={ix - 3.1} cy={iy - 3.4} r="3.3" fill="#fff" />
            <circle cx={ix + 3.3} cy={iy + 2.6} r="1.45" fill="#fff" opacity="0.9" />
          </>
        )}
      </g>
      <path
        d={`M ${cx - EYE_RX + 0.2} ${cy + 1.2}
            C ${cx - EYE_RX + 1} ${lidY}, ${cx} ${cy - EYE_RY - 0.6}, ${cx + EYE_RX - 0.4} ${cy - 3}`}
        fill="none"
        stroke={p.lash}
        strokeWidth="2.55"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - EYE_RX + 1.5} ${cy + 8}
            Q ${cx} ${cy + EYE_RY + (happy ? -1 : 0.4)} ${cx + EYE_RX - 1.5} ${cy + 8}`}
        fill="none"
        stroke={p.lash}
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d={
          side === 'left'
            ? `M ${cx - EYE_RX + 1} ${cy - 6} L ${cx - EYE_RX - 4.5} ${cy - 11}
               M ${cx - EYE_RX + 3} ${cy - 10} L ${cx - EYE_RX - 1.5} ${cy - 15}`
            : `M ${cx + EYE_RX - 1} ${cy - 6} L ${cx + EYE_RX + 4.5} ${cy - 11}
               M ${cx + EYE_RX - 3} ${cy - 10} L ${cx + EYE_RX + 1.5} ${cy - 15}`
        }
        fill="none"
        stroke={p.lash}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </g>
  );
}

function EyeClosed({
  cx,
  cy,
  p,
  kind,
}: {
  cx: number;
  cy: number;
  p: MascotPalette;
  kind: 'wink' | 'happy';
}) {
  const lift = kind === 'happy' ? 1 : 0;
  return (
    <g>
      <path
        d={`M ${cx - 14.5} ${cy - 1 + lift} Q ${cx} ${cy + 9} ${cx + 14.5} ${cy - 1 + lift}`}
        fill="none"
        stroke={p.lash}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - 10} ${cy + 1 + lift} Q ${cx} ${cy + 5} ${cx + 10} ${cy + 1 + lift}`}
        fill="none"
        stroke={p.lash}
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
      {kind === 'wink' && (
        <path
          d={`M ${cx + 12} ${cy - 4} L ${cx + 17} ${cy - 9}`}
          fill="none"
          stroke={p.lash}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

export function Eyes({ mood, p, uid }: { mood: MascotMood; p: MascotPalette; uid: string }) {
  const lx = CX - EYE_DX;
  const rx = CX + EYE_DX;
  const cy = EYE_Y;
  return (
    <g className="mascot__eyes">
      {mood === 'wink' ? (
        <>
          <EyeOpen cx={lx} cy={cy} p={p} uid={uid} side="left" mood="happy" />
          <EyeClosed cx={rx} cy={cy} p={p} kind="wink" />
        </>
      ) : mood === 'sleepy' ? (
        <>
          <EyeSleepy cx={lx} cy={cy} p={p} uid={uid} side="left" />
          <EyeSleepy cx={rx} cy={cy} p={p} uid={uid} side="right" />
        </>
      ) : (
        <>
          <EyeOpen cx={lx} cy={cy} p={p} uid={uid} side="left" mood={mood} />
          <EyeOpen cx={rx} cy={cy} p={p} uid={uid} side="right" mood={mood} />
        </>
      )}
      {mood === 'excited' && (
        <g fill="#fff4c8" stroke={p.outline} strokeWidth="0.6">
          <path d={sparklePath(lx - 22, cy + 10, 5.5)} />
          <path d={sparklePath(rx + 22, cy + 8, 6.5)} />
          <path d={sparklePath(lx - 18, cy - 14, 4)} fill="#fff" />
          <path d={sparklePath(rx + 18, cy - 16, 4.5)} fill="#fff" />
        </g>
      )}
    </g>
  );
}

export function Brows({ mood, p }: { mood: MascotMood; p: MascotPalette }) {
  const y = BROW_Y;
  const lx = CX - EYE_DX;
  const rx = CX + EYE_DX;
  let left: string;
  let right: string;
  if (mood === 'worried') {
    left = `M ${lx - 13} ${y + 6} Q ${lx - 2} ${y - 2} ${lx + 12} ${y - 5}`;
    right = `M ${rx - 12} ${y - 5} Q ${rx + 2} ${y - 2} ${rx + 13} ${y + 6}`;
  } else if (mood === 'excited' || mood === 'happy') {
    left = `M ${lx - 13} ${y + 2} Q ${lx} ${y - 8} ${lx + 13} ${y + 1}`;
    right = `M ${rx - 13} ${y + 1} Q ${rx} ${y - 8} ${rx + 13} ${y + 2}`;
  } else if (mood === 'sleepy') {
    left = `M ${lx - 12} ${y + 6} Q ${lx} ${y + 3} ${lx + 12} ${y + 6}`;
    right = `M ${rx - 12} ${y + 6} Q ${rx} ${y + 3} ${rx + 12} ${y + 6}`;
  } else if (mood === 'wink') {
    left = `M ${lx - 13} ${y + 1} Q ${lx} ${y - 6} ${lx + 13} ${y + 2}`;
    right = `M ${rx - 12} ${y - 2} Q ${rx + 2} ${y - 10} ${rx + 14} ${y - 1}`;
  } else {
    left = `M ${lx - 13} ${y + 3} Q ${lx} ${y - 4} ${lx + 13} ${y + 3}`;
    right = `M ${rx - 13} ${y + 3} Q ${rx} ${y - 4} ${rx + 13} ${y + 3}`;
  }
  return (
    <g className="mascot__brows" fill="none" stroke={p.brow} strokeWidth="2.15" strokeLinecap="round">
      <path d={left} />
      <path d={right} />
    </g>
  );
}
