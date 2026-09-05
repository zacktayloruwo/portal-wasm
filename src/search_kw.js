/**
 * search_kw.js — "Search by Keyword" tab (port of R/mod_search_kw.R).
 *
 * A text box, a submit arrow, and one AND/OR toggle.  The text is only
 * *committed* on Enter or the button, but the toggle is read live so flipping
 * it re-filters immediately — both behaviours copied from the R module.
 * Results and detail view are the same components the first tab uses; the
 * only difference is that this tab shows the "Name of Census" column.
 */
import { el, staleGuard } from './util.js';
import { query } from './db.js';
import { ORDER_BY, buildKwWhere, tableFor } from './sql.js';
import { lang } from './i18n.js';
import { createResultsView } from './results.js';
import { createDetailView } from './detail.js';

export function createKwSearch({ panel }) {
  const state = { kw: '', page: 1, pageSize: 5 }; // kw = last committed search text
  const guard = staleGuard();

  // ── DOM ──
  const input = el('input', { type: 'text', class: 'form-control portal-kw-input', id: 'kw-input', autocomplete: 'off' });
  const btn = el('button', { type: 'button', class: 'btn portal-btn-green portal-kw-search-btn', 'aria-label': 'Search', html: '&#10140;' });
  const toggle = el('input', { class: 's2-toggle', type: 'checkbox', role: 'switch', id: 'toggle-kw', 'aria-label': 'AND / OR' });

  const header = el('div', { class: 'portal-filter-header portal-filter-header-kw' }, [
    el('div', { class: 'portal-col-6' }, [el('div', { class: 'portal-instructions', 'data-i18n': 'instructions_kw', 'data-i18n-html': '' })]),
    el('div', { class: 'portal-col-6 portal-kw-input-col' }, [
      el('div', { class: 's2-filter-row' }, [
        el('div', { class: 's2-filter-input' }, [input]),
        btn,
        el('div', { class: 's2-toggle-wrap' }, [
          el('div', { class: 's2-toggle-labels' }, [
            el('span', { class: 's2-and-label', 'data-i18n': 'and' }),
            el('span', { class: 's2-or-label', 'data-i18n': 'or' }),
          ]),
          toggle,
        ]),
      ]),
    ]),
  ]);
  const body = el('div', { class: 'portal-body' });
  panel.append(header, body);

  const results = createResultsView({
    container: body,
    hideCensusName: false,
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
  // The toggle is not part of the committed text: it re-runs the last search at once.
  toggle.addEventListener('change', () => { state.page = 1; refresh(); });

  // Count + current page for the committed keyword (an empty keyword lists everything).
  async function refresh() {
    const isCurrent = guard.next();
    results.setLoading(true);
    const tbl = tableFor(lang());
    const w = buildKwWhere(state.kw, toggle.checked);
    const offset = (state.page - 1) * state.pageSize;
    try {
      const [countRows, page] = await Promise.all([
        query(`SELECT COUNT(*) AS n FROM ${tbl}${w.sql}`, w.params),
        query(`SELECT * FROM ${tbl}${w.sql}${ORDER_BY} LIMIT ${state.pageSize} OFFSET ${offset}`, w.params),
      ]);
      if (!isCurrent()) return;
      results.render({ rows: page, total: Number(countRows[0].n), page: state.page, pageSize: state.pageSize });
    } finally {
      if (isCurrent()) results.setLoading(false);
    }
  }

  async function openDetail(row) {
    const rows = await query(`SELECT * FROM ${tableFor(lang())} WHERE id = ?`, [row.id]);
    if (!rows.length) return;
    results.show(false);
    detail.show(rows[0]);
    body.scrollIntoView({ block: 'start' });
  }

  function closeDetail() {
    detail.hide();
    results.show(true);
  }

  /** Empty the box, reset the toggle to AND, show all rows (used on tab switch and language change). */
  function reset() {
    input.value = '';
    toggle.checked = false;
    state.kw = '';
    state.page = 1;
    closeDetail();
    return refresh();
  }

  document.addEventListener('langchange', () => {
    results.relabel();
    detail.relabel();
    reset();
  });

  return { refresh, reset };
}
