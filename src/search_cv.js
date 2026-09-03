import { el } from './util.js';
import { query } from './db.js';
import { FACETS, ORDER_BY, buildCvWhere, tableFor } from './sql.js';
import { lang } from './i18n.js';
import { staleGuard } from './util.js';
import { createFacet } from './facets.js';
import { createResultsView } from './results.js';
import { createDetailView } from './detail.js';

// "Search by Controlled Vocabulary" tab (port of mod_search.R).
export function createCvSearch({ panel }) {
  const state = { selected: {}, isOr: {}, page: 1, pageSize: 5 };
  const guard = staleGuard();
  const widgets = {};

  // ── DOM ──
  const instructions = el('div', { class: 'portal-filter-header portal-filter-header-s1' }, [
    el('div', { class: 'portal-col-12' }, [el('div', { class: 'portal-instructions', 'data-i18n': 'instructions', 'data-i18n-html': '' })]),
  ]);
  const cols = [0, 1, 2].map((i) => el('div', { class: `portal-col-4 portal-filter-rhs${i ? ' portal-col-divider' : ''}` }));
  const filters = el('div', { class: 'portal-filter-header portal-filter-header-s1' }, cols);
  const body = el('div', { class: 'portal-body' });
  panel.append(instructions, filters, body);

  const onFacetChange = () => { state.page = 1; refresh(); };
  const placement = [[0, 0], [0, 1], [1, 2], [1, 3], [2, 4], [2, 5]];
  for (const [col, fi] of placement) {
    const f = FACETS[fi];
    widgets[f.key] = createFacet({ key: f.key, container: cols[col], onChange: onFacetChange });
  }

  const results = createResultsView({
    container: body,
    hideCensusName: true,
    onOpen: openDetail,
    onPage: (d) => { state.page += d; refresh({ facets: false }); },
    onPageSize: (n) => { state.pageSize = n; state.page = 1; refresh({ facets: false }); },
  });
  const detail = createDetailView({ container: body, onBack: closeDetail });

  // ── Queries ──
  function readState() {
    for (const f of FACETS) {
      state.selected[f.key] = widgets[f.key].getSelected();
      state.isOr[f.key] = widgets[f.key].isOr();
    }
  }

  async function refresh({ facets = true } = {}) {
    const isCurrent = guard.next();
    readState();
    results.setLoading(true);
    const tbl = tableFor(lang());
    const all = buildCvWhere(state);
    try {
      const facetJobs = facets ? FACETS.map((f) => {
        const w = f.list ? all : buildCvWhere(state, { exclude: f.key });
        const expr = f.list ? `UNNEST(${f.key})` : f.key;
        return query(`SELECT DISTINCT ${expr} AS val FROM ${tbl}${w.sql} ORDER BY val`, w.params)
          .then((rows) => rows.map((r) => r.val).filter((v) => v != null && v !== ''));
      }) : [];
      const offset = (state.page - 1) * state.pageSize;
      const [choices, countRows, page] = await Promise.all([
        Promise.all(facetJobs),
        query(`SELECT COUNT(*) AS n FROM ${tbl}${all.sql}`, all.params),
        query(`SELECT * FROM ${tbl}${all.sql}${ORDER_BY} LIMIT ${state.pageSize} OFFSET ${offset}`, all.params),
      ]);
      if (!isCurrent()) return;
      if (facets) FACETS.forEach((f, i) => widgets[f.key].setChoices(choices[i]));
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
    FACETS.forEach((f) => widgets[f.key].clear());
    state.page = 1;
    closeDetail();
    return refresh();
  }

  document.addEventListener('langchange', () => {
    // Selected values are language-specific, so clear and requery.
    results.relabel();
    detail.relabel();
    reset();
  });

  return { refresh, reset };
}
