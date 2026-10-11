import { useEffect, useMemo, useState } from 'react';
import { Mascot, Sakura, Sparkles, SpeechBubble, WHO_LABEL } from '../mascot';
import type { ChainKey } from '../chains';
import type { TicketPhase } from '../state/flow';
import { useReducedMotion } from '../lib/hooks';
import { beatFor, CHAIN_TAN } from './lines';
import { SakuraTree } from './SakuraTree';
import './uwu.css';

interface Props {
  step: number;
  direction: 'above' | 'below';
  phase: TicketPhase;
  chain: ChainKey;
  compact: boolean;
}

const BUBBLE: Record<string, 'pink' | 'mint' | 'lavender' | 'cream' | 'sky'> = {
  base: 'sky', arbi: 'sky', hyper: 'mint', sol: 'lavender', mon: 'cream',
};

/** UwU-only decoration: falling sakura, sparkles, and a host chain-tan who reacts to every step. */
export function UwuLayer({ step, direction, phase, chain, compact }: Props) {
  const reduced = useReducedMotion();
  const tanName = WHO_LABEL[CHAIN_TAN[chain] ?? 'mon'];
  const beat = useMemo(() => beatFor(step, direction, phase, chain, tanName), [step, direction, phase, chain, tanName]);
  const [i, setI] = useState(0);
  // Reading pages (paper/docs/thesis…): stay quiet so the bubble never covers text — tap the mascot to talk.
  const reading = /^\/(paper|docs|thesis|litepaper|pitch|submission|demo-script)(\/|$)/.test(location.pathname);
  const quiet = reading || compact; // phones + reading pages: tap the mascot to talk
  const [hideBubble, setHideBubble] = useState(quiet);
  useEffect(() => { setI(0); setHideBubble(quiet); }, [beat, quiet]);
  const line = beat.lines[i % beat.lines.length];

  return (
    <>
      <SakuraTree compact={compact} />
      <div className="uwu-fx" aria-hidden>
        {!reduced && <Sakura count={compact ? 12 : 24} />}
        <Sparkles count={compact ? 6 : 12} />
      </div>
      <div className={`uwu-host${compact ? ' uwu-host--compact' : ''}${step === 5 ? ' uwu-host--ticket' : ''}${reading ? ' uwu-host--reading' : ''}`}>
        {!hideBubble && (
          <SpeechBubble color={BUBBLE[beat.who] ?? 'pink'} className="uwu-host__bubble">
            <span className="uwu-host__name">{WHO_LABEL[beat.who]}</span>
            {line}
          </SpeechBubble>
        )}
        <button
          type="button"
          className="uwu-host__btn"
          aria-label={`${WHO_LABEL[beat.who]} says: ${line}. Tap for another line.`}
          onClick={() => { if (hideBubble) setHideBubble(false); else setI((n) => n + 1); }}
          onDoubleClick={() => setHideBubble(true)}
        >
          <Mascot key={`${beat.who}-${beat.pose}`} who={beat.who} mood={beat.mood} pose={beat.pose} size={compact ? 64 : 172} animated={!reduced} />
        </button>
      </div>
    </>
  );
}
