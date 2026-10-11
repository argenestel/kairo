import { useId } from 'react';
import { MascotSvg } from './MascotSvg';
import { SpeechBubble } from './SpeechBubble';
import { kaomoji, kaomojiFor } from './kaomoji';
import type { MascotProps } from './types';
import './mascot.css';

export type { MascotMood, MascotPose, MascotProps, MascotWho } from './types';
export { MASCOT_MOODS, MASCOT_POSES, MASCOT_WHO } from './types';
export { SpeechBubble };
export { kaomoji, kaomojiFor };

export function Mascot({
  who,
  mood = 'happy',
  pose = 'idle',
  size = 168,
  className,
  animated = true,
}: MascotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const classes = [
    'mascot',
    `mascot--${who}`,
    `mascot--${mood}`,
    `mascot--${pose}`,
    animated ? '' : 'mascot--static',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      <MascotSvg
        who={who}
        mood={mood}
        pose={pose}
        uid={uid}
        size={size}
        className="mascot__svg"
      />
    </span>
  );
}
