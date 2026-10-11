import { Component, createRef, type ReactNode } from 'react';

interface Props { k: string | number; nav: 1 | -1; children: ReactNode; className?: string }

/**
 * Cross-fades steps. The outgoing step is snapshotted (DOM clone + canvas pixels) right before React
 * swaps it, so it can animate out without being re-mounted or re-running its effects.
 */
export class StepStage extends Component<Props> {
  private cur = createRef<HTMLDivElement>();
  private exitLayer = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(prev: Props): HTMLElement | null {
    const src = this.cur.current;
    if (prev.k === this.props.k || !src) return null;
    const clone = src.cloneNode(true) as HTMLElement;
    const from = src.querySelectorAll('canvas');
    const to = clone.querySelectorAll('canvas');
    from.forEach((c, i) => {
      const t = to[i] as HTMLCanvasElement | undefined;
      if (!t) return;
      t.width = c.width;
      t.height = c.height;
      try { t.getContext('2d')?.drawImage(c, 0, 0); } catch { /* ignore */ }
    });
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    clone.querySelectorAll('[tabindex]').forEach((n) => n.setAttribute('tabindex', '-1'));
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    return clone;
  }

  componentDidUpdate(_prev: Props, _state: unknown, snap: HTMLElement | null) {
    const layer = this.exitLayer.current;
    if (!snap || !layer) return;
    snap.className = `stage__item is-exiting ${this.props.nav > 0 ? 'to-left' : 'to-right'}`;
    layer.replaceChildren(snap);
    window.setTimeout(() => snap.remove(), 460);
  }

  render() {
    const { k, nav, children, className } = this.props;
    return (
      <div className={`stage ${className ?? ''}`}>
        <div key={k} ref={this.cur} className={`stage__item is-entering ${nav > 0 ? 'from-right' : 'from-left'}`}>
          {children}
        </div>
        <div ref={this.exitLayer} className="stage__exit" aria-hidden />
      </div>
    );
  }
}
