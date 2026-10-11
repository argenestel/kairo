import { useMode, type ModeId } from '../state/mode';

const MODES: { id: ModeId; label: string; icon: string; hint: string }[] = [
  { id: 'serious', label: 'Serious', icon: '☾', hint: 'Serious mode: night sky, numbers first' },
  { id: 'uwu', label: 'UwU', icon: '✿', hint: 'UwU mode: pastel sky, sakura and chain-tans' },
];

/** Serious ⇄ UwU switch. The whole look (tokens, copy, scene, mascots) follows `data-mode`. */
export function ModeToggle({ disabled = false }: { disabled?: boolean }) {
  const { mode, setMode } = useMode();
  return (
    <div className="mode-toggle" role="group" aria-label="Visual mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`mode-toggle__btn${mode === m.id ? ' is-on' : ''}`}
          aria-pressed={mode === m.id}
          title={m.hint}
          disabled={disabled}
          onClick={() => setMode(m.id)}
        >
          <span className="mode-toggle__icon" aria-hidden>{m.icon}</span>
          <span className="mode-toggle__label hide-sm">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
