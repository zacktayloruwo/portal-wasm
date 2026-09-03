// Hash-based tab router.  Panels are <section class="portal-panel" id="panel-<tab>">
// and tab buttons are <button data-tab="<tab>"> inside nav.portal-tabs.

export const TABS = ['search', 'search_kw', 'visualize', 'documentation', 'about'];
let active = null;
let onShow = () => {};

function tabFromHash() {
  const h = location.hash.replace(/^#/, '');
  return TABS.includes(h) ? h : 'search';
}

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

export function initRouter(handler) {
  onShow = handler;
  document.querySelectorAll('nav.portal-tabs button[data-tab]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = b.dataset.tab; });
  });
  window.addEventListener('hashchange', () => show(tabFromHash()));
  show(tabFromHash());
}

export const activeTab = () => active;
