/**
 * i18n.js — language state and translation lookup.
 *
 * Translations live in data/meta.json (exported from the R app's `translation`
 * list and `columnnames` table).  A handful of strings that were hard-coded in
 * the Shiny UI (AND/OR, pagination labels, error text) live in STATIC below.
 *
 * Two ways to translate:
 *   - tr(key) / colLabel(key) for text built in JavaScript;
 *   - data-i18n="key" (or data-i18n-col="column") attributes on static HTML,
 *     refreshed by applyStatic() whenever the language changes.
 * A 'langchange' CustomEvent on document lets the tab modules re-query.
 * Strings may carry {name} placeholders, filled by tr(key, { name: value }).
 */

const STORAGE_KEY = 'portal-lang';
const STATIC = {
  // All / Any control (was the AND / OR switch)
  all: { en: 'All', fr: 'Tous' },
  any: { en: 'Any', fr: 'Au moins un' },
  match_mode: { en: '{field}: match all or any selected values', fr: '{field} : toutes les valeurs choisies ou au moins une' },
  // results toolbar and pager
  record: { en: 'record', fr: 'enregistrement' },
  records: { en: 'records', fr: 'enregistrements' },
  sorted_note: { en: 'sorted by first census year covered', fr: 'triés par première année de recensement couverte' },
  rows: { en: 'Rows', fr: 'Lignes' },
  page_of: { en: '{page} of {pages}', fr: '{page} de {pages}' },
  prev_page: { en: 'Previous page', fr: 'Page précédente' },
  next_page: { en: 'Next page', fr: 'Page suivante' },
  no_entries: { en: 'No entries found', fr: 'Aucune entrée trouvée' },
  // summarised list cells
  more_n: { en: '+{n} more', fr: '+{n} autres' },
  show_less: { en: 'Show less', fr: 'Moins' },
  short_itemYearsCovered: { en: 'Years Covered', fr: 'Années couvertes' },
  link_n: { en: 'Link {n}', fr: 'Lien {n}' },
  // keyword box
  keywords: { en: 'Keywords', fr: 'Mots-clés' },
  download_chart: { en: 'Download the chart', fr: 'Télécharger le graphique' },
  search_btn: { en: 'Search', fr: 'Rechercher' },
  loading: { en: 'Loading', fr: 'Chargement' },
  unavailable: {
    en: 'Content temporarily unavailable. Please check your internet connection.',
    fr: 'Contenu temporairement indisponible. Veuillez vérifier votre connexion Internet.',
  },
  contents: { en: 'Contents', fr: 'Table des matières' },
  more_info: { en: 'more information', fr: 'plus d’information' },
};

let meta = null;
let current = 'en';

// Initial language: ?lang=fr in the URL wins, then the last choice saved in
// localStorage, then English.  Exported so main.js can start the right data
// download before meta.json has arrived.
export function detectLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'fr') return q;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'en' || s === 'fr') return s;
  } catch { /* storage unavailable (private mode etc.) */ }
  return 'en';
}

export function initI18n(m) {
  meta = m;
  current = detectLang();
  document.documentElement.lang = current;
}

export const lang = () => current;
export const getMeta = () => meta;

/** Translate an interface string; falls back to English, then to the key itself. */
export function tr(key, vars) {
  const e = meta?.translation?.[key];
  let text = e ? (e[current] ?? e.en ?? key) : STATIC[key] ? (STATIC[key][current] ?? STATIC[key].en) : key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return text;
}

/** A number in the current language's style: 23,351 in English, 23 351 in French. */
export function fmtNumber(n) {
  return Number(n).toLocaleString(current === 'fr' ? 'fr-CA' : 'en-CA');
}

/** True when meta.json carries a translation for this key (e.g. optional help text). */
export function hasTr(key) {
  return Boolean(meta?.translation?.[key]);
}

/** Localised header for a database column (e.g. itemSubject → "Subject" / "Sujet"). */
export function colLabel(key) {
  const c = meta?.columns?.find((x) => x.key === key);
  return c ? c[current] ?? c.en : key;
}

/**
 * Re-translate every annotated node under root.
 *   data-i18n="key"          → textContent (or innerHTML if data-i18n-html is present,
 *                              for strings that contain markup such as <i>)
 *   data-i18n-col="column"   → column header text
 */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((n) => {
    const text = tr(n.dataset.i18n);
    if ('i18nHtml' in n.dataset) n.innerHTML = text;
    else n.textContent = text;
  });
  root.querySelectorAll('[data-i18n-col]').forEach((n) => {
    n.textContent = colLabel(n.dataset.i18nCol);
  });
}

/** Switch language, persist it, refresh static text, and notify the modules. */
export function setLang(l) {
  if (l !== 'en' && l !== 'fr') return;
  current = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  applyStatic();
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: l } }));
}
