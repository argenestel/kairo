import { useEffect, useMemo, useRef } from 'react';
import { Link, useRoute } from '../../state/route';
import { brand, docsNav, meta, renderDocument, source, thesisNav } from './content';
import '../../styles/reading.css';

export default function ReadingPage() {
  const { path } = useRoute();
  const root = useRef<HTMLDivElement>(null);
  const clean = path.replace(/\/+$/, '');
  const isDocs = clean === '/docs' || clean.startsWith('/docs/');
  const slug = isDocs ? clean.split('/')[2] || 'overview' : clean.slice(1);
  const entry = isDocs ? docsNav.find((item) => item.slug === slug) : thesisNav.find((item) => item.slug === slug);
  const file = slug === 'paper' ? 'cross-chain-options.md' : isDocs ? `docs/${slug}.md` : thesisNav.find((item) => item.slug === slug)?.file;
  const markdown = file ? source(file) : undefined;
  const title = slug === 'paper' ? meta.title : brand(markdown?.match(/^# (.+)/m)?.[1] ?? 'Document not found');
  const rendered = useMemo(() => renderDocument(markdown ?? 'This document is unavailable. [Browse the docs](/docs).', file ?? ''), [markdown, file]);
  useEffect(() => {
    const main = root.current?.closest('main');
    main?.scrollTo({ top: 0 });
    const frame = root.current?.closest('.app');
    frame?.classList.add('app--reading');
    // RouteProvider also sets titles; run after its route effect has completed.
    const timer = window.setTimeout(() => { document.title = `${title} · Kairo`; }, 0);
    return () => { frame?.classList.remove('app--reading'); window.clearTimeout(timer); };
  }, [path, title]);
  return (
    <div className="reading" ref={root} key={path}>
      <nav className="reading__nav" aria-label="Kairo library">
        <span>Kairo / Library</span>
        <div>{['paper', 'docs', 'thesis'].map((page) => <Link key={page} to={`/${page}`} aria-current={(page === slug || (page === 'docs' && isDocs)) ? 'page' : undefined}>{page[0].toUpperCase() + page.slice(1)}</Link>)}</div>
      </nav>
      <div className="reading__grid">
        <aside className="reading__sidebar">
          <details open>
            <summary>{isDocs ? 'Documentation' : slug === 'paper' ? 'On this page' : 'Perspectives'}</summary>
            {isDocs ? <nav aria-label="Documentation">{docsNav.map((item) => <Link key={item.slug} to={`/docs/${item.slug}`} aria-current={slug === item.slug ? 'page' : undefined}>{item.title}</Link>)}</nav> : slug !== 'paper' && <nav aria-label="Thesis library">{thesisNav.map((item) => <Link key={item.slug} to={`/${item.slug}`} aria-current={slug === item.slug ? 'page' : undefined}>{item.title}</Link>)}</nav>}
            <nav className="reading__toc" aria-label="Table of contents">{rendered.toc.map((item) => <a className={item.depth === 3 ? 'is-subsection' : ''} key={item.id} href={`#${item.id}`}>{item.text}</a>)}</nav>
          </details>
        </aside>
        <article className="reading__card" aria-label={title}>
          <header className="reading__title">
            <p className="reading__eyebrow">{isDocs ? 'Documentation' : slug === 'paper' ? 'Research paper' : entry?.title ?? 'Library'} / Kairo</p>
            <h1>{title}</h1>
            {slug === 'paper' && <p className="reading__subtitle">{brand(meta.subtitle)}</p>}
            <div className="reading__meta"><span>{brand(meta.authors)} · {meta.date} · v{meta.version}</span><button onClick={() => window.print()}>Download PDF <span aria-hidden>↗</span></button></div>
          </header>
          {slug === 'paper' && <p className="reading__abstract">{brand(meta.abstract)}</p>}
          <div className="reading__prose" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          <footer className="reading__footer"><span>Kairo · Testnet research & documentation</span><Link to="/">Open Kairo ↗</Link></footer>
        </article>
      </div>
    </div>
  );
}
