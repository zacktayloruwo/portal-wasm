import { el } from './util.js';
import { query } from './db.js';
import { ORDER_BY, buildKwWhere, tableFor } from './sql.js';
import { lang } from './i18n.js';
import { staleGuard } from './util.js';
import { createResultsView } from './results.js';
import { createDetailView } from './detail.js';

// "Search by Keyword" tab (port of mod_search_kw.R).  The text is committed
// on Enter / button click; the AND/OR toggle is read live.
export function createKwSearch({ panel }) {
  const state = { kw: '', page: 1, pageSize: 5 };
  const guard = staleGuard();

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

  function commit() {
    state.kw = input.value.trim();
    state.page = 1;
    closeDetail();
    refresh();
  }
  btn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  toggle.addEventListener('change', () => { state.page = 1; refresh(); });

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
