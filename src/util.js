/**
 * util.js — small helpers with no app-specific state.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text for insertion into HTML.  Applied to every database value the
 * app renders (titles such as "<25 Years by Age" would otherwise vanish into
 * the DOM as a tag).  Only the rebuilt link chips are inserted as raw HTML.
 */
export function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export const escapeAttr = escapeHtml;

/**
 * DuckDB-WASM returns LIST columns as Arrow vectors (not JS arrays).  Accept
 * whatever shape arrives — null, array, Arrow vector, iterable, scalar — and
 * return a plain array.
 */
export function listToArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v.toArray === 'function') return Array.from(v.toArray());
  if (typeof v[Symbol.iterator] === 'function') return Array.from(v);
  return [v];
}

/** Comma-join a list cell the way the Shiny app did: paste(x, collapse = ", "). */
export function joinList(v) {
  return listToArray(v).filter((x) => x != null).join(', ');
}

/**
 * Guard against out-of-order async results.  Each call to next() returns an
 * isCurrent() function that is true only until next() is called again, so a
 * slow query started before a newer one can detect that it is stale and skip
 * rendering.  This replaces Shiny's reactive invalidation.
 */
export function staleGuard() {
  let latest = 0;
  return {
    next() {
      const mine = ++latest;
      return () => mine === latest;
    },
  };
}

/** Trigger a client-side file download from a string (used for the CSV export). */
export function downloadBlob(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Quote a CSV field only when it needs it (comma, quote, or newline). */
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Tiny element builder: el('div', {class: 'x', onclick: fn}, [child, 'text']).
 * Attribute rules: `class` → className, `html` → innerHTML, `text` → textContent,
 * `on<event>` with a function → addEventListener, `true` → boolean attribute,
 * null/false → omitted.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}
