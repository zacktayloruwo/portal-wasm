/**
 * search_cv.js — "Search by Controlled Vocabulary" tab (port of R/mod_search.R).
 *
 * Five facet dropdowns (facets.js) drive one WHERE clause (sql.buildCvWhere).
 * Every change triggers refresh(), which runs, in one batch:
 *   - five SELECT DISTINCT queries that recompute each dropdown's options given
 *     the *other* selections (the "cascade": choices narrow as you filter);
 *   - COUNT(*) for the pagination text;
 *   - the current page of rows.
 * Paging (Previous/Next, page size) re-runs only the count and page queries.
 *
 * Shiny's reactive graph is replaced by two things: a small `state` object
 * read from the widgets before each refresh, and a staleGuard so that a slow
 * refresh cannot overwrite the results of a newer one.
 */
import { el, staleGuard } from './util.js';
import { query } from './db.js';
import { FACETS, ORDER_BY, buildCvWhere, tableFor } from './sql.js';
import { lang } from './i18n.js';
import { createFacet } from './facets.js';
import { createResultsView } from './results.js';
import { createDetailView } from './detail.js';

export function createCvSearch({ panel }) {
  const state = { selected: {}, isOr: {}, page: 1, pageSize: 25 };
  const guard = staleGuard();
  const widgets = {}; // facet key -> facet widget

  // ── DOM: one-sentence intro, two columns of facets (the second narrower), results ──
  const cols = [el('div', { class: 'portal-filter-col' }), el('div', { class: 'portal-filter-col' })];
  const filters = el('div', { class: 'portal-filters' }, [
    el('p', { class: 'portal-intro', 'data-i18n': 'instructions', 'data-i18n-html': '' }),
    el('div', { class: 'portal-filter-grid' }, cols),
  ]);
  const body = el('div', { class: 'portal-body' });
  panel.append(filters, body);

  // Any facet or All | Any change: back to page 1 and requery everything.
  const onFacetChange = () => { state.page = 1; refresh(); };
  // [column, FACETS index]:
  //   col 0: Subject, Name of Census, Years covered
  //   col 1: Geographic units, Content type
  const placement = [[0, 0], [0, 1], [0, 2], [1, 3], [1, 4]];
  for (const [col, fi] of placement) {
    const f = FACETS[fi];
    widgets[f.key] = createFacet({ key: f.key, container: cols[col], onChange: onFacetChange });
  }

  const results = createResultsView({
    container: body,
    pageSize: state.pageSize,
    onOpen: openDetail,
    onPage: (d) => { state.page += d; refresh({ facets: false }); },
    onPageSize: (n) => { state.pageSize = n; state.page = 1; refresh({ facets: false }); },
  });
  const detail = createDetailView({ container: body, onBack: closeDetail });

  // ── Queries ──
  // Snapshot the widgets into `state` so buildCvWhere sees consistent input.
  function readState() {
    for (const f of FACETS) {
      state.selected[f.key] = widgets[f.key].getSelected();
      state.isOr[f.key] = widgets[f.key].isOr();
    }
  }

  /**
   * Requery.  `facets: false` skips the five dropdown queries (paging only).
   * All queries are issued at once; DuckDB's worker executes them serially,
   * Promise.all just collects the results.
   */
  async function refresh({ facets = true } = {}) {
    const isCurrent = guard.next();
    readState();
    results.setLoading(true);
    const tbl = tableFor(lang());
    const all = buildCvWhere(state);
    try {
      const facetJobs = facets ? FACETS.map((f) => {
        // Census name excludes its own clause so several censuses can be
        // picked in turn; list facets use the full WHERE (their selected
        // values are still present because the rows that matched contain them).
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
      if (!isCurrent()) return; // superseded by a newer refresh
      if (facets) FACETS.forEach((f, i) => widgets[f.key].setChoices(choices[i]));
      results.render({ rows: page, total: Number(countRows[0].n), page: state.page, pageSize: state.pageSize });
    } finally {
      if (isCurrent()) results.setLoading(false);
    }
  }

  // Title clicked: fetch the full record by id and swap the results for the detail view.
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

  /** Clear every facet and start over (used when leaving the keyword tab and on language change). */
  function reset() {
    FACETS.forEach((f) => widgets[f.key].clear());
    state.page = 1;
    closeDetail();
    return refresh();
  }

  document.addEventListener('langchange', () => {
    // Facet values are language-specific ("Agriculture" vs "Agriculture" is
    // fine, but most differ), so selections are cleared rather than carried
    // over to the other table where they would match nothing.
    results.relabel();
    detail.relabel();
    reset();
  });

  return { refresh, reset };
}
