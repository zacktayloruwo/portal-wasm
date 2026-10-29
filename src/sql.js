/**
 * sql.js — SQL builders shared by both search tabs.
 *
 * Every statement here is a direct port of the strings in the Shiny modules
 * (R/mod_search.R, R/mod_search_kw.R, R/fct_search_helpers.R).  Two rules:
 *
 *   1. User-supplied VALUES never go into the SQL text.  They are returned in
 *      a `params` array and bound with `?` placeholders by the engine (queries.js).  DuckDB
 *      accepts placeholders inside list literals ([?, ?]) and IN lists.
 *   2. Column and table NAMES come only from the fixed lists below, so string
 *      interpolation of identifiers is safe.
 */

export const LANGS = ['en', 'fr'];
export const PAGE_SIZES = [5, 10, 15, 25, 50, 100];

// Fixed result order: by the first entry in Census Year(s) Covered by Item
// (the list is stored sorted, so this is the earliest year), then by title.
// NULLS LAST keeps undated items at the end; id makes ties deterministic so
// the browser and R return pages in the same order.
// Keep in step with order_by in prep/prep_db.R, which writes the self-test.
export const ORDER_BY =
  " ORDER BY itemYearsCovered[1] ASC NULLS LAST, itemTitle ASC NULLS LAST, id ASC";

/** inventory_en | inventory_fr — throws on anything else. */
export function tableFor(lang) {
  if (!LANGS.includes(lang)) throw new Error(`bad lang ${lang}`);
  return `inventory_${lang}`;
}

// ── Controlled-vocabulary facets ────────────────────────────────────────────
// The five dropdowns on the first tab.  `list: true` columns are VARCHAR[] in
// the database (an item can have several subjects); itemCensusName is a plain
// scalar column and is filtered with IN instead of the list functions.
export const FACETS = [
  { key: 'itemSubject',      list: true  },
  { key: 'itemCensusName',   list: false },
  { key: 'itemYearsCovered', list: true  },
  { key: 'itemGeoUnits',     list: true  },
  { key: 'itemType',         list: true  },
];

/**
 * Build the WHERE clause for the current facet selections.
 *
 * Fields are always ANDed together.  Within one field the AND | OR control
 * decides how *multiple selected values* combine:
 *   AND (default) → list_has_all(col, [...])  item must contain every value
 *   OR            → list_has_any(col, [...])  item must contain at least one
 * A single value uses list_has_any (the two are equivalent then).
 *
 * `exclude` drops one facet's own clause.  It is used when computing the
 * census-name dropdown so that, after picking one census, the others remain
 * selectable (mirrors where_no_cn in mod_search.R).
 *
 * @param {{selected: Object<string,string[]>, isOr: Object<string,boolean>}} state
 * @returns {{sql: string, params: string[]}}  sql is '' or ' WHERE ...'
 */
export function buildCvWhere(state, { exclude } = {}) {
  const parts = [];
  const params = [];
  for (const f of FACETS) {
    const vals = state.selected[f.key];
    if (!vals || vals.length === 0 || f.key === exclude) continue;
    const ph = vals.map(() => '?').join(', ');
    if (!f.list) {
      parts.push(`${f.key} IN (${ph})`);
    } else {
      const fn = vals.length === 1 || state.isOr[f.key] ? 'list_has_any' : 'list_has_all';
      parts.push(`${fn}(${f.key}, [${ph}])`);
    }
    params.push(...vals);
  }
  return { sql: parts.length ? ' WHERE ' + parts.join(' AND ') : '', params };
}

// ── Keyword search ──────────────────────────────────────────────────────────
// Keywords are matched against one pre-built column, search_text: the title,
// subjects, geographic coverage and geographic units, lower-cased and with
// accents folded, joined with a control character (chr(1)) so a term can
// never match across two fields.  db_wasm.ensureSearchText() adds the column the
// first time keyword search is needed (about 0.2 s); after that each search
// takes a few milliseconds instead of folding every row on every query.
//
// Accent folding is done by hand (not with a Unicode normaliser) so that the
// JavaScript side and the SQL side apply *exactly* the same mapping, and so the
// counts match the R app, which used this same table.
const ACCENT_PAIRS = [
  ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'],
  ['à', 'a'], ['â', 'a'], ['ä', 'a'],
  ['ù', 'u'], ['û', 'u'], ['ü', 'u'],
  ['î', 'i'], ['ï', 'i'],
  ['ô', 'o'], ['ö', 'o'],
  ['ç', 'c'],
  ['œ', 'oe'], ['æ', 'ae'],
];

/** Lower-case and strip accents from the search term (R: deaccent_r). */
export function deaccentJs(s) {
  let out = s.toLowerCase();
  for (const [from, to] of ACCENT_PAIRS) out = out.split(from).join(to);
  return out;
}

/**
 * Wrap a SQL expression in nested replace() calls that strip the same accents
 * (R: deaccent_sql).  DuckDB's replace() is case-sensitive, which is why the
 * expression passed in is already LOWER()ed.
 */
export function deaccentSql(expr) {
  return ACCENT_PAIRS.reduce((acc, [from, to]) => `replace(${acc}, '${from}', '${to}')`, expr);
}

/** SQL expression that builds search_text for one row (see db_wasm.ensureSearchText). */
export const SEARCH_TEXT_SQL = deaccentSql(
  "LOWER(concat_ws(chr(1), itemTitle, array_to_string(itemSubject, chr(1)), " +
  "array_to_string(itemGeoCoverage, chr(1)), array_to_string(itemGeoUnits, chr(1))))",
);

// Straight, curly, and French guillemet quotes all delimit a phrase.
const QUOTE_RX = /["'«»‹›]([^"'«»‹›]*)["'«»‹›]/g;

/**
 * Split the raw search box text into terms.
 *   pass 1: anything inside quotes is one phrase       "place of birth" → place of birth
 *   pass 2: the remainder is split on whitespace/commas  lieu, naissance → lieu | naissance
 * Duplicates and empties are dropped.
 */
export function tokenise(raw) {
  const phrases = [];
  for (const m of raw.matchAll(QUOTE_RX)) {
    const p = m[1].trim();
    if (p) phrases.push(p);
  }
  const remaining = raw.replace(QUOTE_RX, ' ').trim();
  const words = remaining.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
  return [...new Set([...phrases, ...words])];
}

/**
 * Build the WHERE clause for the keyword tab: one
 *   search_text LIKE '%' || ? || '%'
 * per term, joined with AND (every term must appear) or, when the control is
 * set to OR, wrapped in one OR group.  The term is bound as a parameter, so
 * quotes in it cannot break the statement.  % and _ inside a term still act
 * as LIKE wildcards, as in the R app.
 *
 * Same results as the R app's per-column test (title, or any one subject /
 * coverage / unit containing the term): verified by the ?selftest page.
 */
export function buildKwWhere(raw, isOr) {
  const text = (raw ?? '').trim();
  if (!text) return { sql: '', params: [] };
  const phrases = tokenise(text);
  if (!phrases.length) return { sql: '', params: [] };
  const clauses = phrases.map(() => "search_text LIKE '%' || ? || '%'");
  const body = isOr ? `(${clauses.join(' OR ')})` : clauses.join(' AND ');
  return { sql: ' WHERE ' + body, params: phrases.map(deaccentJs) };
}
