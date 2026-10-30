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
import { lang, tr } from './i18n.js';
import { createFacet } from './facets.js';
import { createResultsView } from './results.js';
import { createDetailView } from './detail.js';

// data/vocab.json (prep/vocab.R): each field's terms paired across the two
// languages, { field: { en: { term: French term }, fr: { term: English term } } }.
// Fetched once, the first time a selection may need carrying across.
let vocabPromise = null;
function loadVocab() {
  vocabPromise ??= fetch(`${import.meta.env.BASE_URL}data/vocab.json`, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`vocab.json: HTTP ${r.status}`); return r.json(); })
    .catch((err) => { vocabPromise = null; throw err; });
  return vocabPromise;
}

export function createCvSearch({ panel }) {
  const state = { selected: {}, isOr: {}, page: 1, pageSize: 25 };
  const guard = staleGuard();
  const widgets = {}; // facet key -> facet widget

  // ── DOM: one-sentence intro, two columns of facets (the second narrower), results ──
  const cols = [el('div', { class: 'portal-filter-col' }), el('div', { class: 'portal-filter-col' })];
  // After a language switch: the selected terms that have no equivalent.
  const noteText = el('span');
  const noteClose = el('button', { type: 'button', class: 'portal-note-close', html: '&times;' });
  const note = el('p', { class: 'portal-note', role: 'status', hidden: true }, [noteText, noteClose]);
  const showNote = (terms) => {
    note.hidden = terms.length === 0;
    noteText.textContent = terms.length ? tr('not_carried', { terms: terms.join(', ') }) : '';
    noteClose.setAttribute('aria-label', tr('dismiss'));
  };
  noteClose.addEventListener('click', () => showNote([]));
  const filters = el('div', { class: 'portal-filters' }, [
    el('p', { class: 'portal-intro', 'data-i18n': 'instructions', 'data-i18n-html': '' }),
    el('div', { class: 'portal-filter-grid' }, cols),
    note,
  ]);
  const body = el('div', { class: 'portal-body' });
  panel.append(filters, body);

  // Any facet or All | Any change: back to page 1 and requery everything.
  // The first selection also fetches the term pairs, ready for a switch.
  const onFacetChange = () => {
    showNote([]);
    loadVocab().catch(() => {});
    state.page = 1;
    refresh();
  };
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

  /** Clear every facet and start over (used when leaving the keyword tab). */
  function reset() {
    FACETS.forEach((f) => widgets[f.key].clear());
    showNote([]);
    state.page = 1;
    closeDetail();
    return refresh();
  }

  /**
   * Swap each field's selected terms for their equivalents in the new
   * language (vocab.json), keeping every AND | OR choice.  Terms without an
   * equivalent are dropped and listed under the fields.  Two terms with the
   * same equivalent become one.
   */
  async function carrySelections(from) {
    const before = FACETS.map((f) => ({
      key: f.key, values: widgets[f.key].getSelected(), isOr: widgets[f.key].isOr(),
    }));
    let vocab = null;
    if (before.some((b) => b.values.length)) {
      try { vocab = await loadVocab(); } catch (err) { console.error(err); }
    }
    const dropped = [];
    for (const b of before) {
      const pairs = vocab?.[b.key]?.[from] ?? {};
      const values = [];
      for (const v of b.values) {
        const to = Object.hasOwn(pairs, v) ? pairs[v] : null;
        if (to == null) { if (vocab) dropped.push(v); } else if (!values.includes(to)) values.push(to);
      }
      widgets[b.key].restore(values, b.isOr);
    }
    showNote(dropped);
  }

  document.addEventListener('langchange', async (e) => {
    results.relabel();
    // An open record stays open: both tables use the same id.  It is redrawn
    // once the other language's row arrives; without one, back to the results.
    const openId = detail.visible ? detail.id : null;
    if (!openId) detail.relabel();
    await carrySelections(e.detail.lang === 'en' ? 'fr' : 'en');
    state.page = 1;
    refresh();
    if (openId && !(await showRecord(openId, { scroll: false }).catch(() => false))) closeDetail();
  });

  return { refresh, reset, showSnapshot };
}
