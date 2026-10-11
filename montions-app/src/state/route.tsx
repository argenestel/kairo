import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'markets' }
  | { name: 'predictions' }
  | { name: 'event'; key: string }
  | { name: 'notfound' };

export function parsePath(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'home' };
  if (p === '/markets') return { name: 'markets' };
  if (p === '/predictions') return { name: 'predictions' };
  const m = /^\/predictions\/([^/]+)$/.exec(p);
  if (m) return { name: 'event', key: decodeURIComponent(m[1]) };
  return { name: 'notfound' };
}

const PRESERVE = ['chain', 'mode'] as const;

export function hrefFor(path: string, extra?: Record<string, string | undefined>): string {
  const url = new URL(path, typeof location === 'undefined' ? 'http://local.invalid' : location.origin);
  if (typeof location !== 'undefined') {
    const cur = new URL(location.href);
    for (const k of PRESERVE) {
      const v = cur.searchParams.get(k);
      if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
  }
  return url.pathname + url.search;
}

export function navigate(path: string, replace = false) {
  const next = hrefFor(path);
  const here = location.pathname + location.search;
  if (next === here) return;
  history[replace ? 'replaceState' : 'pushState'](history.state, '', next);
  window.dispatchEvent(new Event('kairo:nav'));
}

interface RouteApi {
  route: Route;
  path: string;
  go: (path: string, replace?: boolean) => void;
}

const Ctx = createContext<RouteApi>({ route: { name: 'home' }, path: '/', go: () => {} });
export const useRoute = () => useContext(Ctx);

const TITLES: Record<Route['name'], string> = {
  home: 'Kairo — say it, print it, place it',
  markets: 'Markets · Kairo',
  predictions: 'Predictions · Kairo',
  event: 'Prediction · Kairo',
  notfound: 'Not found · Kairo',
};

export function RouteProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => (typeof location === 'undefined' ? '/' : location.pathname));
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener('kairo:nav', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('kairo:nav', sync);
    };
  }, []);
  const route = useMemo(() => parsePath(path), [path]);
  useEffect(() => {
    document.title = route.name === 'event' ? `${route.key} · Kairo` : TITLES[route.name];
  }, [route]);
  const go = useCallback((p: string, replace?: boolean) => navigate(p, replace), []);
  const value = useMemo(() => ({ route, path, go }), [route, path, go]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  replace?: boolean;
};

export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  return (
    <a
      href={hrefFor(to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, replace);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
