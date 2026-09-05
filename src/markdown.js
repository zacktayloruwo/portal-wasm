/**
 * markdown.js — the Documentation and About tabs.
 *
 * Content is *not* bundled with the site.  Like the Shiny app, the page fetches
 * doc_{en,fr}.md / about_{en,fr}.md from the census-recensement/portal GitHub
 * repository at view time, renders it with marked, and adds a sticky table of
 * contents built from the h2/h3 headings (a port of inject_toc() in
 * R/mod_markdown.R).  Rendered HTML is cached per slug+language for the
 * session.  Trust note: the markdown is inserted without sanitising because it
 * comes from the project's own repository.
 */
import { marked } from 'marked';
import { escapeHtml } from './util.js';
import { lang, tr } from './i18n.js';

const BASE = 'https://raw.githubusercontent.com/census-recensement/portal/refs/heads/main/';
const cache = new Map(); // `${slug}_${lang}` -> html

// Heading text → URL-safe id ("Data Dictionary" → "data-dictionary"); a `used`
// set de-duplicates repeated headings (-2, -3, ...).  Unicode letters are kept
// so French headings get readable ids.
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

// Parse the rendered HTML, give every h2/h3 an id, and wrap body + TOC in the
// two-column .portal-markdown-layout that the CSS expects.
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

/** @param slug 'doc' | 'about' — the file name prefix in the docs repository. */
export function createMarkdownPage({ container, slug }) {
  let shownKey = null; // which slug+lang is currently in the container

  async function load() {
    const l = lang();
    const key = `${slug}_${l}`;
    if (shownKey === key) return; // already showing this language
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
        shownKey = null; // allow a retry next time the tab is opened
        container.innerHTML = `<p class="portal-md-error">${escapeHtml(tr('unavailable'))}</p>`;
        return;
      }
    }
    if (shownKey !== key) return; // language changed while the fetch was in flight
    container.innerHTML = cache.get(key);
    // TOC links scroll within the page.  Letting them change location.hash
    // would confuse the tab router, which treats the hash as the tab name.
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
