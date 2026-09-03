// Small shared helpers.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export const escapeAttr = escapeHtml;

// DuckDB-WASM returns LIST columns as Arrow vectors; normalise to a JS array.
export function listToArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v.toArray === 'function') return Array.from(v.toArray());
  if (typeof v[Symbol.iterator] === 'function') return Array.from(v);
  return [v];
}

// Comma-join a list cell the way the Shiny app did (paste(x, collapse = ", ")).
export function joinList(v) {
  return listToArray(v).filter((x) => x != null).join(', ');
}

// Returns a function that hands out tokens; only the most recent token is current.
export function staleGuard() {
  let latest = 0;
  return {
    next() {
      const mine = ++latest;
      return () => mine === latest;
    },
  };
}

export function downloadBlob(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
