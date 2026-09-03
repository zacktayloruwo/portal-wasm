import { marked } from 'marked';
import { escapeHtml } from './util.js';
import { lang, tr } from './i18n.js';

const BASE = 'https://raw.githubusercontent.com/census-recensement/portal/refs/heads/main/';
const cache = new Map(); // `${slug}_${lang}` -> html

function slugify(text, used) {
  let s = text.toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  let out = s; let i = 2;
  while (used.has(out)) out = `${s}-${i++}`;
  used.add(out);
  return out;
}

// Port of inject_toc(): h2/h3 headings become a sticky right-hand TOC.
function withToc(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const used = new Set();
  const items = [];
  doc.querySelectorAll('h2, h3').forEach((h) => {
    if (!h.id) h.id = slugify(h.textContent, used); else used.add(h.id);
    items.push(`<li class="portal-toc-${h.tagName.toLowerCase()}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.textContent.trim())}</a></li>`);
  });
  const body = `<article class="portal-markdown-body">${doc.body.innerHTML}</article>`;
  const nav = items.length
    ? `<nav class="portal-toc"><p class="portal-toc-title">${escapeHtml(tr('contents'))}</p><ul>${items.join('')}</ul></nav>`
    : '';
  return `<div class="portal-markdown-layout">${body}${nav}</div>`;
}

export function createMarkdownPage({ container, slug }) {
  let shownKey = null;

  async function load() {
    const l = lang();
    const key = `${slug}_${l}`;
    if (shownKey === key) return;
    shownKey = key;
    if (!cache.has(key)) {
      container.innerHTML = `<p class="portal-md-loading">${escapeHtml(tr('loading'))}…</p>`;
      try {
        const res = await fetch(`${BASE}${key}.md`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = await res.text();
        cache.set(key, withToc(marked.parse(md)));
      } catch (err) {
        console.warn('markdown fetch failed', key, err);
        shownKey = null;
        container.innerHTML = `<p class="portal-md-error">${escapeHtml(tr('unavailable'))}</p>`;
        return;
      }
    }
    if (shownKey !== key) return; // language changed meanwhile
    container.innerHTML = cache.get(key);
    // In-page TOC links: scroll instead of changing the tab hash.
    container.querySelectorAll('nav.portal-toc a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = container.querySelector(`#${CSS.escape(a.getAttribute('href').slice(1))}`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  return { load, invalidate() { shownKey = null; } };
}
