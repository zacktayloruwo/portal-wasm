/**
 * search_kw.js — "Search by Keyword" tab (port of R/mod_search_kw.R).
 *
 * A text box, a Search button, and one All | Any control.  The text is only
 * *committed* on Enter or the button, but All | Any is read live so switching
 * it re-filters immediately — both behaviours copied from the R module.
 * Results and detail view are the same components the first tab uses.
 */
import { el, staleGuard } from './util.js';
import { run } from '#db';
import { lang, tr } from './i18n.js';
import { createAllAny } from './facets.js';
import { createResultsView } from './results.js';
import { createDetailView } from './detail.js';

export function createKwSearch({ panel }) {
  const state = { kw: '', page: 1, pageSize: 25 }; // kw = last committed search text
  const guard = staleGuard();

  // ── DOM ──
  const input = el('input', { type: 'search', class: 'form-control portal-kw-input', id: 'kw-input', autocomplete: 'off' });
  const btn = el('button', { type: 'button', class: 'btn portal-btn-primary portal-kw-search-btn', 'data-i18n': 'search_btn' });
  // All | Any is not part of the committed text: switching it re-runs the last search at once.
  const mode = createAllAny({ onChange: () => { state.page = 1; refresh(); }, label: () => tr('match_mode', { field: tr('keywords') }) });
  const relabelInput = () => input.setAttribute('aria-label', tr('keywords'));
  relabelInput();
  document.addEventListener('langchange', relabelInput);

  const header = el('div', { class: 'portal-filters' }, [
    el('p', { class: 'portal-intro', 'data-i18n': 'instructions_kw', 'data-i18n-html': '' }),
    el('div', { class: 'portal-kw-row' }, [input, btn, mode.el]),
  ]);
  const body = el('div', { class: 'portal-body' });
  panel.append(header, body);

  const results = createResultsView({
    container: body,
    pageSize: state.pageSize,
    onOpen: openDetail,
    onPage: (d) => { state.page += d; refresh(); },
    onPageSize: (n) => { state.pageSize = n; state.page = 1; refresh(); },
  });
  const detail = createDetailView({ container: body, onBack: closeDetail });

  // Commit the text box (Enter or arrow button).
  function commit() {
    state.kw = input.value.trim();
    state.page = 1;
    closeDetail();
    refresh();
  }
  btn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

  // Count + current page for the committed keyword (an empty keyword lists everything).
  async function refresh() {
    const isCurrent = guard.next();
    results.setLoading(true);
    try {
      // Keyword queries read the pre-built search_text column (built once per language).
      const { total, rows } = await run('kwSearch', {
        lang: lang(), kw: state.kw, isOr: mode.isOr(), page: state.page, pageSize: state.pageSize,
      });
      if (!isCurrent()) return;
      results.render({ rows, total, page: state.page, pageSize: state.pageSize });
    } finally {
      if (isCurrent()) results.setLoading(false);
    }
  }

  // Title clicked: fetch the full record by id and swap the results for the detail view.
  function openDetail(row) { return showRecord(row.id); }

  /** Fetch record `id` in the current language and show it; false if there is none. */
  async function showRecord(id, { scroll = true } = {}) {
    // Spinner while the record loads (seconds if the engine is still starting).
    results.setLoading(true);
    let rec;
    try {
      rec = await run('record', { lang: lang(), id });
    } finally {
      results.setLoading(false);
    }
    if (!rec) return false;
    results.show(false);
    detail.show(rec);
    if (scroll) body.scrollIntoView({ block: 'start' });
    return true;
  }

  /** Show the opening view from snapshot_<lang>.json (see search_cv.js). */
  function showSnapshot(snap) {
    if (snap.page_size !== state.pageSize) return refresh();
    results.render({ rows: snap.rows, total: snap.total, page: 1, pageSize: state.pageSize });
    return Promise.resolve();
  }

  function closeDetail() {
    detail.hide();
    results.show(true);
  }

  /**
   * Empty the box, reset to All, show all rows (used on tab switch and
   * language change).  keepDetail leaves an open record on screen; keepMode
   * keeps AND | OR (a language switch keeps it, a tab switch does not).
   */
  function reset({ keepDetail = false, keepMode = false } = {}) {
    input.value = '';
    if (!keepMode) mode.reset();
    state.kw = '';
    state.page = 1;
    if (!keepDetail) closeDetail();
    return refresh();
  }

  document.addEventListener('langchange', async () => {
    results.relabel();
    // An open record stays open in the other language (see search_cv.js).
    // The words typed are cleared, being in the old language; AND | OR stays.
    const openId = detail.visible ? detail.id : null;
    if (!openId) { detail.relabel(); reset({ keepMode: true }); return; }
    reset({ keepDetail: true, keepMode: true });
    if (!(await showRecord(openId, { scroll: false }).catch(() => false))) closeDetail();
  });

  return { refresh, reset, showSnapshot };
}
