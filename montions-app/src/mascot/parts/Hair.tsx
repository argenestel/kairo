import { CX } from '../layout';
import type { MascotPalette, MascotWho } from '../types';

function Shine({ d, fill }: { d: string; fill: string }) {
  return <path d={d} fill={fill} stroke="none" opacity="0.85" />;
}

function Shade({ d, fill }: { d: string; fill: string }) {
  return <path d={d} fill={fill} stroke="none" opacity="0.55" />;
}

function BaseHairBack({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-back">
      {/* rounded bob silhouette */}
      <path
        d={`M ${CX} 50
            C 158 50, 184 74, 186 112
            C 188 148, 178 172, 156 182
            Q ${CX} 192, 84 182
            C 62 172, 52 148, 54 112
            C 56 74, 82 50, ${CX} 50 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      <Shade
        fill={p.hairDark}
        d={`M 150 86 C 176 100, 178 150, 150 176 C 168 150, 168 110, 150 86 Z`}
      />
    </g>
  );
}

function BaseHairFront({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-front">
      {/* short side locks — leave the cheeks open */}
      <path
        d={`M 74 100 C 66 114, 64 132, 70 148 C 74 156, 84 152, 86 140 C 84 122, 82 108, 80 100 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 166 100 C 174 114, 176 132, 170 148 C 166 156, 156 152, 154 140 C 156 122, 158 108, 160 100 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      {/* notched bob bangs */}
      <path
        d={`M 72 92 C 74 66, 92 56, 108 62 C 104 82, 90 96, 74 104 C 68 100, 68 96, 72 92 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 104 60 C 112 52, 128 52, 136 62 C 130 80, 118 90, 106 82 C 102 72, 102 64, 104 60 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 132 60 C 144 52, 160 58, 168 78 C 170 90, 164 100, 154 102 C 142 90, 134 74, 132 62 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <Shine fill={p.hairLight} d={`M 94 64 C 102 58, 114 60, 116 70 C 108 74, 98 72, 94 64 Z`} />
      <Shine fill={p.hairAccent} d={`M 146 66 C 154 62, 162 68, 162 76 C 154 76, 148 72, 146 66 Z`} />
    </g>
  );
}

function ArbiHairBack({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-back">
      {/* crown volume */}
      <path
        d={`M ${CX} 48
            C 154 48, 176 70, 178 104
            C 180 132, 170 158, 150 170
            Q ${CX} 178, 90 170
            C 70 158, 60 132, 62 104
            C 64 70, 86 48, ${CX} 48 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      {/* high ponytail flowing down the right */}
      <path
        d={`M 142 58
            C 168 48, 198 64, 206 100
            C 214 140, 208 190, 186 242
            C 176 256, 162 250, 166 230
            C 176 190, 184 145, 176 108
            C 170 82, 156 66, 142 64 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      <path
        d={`M 176 100 C 196 130, 194 190, 176 236 C 186 190, 188 140, 176 100 Z`}
        fill={p.hairAccent}
        opacity="0.85"
        stroke="none"
      />
      <Shade fill={p.hairDark} d={`M 160 80 C 190 100, 196 170, 176 230 C 188 170, 180 110, 160 80 Z`} />
      {/* hair tie */}
      <rect x="140" y="56" width="22" height="10" rx="5" fill={p.accessory} stroke={p.outline} strokeWidth="1.6" />
    </g>
  );
}

function ArbiHairFront({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-front">
      <path
        d={`M 70 94 C 60 112, 58 140, 70 168 C 76 176, 86 170, 88 158 C 82 136, 82 110, 78 96 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 166 92 C 176 108, 180 132, 172 154 C 168 164, 158 160, 156 148 C 160 128, 160 108, 162 94 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      {/* swept bangs */}
      <path
        d={`M 72 88 C 78 58, 110 48, 138 56 C 128 78, 108 96, 84 104 C 74 100, 70 94, 72 88 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 128 56 C 148 50, 170 62, 174 86 C 168 96, 154 100, 144 90 C 138 78, 132 64, 128 58 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path d={`M 92 70 C 108 62, 124 68, 128 82 C 114 84, 98 80, 92 70 Z`} fill={p.hairAccent} opacity="0.7" stroke="none" />
      <Shine fill={p.hairLight} d={`M 96 62 C 108 56, 122 60, 124 70 C 112 72, 100 68, 96 62 Z`} />
    </g>
  );
}

function HyperHairBack({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-back">
      <path
        d={`M ${CX} 52
            C 152 52, 172 72, 174 104
            C 176 132, 166 156, 148 166
            Q ${CX} 174, 92 166
            C 74 156, 64 132, 66 104
            C 68 72, 88 52, ${CX} 52 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      {/* hanging left twin tail */}
      <path
        d={`M 70 78
            C 48 96, 38 128, 42 168
            C 44 192, 64 200, 72 184
            C 80 168, 70 140, 74 108
            C 76 94, 76 84, 78 80 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      {/* hanging right twin tail */}
      <path
        d={`M 170 78
            C 192 96, 202 128, 198 168
            C 196 192, 176 200, 168 184
            C 160 168, 170 140, 166 108
            C 164 94, 164 84, 162 80 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      <ellipse cx="74" cy="64" rx="15" ry="13" fill={p.hair} stroke={p.outline} strokeWidth="2.05" />
      <ellipse cx="166" cy="64" rx="15" ry="13" fill={p.hair} stroke={p.outline} strokeWidth="2.05" />
      <rect x="64" y="74" width="20" height="8" rx="4" fill={p.collar} stroke={p.outline} strokeWidth="1.5" />
      <rect x="156" y="74" width="20" height="8" rx="4" fill={p.collar} stroke={p.outline} strokeWidth="1.5" />
      <Shine fill={p.hairLight} d={`M 50 150 C 56 140, 66 146, 64 160 C 56 160, 50 156, 50 150 Z`} />
      <Shine fill={p.hairLight} d={`M 190 150 C 184 140, 174 146, 176 160 C 184 160, 190 156, 190 150 Z`} />
      <Shade fill={p.hairDark} d={`M 52 170 C 44 180, 52 194, 66 190 C 60 180, 56 174, 52 170 Z`} />
      <Shade fill={p.hairDark} d={`M 188 170 C 196 180, 188 194, 174 190 C 180 180, 184 174, 188 170 Z`} />
    </g>
  );
}

function HyperHairFront({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-front">
      {/* hime bangs with three notches */}
      <path
        d={`M 74 98
            C 74 70, 94 54, ${CX} 52
            C 146 54, 166 70, 166 98
            L 158 104
            C 150 88, 140 84, 134 98
            L 128 90
            C 124 80, 116 80, 112 90
            L 106 98
            C 100 84, 90 88, 82 104 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.1"
      />
      <path
        d={`M 70 100 C 62 118, 60 140, 70 160 C 76 168, 86 162, 88 150 C 80 130, 80 112, 78 100 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2"
      />
      <path
        d={`M 170 100 C 178 118, 180 140, 170 160 C 164 168, 154 162, 152 150 C 160 130, 160 112, 162 100 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2"
      />
      <Shine fill={p.hairLight} d={`M 100 62 C 112 56, 128 56, 136 66 C 124 70, 108 70, 100 62 Z`} />
    </g>
  );
}

function SolHairBack({ p, uid }: { p: MascotPalette; uid: string }) {
  return (
    <g className="mascot__hair-back">
      <path
        d={`M ${CX} 50
            C 148 44, 172 66, 178 98
            C 186 126, 184 148, 170 162
            C 186 168, 198 186, 190 214
            C 184 236, 196 250, 182 256
            C 168 260, 162 246, 166 228
            C 172 200, 158 180, 146 172
            Q ${CX} 182, 94 172
            C 82 180, 68 200, 74 228
            C 78 246, 72 260, 58 256
            C 44 250, 56 236, 50 214
            C 42 186, 54 168, 70 162
            C 56 148, 54 126, 62 98
            C 68 66, 92 44, ${CX} 50 Z`}
        fill={`url(#${uid}-hair)`}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      <Shade fill={p.hairDark} d={`M 150 90 C 176 110, 180 160, 168 220 C 176 160, 170 110, 150 90 Z`} />
    </g>
  );
}

function SolHairFront({ p, uid }: { p: MascotPalette; uid: string }) {
  return (
    <g className="mascot__hair-front">
      <path
        d={`M 70 96
            C 62 120, 58 146, 72 172
            C 80 184, 92 176, 90 160
            C 84 138, 84 112, 80 98 Z`}
        fill={`url(#${uid}-hair)`}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 170 96
            C 178 120, 182 146, 168 172
            C 160 184, 148 176, 150 160
            C 156 138, 156 112, 160 98 Z`}
        fill={`url(#${uid}-hair)`}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      {/* wavy notched bangs */}
      <path
        d={`M 74 88
            C 80 56, 106 46, 122 54
            C 114 74, 96 88, 78 98
            C 70 94, 70 90, 74 88 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 118 54
            C 128 70, 136 76, 148 70
            C 140 86, 124 88, 116 74 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="1.9"
      />
      <path
        d={`M 140 56
            C 154 48, 170 58, 174 80
            C 176 92, 168 102, 156 100
            C 146 86, 140 70, 140 58 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <Shine fill={p.hairLight} d={`M 98 62 C 110 54, 124 58, 126 70 C 114 72, 102 68, 98 62 Z`} />
    </g>
  );
}

function MonHairBack({ p }: { p: MascotPalette }) {
  return (
    <g className="mascot__hair-back">
      <path
        d={`M ${CX} 52
            C 154 50, 176 72, 178 106
            C 180 136, 170 160, 152 170
            Q ${CX} 178, 88 170
            C 70 160, 60 136, 62 106
            C 64 72, 86 50, ${CX} 52 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.2"
      />
      {/* left fall */}
      <path
        d={`M 74 100 C 58 124, 56 160, 70 196 C 78 212, 92 204, 90 186 C 82 154, 82 122, 80 104 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <Shade fill={p.hairDark} d={`M 148 90 C 172 110, 174 150, 154 168 C 168 140, 164 108, 148 90 Z`} />
    </g>
  );
}

function MonHairFront({ p }: { p: MascotPalette }) {
  const braid = [
    [178, 126, 10],
    [184, 142, 9.6],
    [176, 158, 9.2],
    [184, 174, 8.8],
    [176, 190, 8.4],
    [182, 206, 8],
    [176, 222, 7.4],
  ] as const;
  return (
    <g className="mascot__hair-front">
      <path
        d={`M 70 96 C 60 118, 60 146, 72 168 C 78 176, 88 170, 88 156 C 82 132, 80 110, 78 98 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      {/* soft rounded bangs — stop above the eyes */}
      <path
        d={`M 76 88 C 80 60, 104 50, 124 54 C 116 76, 98 90, 80 98 C 74 94, 72 90, 76 88 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      <path
        d={`M 118 54 C 136 48, 158 58, 166 82 C 168 92, 160 100, 150 98 C 138 84, 126 68, 120 56 Z`}
        fill={p.hair}
        stroke={p.outline}
        strokeWidth="2.05"
      />
      {/* braid starts at the right ear, well outside the eye */}
      {braid.map(([x, y, r], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y} rx={r} ry={r * 0.86} fill={i % 2 ? p.hairDark : p.hair} stroke={p.outline} strokeWidth="1.7" />
          <ellipse cx={x - 2.2} cy={y - 2.2} rx={r * 0.28} ry={r * 0.2} fill={p.hairLight} stroke="none" />
        </g>
      ))}
      <path
        d={`M 168 112 C 156 100, 148 112, 160 120 L 174 122 C 170 112, 172 110, 168 112 Z`}
        fill={p.hairAccent}
        stroke={p.outline}
        strokeWidth="1.6"
      />
      <path
        d={`M 188 110 C 204 100, 208 116, 194 124 L 176 122 C 182 112, 184 110, 188 110 Z`}
        fill={p.hairAccent}
        stroke={p.outline}
        strokeWidth="1.6"
      />
      <circle cx="176" cy="118" r="5.2" fill={p.topLight} stroke={p.outline} strokeWidth="1.5" />
      <Shine fill={p.hairLight} d={`M 100 60 C 112 54, 126 56, 128 66 C 116 68, 104 66, 100 60 Z`} />
    </g>
  );
}

export function HairBack({ who, p, uid }: { who: MascotWho; p: MascotPalette; uid: string }) {
  switch (who) {
    case 'base':
      return <BaseHairBack p={p} />;
    case 'arbi':
      return <ArbiHairBack p={p} />;
    case 'hyper':
      return <HyperHairBack p={p} />;
    case 'sol':
      return <SolHairBack p={p} uid={uid} />;
    case 'mon':
      return <MonHairBack p={p} />;
  }
}

export function HairFront({ who, p, uid }: { who: MascotWho; p: MascotPalette; uid: string }) {
  switch (who) {
    case 'base':
      return <BaseHairFront p={p} />;
    case 'arbi':
      return <ArbiHairFront p={p} />;
    case 'hyper':
      return <HyperHairFront p={p} />;
    case 'sol':
      return <SolHairFront p={p} uid={uid} />;
    case 'mon':
      return <MonHairFront p={p} />;
  }
}
