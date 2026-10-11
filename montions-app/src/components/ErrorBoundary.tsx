import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

/** Last line of defence: a crash anywhere below shows a recover card instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[kairo] render error', error, info.componentStack);
  }

  private reset = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('montions.') && !k.includes('burner')) localStorage.removeItem(k);
    } catch { /* ignore */ }
    location.href = location.pathname;
  };

  render() {
    if (!this.state.error) return this.props.children;
    const uwu = document.documentElement.dataset.mode === 'uwu';
    return (
      <div className="crash" role="alert">
        <div className="crash__card">
          <div className="crash__face" aria-hidden>{uwu ? '(；へ：)' : '⚠︎'}</div>
          <h1 className="crash__title">{uwu ? 'Uh-oh… something tripped~' : 'Something went wrong'}</h1>
          <p className="crash__msg">{this.state.error.message || 'Unexpected error'}</p>
          <div className="crash__actions">
            <button className="continue-btn" onClick={() => location.reload()}>Reload</button>
            <button className="glass-btn" onClick={this.reset}>Reset app</button>
          </div>
          <p className="crash__note">Your wallet and on-chain positions are safe — this only affects the page.</p>
        </div>
      </div>
    );
  }
}
