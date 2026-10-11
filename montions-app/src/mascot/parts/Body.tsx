import { CX, FOOT_Y, SHOULDER_Y } from '../layout';
import type { MascotPalette, MascotWho } from '../types';

function Legs({ p, skirt }: { p: MascotPalette; skirt?: boolean }) {
  const top = skirt ? 230 : 222;
  return (
    <g className="mascot__legs">
      <rect x={CX - 20} y={top} width="14" height={FOOT_Y - 10 - top} rx="7" fill={p.bottom} stroke={p.outline} strokeWidth="2" />
      <rect x={CX + 6} y={top} width="14" height={FOOT_Y - 10 - top} rx="7" fill={p.bottom} stroke={p.outline} strokeWidth="2" />
      <ellipse cx={CX - 12} cy={FOOT_Y - 4} rx="13" ry="7.5" fill={p.shoe} stroke={p.outline} strokeWidth="2" />
      <ellipse cx={CX + 14} cy={FOOT_Y - 4} rx="13" ry="7.5" fill={p.shoe} stroke={p.outline} strokeWidth="2" />
      <ellipse cx={CX - 8} cy={FOOT_Y - 6} rx="5" ry="2.4" fill={p.shoeAccent} opacity="0.7" stroke="none" />
      <ellipse cx={CX + 18} cy={FOOT_Y - 6} rx="5" ry="2.4" fill={p.shoeAccent} opacity="0.7" stroke="none" />
    </g>
  );
}

function Torso({ p, d }: { p: MascotPalette; d?: string }) {
  const body =
    d ??
    `M ${CX - 30} ${SHOULDER_Y}
     C ${CX - 36} ${SHOULDER_Y + 4}, ${CX - 38} ${SHOULDER_Y + 16}, ${CX - 34} ${SHOULDER_Y + 32}
     L ${CX - 28} 226
     Q ${CX} 238, ${CX + 28} 226
     L ${CX + 34} ${SHOULDER_Y + 32}
     C ${CX + 38} ${SHOULDER_Y + 16}, ${CX + 36} ${SHOULDER_Y + 4}, ${CX + 30} ${SHOULDER_Y}
     Q ${CX} ${SHOULDER_Y - 8}, ${CX - 30} ${SHOULDER_Y} Z`;
  return <path d={body} fill={p.top} stroke={p.outline} strokeWidth="2.15" />;
}

export function Hood({ who, p }: { who: MascotWho; p: MascotPalette }) {
  if (who !== 'base') return null;
  return (
    <path
      className="mascot__hood"
      d={`M ${CX} 46
          C 162 48, 192 80, 188 122
          C 186 148, 170 168, 150 176
          Q ${CX} 184, 90 176
          C 70 168, 54 148, 52 122
          C 48 80, 78 48, ${CX} 46 Z`}
      fill={p.topDark}
      stroke={p.outline}
      strokeWidth="2.15"
    />
  );
}

function BaseBody({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__body">
      <Legs p={p} />
      <Torso p={p} />
      {/* kangaroo pocket */}
      <path
        d={`M ${CX - 16} 204 H ${CX + 16} V 220 Q ${CX} 228 ${CX - 16} 220 Z`}
        fill={p.topDark}
        stroke={p.outline}
        strokeWidth="1.7"
      />
      {/* drawstrings */}
      <path d={`M ${CX - 8} 190 L ${CX - 12} 214`} fill="none" stroke={p.collar} strokeWidth="2.1" strokeLinecap="round" />
      <path d={`M ${CX + 8} 190 L ${CX + 12} 214`} fill="none" stroke={p.collar} strokeWidth="2.1" strokeLinecap="round" />
      <circle cx={CX - 12} cy={216} r="2.6" fill={p.collar} stroke={p.outline} strokeWidth="1.1" />
      <circle cx={CX + 12} cy={216} r="2.6" fill={p.collar} stroke={p.outline} strokeWidth="1.1" />
      {/* hem rib */}
      <path d={`M ${CX - 28} 224 Q ${CX} 234 ${CX + 28} 224`} fill="none" stroke={p.topDark} strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

function ArbiBody({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__body">
      <Legs p={p} />
      {/* high-collar tech jacket */}
      <Torso p={p} />
      <path
        d={`M ${CX - 14} 172 L ${CX - 10} 186 H ${CX + 10} L ${CX + 14} 172 Q ${CX} 166 ${CX - 14} 172 Z`}
        fill={p.collar}
        stroke={p.outline}
        strokeWidth="1.8"
      />
      {/* zipper */}
      <path d={`M ${CX} 188 V 226`} fill="none" stroke={p.accent} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={CX} cy={192} r="2.4" fill={p.accent} stroke={p.outline} strokeWidth="1" />
      {/* cyan piping */}
      <path
        d={`M ${CX - 28} ${SHOULDER_Y + 6} L ${CX - 30} 214`}
        fill="none"
        stroke={p.accent}
        strokeWidth="1.5"
        opacity="0.9"
      />
      <path
        d={`M ${CX + 28} ${SHOULDER_Y + 6} L ${CX + 30} 214`}
        fill="none"
        stroke={p.accent}
        strokeWidth="1.5"
        opacity="0.9"
      />
      {/* chest strap */}
      <path d={`M ${CX - 24} 198 H ${CX + 24}`} fill="none" stroke={p.topLight} strokeWidth="4.5" strokeLinecap="round" />
      <path d={`M ${CX - 24} 198 H ${CX + 24}`} fill="none" stroke={p.accent} strokeWidth="1.4" />
      {/* pocket flaps */}
      <rect x={CX - 26} y="208" width="14" height="10" rx="2" fill={p.topDark} stroke={p.accent} strokeWidth="1.2" />
      <rect x={CX + 12} y="208" width="14" height="10" rx="2" fill={p.topDark} stroke={p.accent} strokeWidth="1.2" />
    </g>
  );
}

function HyperBody({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__body">
      <Legs p={p} skirt />
      <Torso p={p} />
      {/* sailor collar */}
      <path
        d={`M ${CX - 28} ${SHOULDER_Y}
            L ${CX - 22} 172
            L ${CX} 198
            L ${CX + 22} 172
            L ${CX + 28} ${SHOULDER_Y}
            Q ${CX} ${SHOULDER_Y - 6} ${CX - 28} ${SHOULDER_Y} Z`}
        fill={p.collar}
        stroke={p.outline}
        strokeWidth="2"
      />
      <path
        d={`M ${CX - 16} 176 L ${CX} 196 L ${CX + 16} 176`}
        fill="none"
        stroke={p.topLight}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* ribbon */}
      <path d={`M ${CX} 196 L ${CX - 10} 210 L ${CX} 206 L ${CX + 10} 210 Z`} fill={p.bottomDark} stroke={p.outline} strokeWidth="1.5" />
      <circle cx={CX} cy={196} r="3.4" fill={p.accent} stroke={p.outline} strokeWidth="1.3" />
      {/* pleated skirt */}
      <path
        d={`M ${CX - 26} 220
            L ${CX - 36} 246
            L ${CX - 18} 240
            L ${CX} 248
            L ${CX + 18} 240
            L ${CX + 36} 246
            L ${CX + 26} 220 Z`}
        fill={p.bottom}
        stroke={p.outline}
        strokeWidth="2"
      />
    </g>
  );
}

function SolBody({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__body">
      <Legs p={p} skirt />
      <Torso p={p} />
      {/* flared dress overlay */}
      <path
        d={`M ${CX - 22} 198
            L ${CX - 40} 246
            Q ${CX} 258, ${CX + 40} 246
            L ${CX + 22} 198
            Q ${CX} 204, ${CX - 22} 198 Z`}
        fill={p.bottom}
        stroke={p.outline}
        strokeWidth="2.1"
      />
      <path
        d={`M ${CX - 22} 198 Q ${CX} 204 ${CX + 22} 198`}
        fill="none"
        stroke={p.accent}
        strokeWidth="2"
      />
      {/* star button */}
      <circle cx={CX} cy={196} r="5" fill={p.accessory} stroke={p.outline} strokeWidth="1.4" />
      <path d={`M ${CX} 192 L ${CX + 1.4} 195.2 L ${CX + 4.6} 195.4 L ${CX + 2} 197.6 L ${CX + 2.8} 201 L ${CX} 199.2 L ${CX - 2.8} 201 L ${CX - 2} 197.6 L ${CX - 4.6} 195.4 L ${CX - 1.4} 195.2 Z`} fill="#fff8dc" stroke="none" />
      {/* teal hem */}
      <path d={`M ${CX - 38} 244 Q ${CX} 254 ${CX + 38} 244`} fill="none" stroke={p.accent} strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

function MonBody({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__body">
      <Legs p={p} skirt />
      <Torso p={p} />
      {/* cream blouse yoke */}
      <path
        d={`M ${CX - 26} ${SHOULDER_Y + 2} Q ${CX} ${SHOULDER_Y - 4} ${CX + 26} ${SHOULDER_Y + 2}
            L ${CX + 16} 200 L ${CX - 16} 200 Z`}
        fill={p.topLight}
        stroke={p.outline}
        strokeWidth="1.8"
      />
      {/* coral pinafore */}
      <path
        d={`M ${CX - 18} 198
            L ${CX - 34} 244
            Q ${CX} 256, ${CX + 34} 244
            L ${CX + 18} 198
            Q ${CX} 206, ${CX - 18} 198 Z`}
        fill={p.bottom}
        stroke={p.outline}
        strokeWidth="2.1"
      />
      <path d={`M ${CX - 10} 188 V 210`} fill="none" stroke={p.collar} strokeWidth="3.2" strokeLinecap="round" />
      <path d={`M ${CX + 10} 188 V 210`} fill="none" stroke={p.collar} strokeWidth="3.2" strokeLinecap="round" />
      <circle cx={CX} cy={200} r="3.2" fill={p.topLight} stroke={p.outline} strokeWidth="1.3" />
    </g>
  );
}

export function Body({ who, p }: { who: MascotWho; p: MascotPalette }) {
  switch (who) {
    case 'base':
      return <BaseBody p={p} />;
    case 'arbi':
      return <ArbiBody p={p} />;
    case 'hyper':
      return <HyperBody p={p} />;
    case 'sol':
      return <SolBody p={p} />;
    case 'mon':
      return <MonBody p={p} />;
  }
}
