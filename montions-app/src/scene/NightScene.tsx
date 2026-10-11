import { useEffect, useRef } from 'react';
import { createScene, type Mood, type SceneHandle } from './scene';
import { useReducedMotion } from '../lib/hooks';

export function NightScene({ mood }: { mood: Mood }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const handle = useRef<SceneHandle | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!ref.current) return;
    const h = createScene(ref.current, { reduced });
    handle.current = h;
    return () => { h.destroy(); handle.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => handle.current?.setReduced(reduced), [reduced]);
  useEffect(() => handle.current?.setMood(mood), [mood]);
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => handle.current?.reloadTheme());
    obs.observe(root, { attributes: true, attributeFilter: ['data-mode'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="scene" aria-hidden>
      <canvas ref={ref} className="scene__canvas" />
      <div className="scene__vignette" />
    </div>
  );
}
