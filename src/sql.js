/**
 * sql.js — SQL builders shared by both search tabs.
 *
 * Every statement here is a direct port of the strings in the Shiny modules
 * (R/mod_search.R, R/mod_search_kw.R, R/fct_search_helpers.R).  Two rules:
 *
 *   1. User-supplied VALUES never go into the SQL text.  They are returned in
 *      a `params` array and bound with `?` placeholders by db.query().  DuckDB
 *      accepts placeholders inside list literals ([?, ?]) and IN lists.
 *   2. Column and table NAMES come only from the fixed lists below, so string
 *      interpolation of identifiers is safe.
 */

export const LANGS = ['en', 'fr'];
export const PAGE_SIZES = [5, 10, 15, 25, 50, 100];

// Fixed result order, identical to the Shiny app: first by census year of
// publication (list joined with commas; falls back to the first year covered),
// then by title.  NULLS LAST keeps undated items at the end.
export const ORDER_BY =
  " ORDER BY COALESCE(NULLIF(array_to_string(itemYearPub, ','), ''), itemYearsCovered[1], '') ASC NULLS LAST, itemTitle ASC NULLS LAST";

/** inventory_en | inventory_fr — throws on anything else. */
export function tableFor(lang) {
  if (!LANGS.includes(lang)) throw new Error(`bad lang ${lang}`);
  return `inventory_${lang}`;
}

// ── Controlled-vocabulary facets ────────────────────────────────────────────
// The six dropdowns on the first tab.  `list: true` columns are VARCHAR[] in
// the database (an item can have several subjects); itemCensusName is a plain
// scalar column and is filtered with IN instead of the list functions.
export const FACETS = [
  { key: 'itemSubject',      list: true  },
  { key: 'itemCensusName',   list: false },
  { key: 'itemYearsCovered', list: true  },
  { key: 'itemYearPub',      list: true  },
  { key: 'itemGeoUnits',     list: true  },
  { key: 'itemType',         list: true  },
];

/**
 * Build the WHERE clause for the current facet selections.
 *
 * Fields are always ANDed together.  Within one field the AND/OR toggle
 * decides how *multiple selected values* combine:
 *   toggle off (AND) → list_has_all(col, [...])  item must contain every value
 *   toggle on  (OR)  → list_has_any(col, [...])  item must contain at least one
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
// Which columns a keyword is matched against.  Text columns get a plain LIKE;
// list columns are unnested so each element is tested separately.
const TEXT_COLS = ['itemTitle'];
const LIST_COLS = ['itemSubject', 'itemGeoCoverage', 'itemGeoUnits'];

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
 * Build the WHERE clause for the keyword tab.
 *
 * For each term one bracketed clause is produced:
 *   ( <deaccented lower title> LIKE '%term%'
 *     OR EXISTS (SELECT 1 FROM UNNEST(itemSubject)     _kw(v) WHERE <deaccented lower v> LIKE '%term%')
 *     OR EXISTS (... itemGeoCoverage ...)
 *     OR EXISTS (... itemGeoUnits ...) )
 * Terms are joined with AND (every term must appear somewhere) or, when the
 * toggle is on, wrapped in one OR group (any term is enough).
 *
 * The term is bound as a parameter and concatenated with the wildcards in
 * SQL ('%' || ? || '%'), so quotes in the term cannot break the statement.
 * Note: % and _ inside a term still act as LIKE wildcards, as in the R app.
 */
export function buildKwWhere(raw, isOr) {
  const text = (raw ?? '').trim();
  if (!text) return { sql: '', params: [] };
  const phrases = tokenise(text);
  if (!phrases.length) return { sql: '', params: [] };

  const params = [];
  const clauses = phrases.map((ph) => {
    const term = deaccentJs(ph);
    const tests = [];
    for (const col of TEXT_COLS) {
      tests.push(`${deaccentSql(`LOWER(COALESCE(${col}, ''))`)} LIKE '%' || ? || '%'`);
      params.push(term);
    }
    for (const col of LIST_COLS) {
      tests.push(`EXISTS (SELECT 1 FROM UNNEST(${col}) _kw(v) WHERE ${deaccentSql('LOWER(v)')} LIKE '%' || ? || '%')`);
      params.push(term);
    }
    return `(${tests.join(' OR ')})`;
  });

  const body = isOr ? `(${clauses.join(' OR ')})` : clauses.join(' AND ');
  return { sql: ' WHERE ' + body, params };
}
