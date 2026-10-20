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
 */

const STORAGE_KEY = 'portal-lang';
const STATIC = {
  and: { en: 'AND', fr: 'ET' },
  or: { en: 'OR', fr: 'OU' },
  no_entries: { en: 'No entries found', fr: 'Aucune entrée trouvée' },
  prev: { en: '❮ Previous', fr: '❮ Précédent' },
  next: { en: 'Next ❯', fr: 'Suivant ❯' },
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
// localStorage, then English.
function pickInitial() {
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
  current = pickInitial();
  document.documentElement.lang = current;
}

export const lang = () => current;
export const getMeta = () => meta;

/** Translate an interface string; falls back to English, then to the key itself. */
export function tr(key) {
  const e = meta?.translation?.[key];
  if (e) return e[current] ?? e.en ?? key;
  const s = STATIC[key];
  if (s) return s[current] ?? s.en;
  return key;
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

/** "Page 1 of 12 (57 results)" — wording copied from mod_search.R. */
export function pageInfo(page, pages, total) {
  return current === 'fr'
    ? `Page ${page} de ${pages} (${total} résultats)`
    : `Page ${page} of ${pages} (${total} results)`;
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
