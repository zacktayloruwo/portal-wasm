/**
 * router.js — hash-based tab switching.
 *
 * The URL hash names the visible tab (#search, #search_kw, #visualize,
 * #documentation, #about), so tabs are bookmarkable and the browser back
 * button works.  Markup contract with index.html:
 *   <nav class="portal-tabs"><button data-tab="search">…</button>…</nav>
 *   <section class="portal-panel" id="panel-search" hidden>…</section>
 */

export const TABS = ['search', 'search_kw', 'visualize', 'documentation', 'about'];
let active = null;
let onShow = () => {};

// Unknown or missing hash → first tab.
function tabFromHash() {
  const h = location.hash.replace(/^#/, '');
  return TABS.includes(h) ? h : 'search';
}

// Toggle button state and panel visibility, then tell main.js which tab
// appeared and which one it replaced (main.js uses `prev` for the
// "leaving one search tab resets the other" rule).
function show(tab) {
  const prev = active;
  if (prev === tab) return;
  active = tab;
  document.querySelectorAll('nav.portal-tabs button[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
  });
  document.querySelectorAll('section.portal-panel').forEach((p) => {
    p.hidden = p.id !== `panel-${tab}`;
  });
  onShow(tab, prev);
}

/** Wire the buttons, listen for hash changes, and show the initial tab. */
export function initRouter(handler) {
  onShow = handler;
  document.querySelectorAll('nav.portal-tabs button[data-tab]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = b.dataset.tab; });
  });
  window.addEventListener('hashchange', () => show(tabFromHash()));
  show(tabFromHash());
}

export const activeTab = () => active;
