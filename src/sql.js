// SQL builders. Every user value is passed as a prepared-statement parameter;
// column and table names come from fixed allow-lists only.

export const LANGS = ['en', 'fr'];
export const PAGE_SIZES = [5, 10, 15, 25, 50, 100];

export const ORDER_BY =
  " ORDER BY COALESCE(NULLIF(array_to_string(itemYearPub, ','), ''), itemYearsCovered[1], '') ASC NULLS LAST, itemTitle ASC NULLS LAST";

export function tableFor(lang) {
  if (!LANGS.includes(lang)) throw new Error(`bad lang ${lang}`);
  return `inventory_${lang}`;
}

// ── Controlled-vocabulary facets ────────────────────────────────────────────
// Fields are always ANDed together.  Within a field, the toggle chooses
// list_has_all (AND, unchecked) vs list_has_any (OR, checked); a single value
// always uses list_has_any.  Census name is a scalar column and uses IN.
export const FACETS = [
  { key: 'itemSubject',      list: true  },
  { key: 'itemCensusName',   list: false },
  { key: 'itemYearsCovered', list: true  },
  { key: 'itemYearPub',      list: true  },
  { key: 'itemGeoUnits',     list: true  },
  { key: 'itemType',         list: true  },
];

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
const TEXT_COLS = ['itemTitle'];
const LIST_COLS = ['itemSubject', 'itemGeoCoverage', 'itemGeoUnits'];

const ACCENT_PAIRS = [
  ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'],
  ['à', 'a'], ['â', 'a'], ['ä', 'a'],
  ['ù', 'u'], ['û', 'u'], ['ü', 'u'],
  ['î', 'i'], ['ï', 'i'],
  ['ô', 'o'], ['ö', 'o'],
  ['ç', 'c'],
  ['œ', 'oe'], ['æ', 'ae'],
];

// Same mapping as deaccent_r() in mod_search_kw.R
export function deaccentJs(s) {
  let out = s.toLowerCase();
  for (const [from, to] of ACCENT_PAIRS) out = out.split(from).join(to);
  return out;
}

// Same nested replace() chain as deaccent_sql() in mod_search_kw.R
export function deaccentSql(expr) {
  return ACCENT_PAIRS.reduce((acc, [from, to]) => `replace(${acc}, '${from}', '${to}')`, expr);
}

// Two-pass tokeniser: quoted phrases first, then split the rest on
// whitespace and commas.  Mirrors mod_search_kw.R lines 199-218.
const QUOTE_RX = /["'«»‹›]([^"'«»‹›]*)["'«»‹›]/g;

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
