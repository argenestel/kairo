import { Accessories } from './parts/Accessories';
import { Arms } from './parts/Arms';
import { Body, Hood } from './parts/Body';
import { Brows, Eyes } from './parts/Eyes';
import { HairBack, HairFront } from './parts/Hair';
import { Ears, Head, Neck } from './parts/Head';
import { Mouth } from './parts/Mouth';
import { VIEW_H, VIEW_W } from './layout';
import { palettes, WHO_LABEL } from './palettes';
import type { MascotMood, MascotPose, MascotWho } from './types';

export type MascotSvgProps = {
  who: MascotWho;
  mood?: MascotMood;
  pose?: MascotPose;
  uid: string;
  size?: number;
  className?: string;
};

export function MascotSvg({
  who,
  mood = 'neutral',
  pose = 'idle',
  uid,
  size,
  className,
}: MascotSvgProps) {
  const p = palettes[who];
  const w = size ?? VIEW_W;
  const h = size ? (size * VIEW_H) / VIEW_W : VIEW_H;
  const label = `${WHO_LABEL[who]}, ${mood}, ${pose}`;

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      fill="none"
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      <defs>
        <radialGradient id={`${uid}-iris`} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor={p.iris} />
          <stop offset="100%" stopColor={p.irisDark} />
        </radialGradient>
        <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.hair} />
          <stop offset="62%" stopColor={p.hair} />
          <stop offset="100%" stopColor={p.hairAccent} />
        </linearGradient>
      </defs>
      <ellipse className="mascot__shadow" cx="120" cy="270" rx="44" ry="7.5" fill="rgba(40, 24, 36, 0.14)" />
      <g className="mascot__bob" strokeLinejoin="round" strokeLinecap="round">
        <Hood who={who} p={p} />
        <HairBack who={who} p={p} uid={uid} />
        <Arms pose={pose} p={p} who={who} layer="back" />
        <Body who={who} p={p} />
        <Neck p={p} />
        <Arms pose={pose} p={p} who={who} layer="mid" />
        <Ears p={p} />
        <Head p={p} mood={mood} />
        <Brows mood={mood} p={p} />
        <Eyes mood={mood} p={p} uid={uid} />
        <Mouth mood={mood} p={p} />
        <HairFront who={who} p={p} uid={uid} />
        <Accessories who={who} mood={mood} p={p} />
        <Arms pose={pose} p={p} who={who} layer="front" />
      </g>
    </svg>
  );
}
