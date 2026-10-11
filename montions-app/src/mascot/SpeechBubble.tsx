import type { ReactNode } from 'react';
import './mascot.css';

export type SpeechBubbleColor = 'pink' | 'mint' | 'lavender' | 'cream' | 'sky';
export type SpeechBubbleTail = 'left' | 'right';

export function SpeechBubble({
  children,
  color = 'pink',
  tail = 'left',
  className,
}: {
  children: ReactNode;
  color?: SpeechBubbleColor;
  tail?: SpeechBubbleTail;
  className?: string;
}) {
  const classes = [
    'speech-bubble',
    `speech-bubble--${color}`,
    tail === 'right' ? 'speech-bubble--right' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="note">
      {children}
      <span className="speech-bubble__tail" aria-hidden />
    </div>
  );
}
