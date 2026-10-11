import { useMode } from '../state/mode';

/** One compact switch: shows the current mode, click flips Serious ⇄ UwU. */
export function ModeToggle({ disabled = false, showLabel = false }: { disabled?: boolean; showLabel?: boolean }) {
  const { mode, setMode } = useMode();
  const uwu = mode === 'uwu';
  const next = uwu ? 'Serious' : 'UwU';
  return (
    <button
      type="button"
      className={`mode-switch${uwu ? ' is-uwu' : ''}`}
      onClick={() => setMode(uwu ? 'serious' : 'uwu')}
      disabled={disabled}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <span className="mode-switch__track" aria-hidden>
        <span className="mode-switch__knob">{uwu ? '✿' : '☾'}</span>
      </span>
      {showLabel && <span className="mode-switch__label">{uwu ? 'UwU mode' : 'Serious mode'}</span>}
    </button>
  );
}
