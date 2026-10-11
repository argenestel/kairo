import { STEPS } from '../state/flow';

const NAMES = ['Asset', 'Prediction', 'Price level', 'Date', 'Amount', 'Ticket'];

export function ProgressDots({ step, reached, onGo }: { step: number; reached: number; onGo: (i: number) => void }) {
  return (
    <nav className="dots" aria-label="Progress">
      {STEPS.map((s, i) => (
        <button
          key={s}
          className={`dots__dot${i === step ? ' is-current' : ''}${i <= reached ? ' is-reached' : ''}`}
          onClick={() => onGo(i)}
          disabled={i > reached || i === step}
          aria-label={`Step ${i + 1}: ${NAMES[i]}`}
          aria-current={i === step ? 'step' : undefined}
        />
      ))}
    </nav>
  );
}
