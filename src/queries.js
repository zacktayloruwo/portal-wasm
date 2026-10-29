/**
 * queries.js — every question the interface asks the database, as named
 * operations.
 *
 * The tabs never write SQL themselves; they call db.run(op, args).  Both
 * editions run the operations below with the same SQL:
 *
 *   static edition (GitHub Pages)   db_wasm.js runs them in DuckDB-WASM
 *   server edition (portal-server)  db_api.js posts {op, args} to the server,
 *                                   whose backend imports this file and runs
 *                                   them in Node's DuckDB
 *
 * so the server never accepts SQL from the browser, only an operation name
 * and its arguments.  Each operation checks its arguments first (the server
 * relies on that), then asks `q(sql, params)` for plain row objects.
 *
 * This file and sql.js must stay free of browser APIs: the server imports
 * them as they are.
 */
import { FACETS, ORDER_BY, PAGE_SIZES, buildCvWhere, buildKwWhere, tableFor } from './sql.js';

const MAX_TEXT = 500;      // longest keyword text accepted
const MAX_VALUES = 200;    // most values selected in one facet

function bad(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

const isStr = (v) => typeof v === 'string' && v.length <= MAX_TEXT;

function checkPage({ page, pageSize }) {
  if (!Number.isInteger(page) || page < 1) bad('bad page');
  if (!PAGE_SIZES.includes(pageSize)) bad('bad pageSize');
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

// Facet selections: only the five known keys, each a short list of strings.
function checkFacets(selected = {}, isOr = {}) {
  const out = { selected: {}, isOr: {} };
  for (const f of FACETS) {
    const vals = selected[f.key] ?? [];
    if (!Array.isArray(vals) || vals.length > MAX_VALUES || !vals.every(isStr)) bad(`bad ${f.key}`);
    out.selected[f.key] = vals;
    out.isOr[f.key] = isOr[f.key] === true;
  }
  return out;
}

// COUNT(*) is a BIGINT; both engines are asked for plain numbers, and Number()
// covers any that still arrive as BigInt.
const count = async (q, sql, params) => Number((await q(sql, params))[0].n);

export const OPS = {
  /**
   * Controlled-vocabulary tab: the page of results, the total, and (unless
   * facets is false) each dropdown's choices given the other selections.
   */
  async cvSearch(q, { lang, selected, isOr, page, pageSize, facets = true }) {
    const tbl = tableFor(lang);
    const { limit, offset } = checkPage({ page, pageSize });
    const state = checkFacets(selected, isOr);
    const all = buildCvWhere(state);
    const facetJobs = facets ? FACETS.map((f) => {
      // Census name excludes its own clause so several censuses can be
      // picked in turn; list facets use the full WHERE (their selected
      // values are still present because the rows that matched contain them).
      const w = f.list ? all : buildCvWhere(state, { exclude: f.key });
      const expr = f.list ? `UNNEST(${f.key})` : f.key;
      return q(`SELECT DISTINCT ${expr} AS val FROM ${tbl}${w.sql} ORDER BY val`, w.params)
        .then((rows) => rows.map((r) => r.val).filter((v) => v != null && v !== ''));
    }) : [];
    const [choices, total, rows] = await Promise.all([
      Promise.all(facetJobs),
      count(q, `SELECT COUNT(*) AS n FROM ${tbl}${all.sql}`, all.params),
      q(`SELECT * FROM ${tbl}${all.sql}${ORDER_BY} LIMIT ${limit} OFFSET ${offset}`, all.params),
    ]);
    return {
      choices: facets ? Object.fromEntries(FACETS.map((f, i) => [f.key, choices[i]])) : null,
      total,
      rows,
    };
  },

  /** Keyword tab: the page of results and the total.  Reads search_text. */
  async kwSearch(q, { lang, kw = '', isOr = false, page, pageSize }) {
    const tbl = tableFor(lang);
    const { limit, offset } = checkPage({ page, pageSize });
    if (!isStr(kw)) bad('bad kw');
    const w = buildKwWhere(kw, isOr === true);
    const [total, rows] = await Promise.all([
      count(q, `SELECT COUNT(*) AS n FROM ${tbl}${w.sql}`, w.params),
      q(`SELECT * FROM ${tbl}${w.sql}${ORDER_BY} LIMIT ${limit} OFFSET ${offset}`, w.params),
    ]);
    return { total, rows };
  },

  /** One full record, for the detail view; null if the id is unknown. */
  async record(q, { lang, id }) {
    const tbl = tableFor(lang);
    if (!isStr(id)) bad('bad id');
    const rows = await q(`SELECT * FROM ${tbl} WHERE id = ?`, [id]);
    return rows[0] ?? null;
  },

  /**
   * Every distinct link-chip label and the most times it appears in one
   * record, so results.js can size the Links column to the widest chip.
   */
  async chipLabels(q, { lang }) {
    const tbl = tableFor(lang);
    return q(`SELECT label, MAX(n) AS n FROM (SELECT id, label, COUNT(*) AS n FROM `
      + `(SELECT id, UNNEST(access_labels) AS label FROM ${tbl}) GROUP BY id, label) GROUP BY label`);
  },
};

/** Look an operation up by name; unknown names are a 400 on the server. */
export function opFor(name) {
  if (!Object.hasOwn(OPS, name)) bad(`unknown op ${name}`);
  return OPS[name];
}

/** Does this keyword-tab call read search_text?  (db_wasm.js builds it lazily.) */
export function needsSearchText(name, args) {
  return name === 'kwSearch' && buildKwWhere(args.kw ?? '', false).sql !== '';
}
