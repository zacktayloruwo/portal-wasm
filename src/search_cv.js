/**
 * search_cv.js — "Search by Controlled Vocabulary" tab (port of R/mod_search.R).
 *
 * Five facet dropdowns (facets.js) drive one WHERE clause (sql.buildCvWhere).
 * Every change triggers refresh(), which runs the cvSearch operation
 * (queries.js); it answers, in one batch:
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
import { el, staleGuard, listToArray } from './util.js';
import { run } from '#db';
import { FACETS } from './sql.js';
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
  // Snapshot the widgets into `state` so the query sees consistent input.
  function readState() {
    for (const f of FACETS) {
      state.selected[f.key] = widgets[f.key].getSelected();
      state.isOr[f.key] = widgets[f.key].isOr();
    }
  }

  /** Requery.  `facets: false` skips the five dropdown queries (paging only). */
  async function refresh({ facets = true } = {}) {
    const isCurrent = guard.next();
    readState();
    results.setLoading(true);
    try {
      const { choices, total, rows } = await run('cvSearch', {
        lang: lang(), selected: state.selected, isOr: state.isOr,
        page: state.page, pageSize: state.pageSize, facets,
      });
      if (!isCurrent()) return; // superseded by a newer refresh
      if (facets) FACETS.forEach((f) => widgets[f.key].setChoices(choices[f.key]));
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

  /**
   * Show the opening view written by prep_db.R (snapshot_<lang>.json) without
   * querying: the first page of results and every field's choices.  Used at
   * start-up so results appear before the engine has loaded.
   */
  function showSnapshot(snap) {
    if (snap.page_size !== state.pageSize) return refresh();
    FACETS.forEach((f) => widgets[f.key].setChoices(listToArray(snap.choices?.[f.key])));
    results.render({ rows: snap.rows, total: snap.total, page: 1, pageSize: state.pageSize });
    return Promise.resolve();
  }

  function closeDetail() {
    detail.hide();
    results.show(true);
  }

  /**
   * Clear every facet and start over (used when leaving the keyword tab and on
   * language change).  keepDetail leaves an open record on screen.
   */
  function reset({ keepDetail = false } = {}) {
    FACETS.forEach((f) => widgets[f.key].clear());
    state.page = 1;
    if (!keepDetail) closeDetail();
    return refresh();
  }

  document.addEventListener('langchange', async () => {
    // Facet values are language-specific ("Agriculture" vs "Agriculture" is
    // fine, but most differ), so selections are cleared rather than carried
    // over to the other table where they would match nothing.
    results.relabel();
    // An open record stays open: both tables use the same id.  It is redrawn
    // once the other language's row arrives; without one, back to the results.
    const openId = detail.visible ? detail.id : null;
    if (!openId) { detail.relabel(); reset(); return; }
    reset({ keepDetail: true });
    if (!(await showRecord(openId, { scroll: false }).catch(() => false))) closeDetail();
  });

  return { refresh, reset, showSnapshot };
}
