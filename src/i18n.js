// Language state and translation lookup, fed by meta.json.

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
};

let meta = null;
let current = 'en';

function pickInitial() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'fr') return q;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'en' || s === 'fr') return s;
  } catch { /* storage unavailable */ }
  return 'en';
}

export function initI18n(m) {
  meta = m;
  current = pickInitial();
  document.documentElement.lang = current;
}

export const lang = () => current;
export const getMeta = () => meta;

export function tr(key) {
  const e = meta?.translation?.[key];
  if (e) return e[current] ?? e.en ?? key;
  const s = STATIC[key];
  if (s) return s[current] ?? s.en;
  return key;
}

// Localised header for a database column.
export function colLabel(key) {
  const c = meta?.columns?.find((x) => x.key === key);
  return c ? c[current] ?? c.en : key;
}

export function pageInfo(page, pages, total) {
  return current === 'fr'
    ? `Page ${page} de ${pages} (${total} résultats)`
    : `Page ${page} of ${pages} (${total} results)`;
}

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

export function setLang(l) {
  if (l !== 'en' && l !== 'fr') return;
  current = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  applyStatic();
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: l } }));
}
