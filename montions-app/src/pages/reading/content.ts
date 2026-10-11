import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import meta from '@kairo/paper/meta.json';
import docsNav from '@kairo/paper/docs/nav.json';
import thesisNav from '@kairo/paper/thesis-nav.json';

const sources = import.meta.glob('@kairo/paper/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const figures = import.meta.glob('@kairo/paper/figures/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export { meta, docsNav, thesisNav };
export const brand = (text: string) => text.replace(/\bMontions\b/g, 'Kairo');
export function source(file: string) {
  return Object.entries(sources).find(([key]) => key.endsWith(`/paper/${file}`))?.[1];
}

export function documentHref(href: string, file: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const url = new URL(href, `https://reading.invalid/${file}`);
  const path = url.pathname.replace(/^\//, '');
  if (path === 'cross-chain-options.md') return `/paper${url.hash}`;
  const doc = docsNav.find((item) => path === `docs/${item.slug}.md`);
  if (doc) return `/docs/${doc.slug}${url.hash}`;
  const thesis = thesisNav.find((item) => path === item.file);
  if (thesis) return `/${thesis.slug}${url.hash}`;
  return href;
}

export function renderDocument(markdown: string, file: string) {
  const toc: { id: string; text: string; depth: number }[] = [];
  const ids = new Map<string, number>();
  const parser = new Marked({ gfm: true, breaks: false });
  parser.use({ renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const base = text.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
      const count = ids.get(base) ?? 0;
      ids.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      if (depth === 2 || depth === 3) toc.push({ id, text: text.replace(/<[^>]+>/g, ''), depth });
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    },
    image({ href, text }) {
      const name = href.split('/').pop();
      const svg = Object.entries(figures).find(([key]) => key.endsWith(`/figures/${name}`))?.[1];
      if (!svg) return '';
      // SVGs are local, read-only build inputs; sanitize before placing them inline.
      return `<figure>${inlineFigure(svg)}<figcaption>${DOMPurify.sanitize(text)}</figcaption></figure>`;
    },
    link(token) {
      return `<a href="${DOMPurify.sanitize(documentHref(token.href, file)).replace(/"/g, '&quot;')}">${this.parser.parseInline(token.tokens)}</a>`;
    },
  } });

  const notes: { label: string; body: string }[] = [];
  let body = brand(markdown).replace(/^\[\^([\w-]+)\]: (.+)$/gm, (_, label: string, text: string) => {
    notes.push({ label, body: text });
    return '';
  });
  // Display title and publication metadata once, in the page chrome.
  body = body.replace(/^# .+\n+/, '');
  if (file === 'cross-chain-options.md') body = body.replace(/^[\s\S]*?(?=## Abstract)/, '');
  const refs = new Map<string, number>();
  const occurrences = new Map<string, number>();
  body = body.replace(/\[\^([\w-]+)\]/g, (_, label: string) => {
    const number = refs.get(label) ?? refs.size + 1;
    refs.set(label, number);
    const occurrence = (occurrences.get(label) ?? 0) + 1;
    occurrences.set(label, occurrence);
    return `<sup><a id="ref-${label}-${occurrence}" href="#note-${label}" aria-label="Reference ${number}">[${number}]</a></sup>`;
  });
  body = body.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, math: string) => `\n\n<pre class="reading-math">${escapeHtml(math)}</pre>\n\n`)
    .replace(/\\\((.*?)\\\)/g, (_, math: string) => `<code class="reading-math-inline">${escapeHtml(math)}</code>`);
  let html = parser.parse(body) as string;
  if (notes.length) {
    html += '<section class="reading-notes" aria-label="Footnotes"><h2 id="footnotes">Footnotes</h2><ol>';
    for (const note of notes) {
      html += `<li id="note-${note.label}" value="${refs.get(note.label) ?? notes.indexOf(note) + 1}">${parser.parse(note.body)} <a href="#ref-${note.label}-1" aria-label="Back to reference">↩</a></li>`;
    }
    html += '</ol></section>';
    toc.push({ id: 'footnotes', text: 'Footnotes', depth: 2 });
  }
  // Preserve safe inline diagrams and heading IDs, while excluding executable markup.
  return { html: DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'], ADD_ATTR: ['aria-label'] }), toc };
}

function inlineFigure(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  // Inline the trusted figure styles so generic .line/.box selectors never affect the app.
  for (const sheet of doc.querySelectorAll('style')) {
    for (const rule of (sheet.textContent ?? '').matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      for (const node of doc.querySelectorAll(rule[1].trim())) node.setAttribute('style', rule[2].trim());
    }
    sheet.remove();
  }
  return DOMPurify.sanitize(doc.documentElement.outerHTML, { USE_PROFILES: { svg: true, svgFilters: true } });
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
