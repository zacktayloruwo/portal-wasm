/**
 * links.js — the "Links" chips.
 *
 * The Shiny database stored a pre-rendered HTML string (access_link) for every
 * row, which accounted for 8 MB of the 67 MB file.  The parquet export keeps
 * two parallel list columns instead — access_urls and access_labels — and this
 * module builds the chips on demand, side by side:
 *   <a href="…" class="accessbutton" target="_blank">domain</a> …
 *
 * With { group: true } (the results table), several links to the same site
 * become one chip with a count, a <details> element that opens to list them.
 */
import { escapeAttr, escapeHtml, listToArray } from './util.js';
import { tr } from './i18n.js';

const chip = (href, text) =>
  `<a href="${escapeAttr(href)}" class="accessbutton" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;

// Inner HTML of a chip for a site with n links (n > 1 adds the count), as
// drawn below; results.js renders these off-screen to find the widest chip.
export const chipLabelHtml = (label, n = 1) =>
  (n > 1 ? `${escapeHtml(label)} <b>×${n}</b>` : escapeHtml(label));

export function accessLinksHtml(urls, labels, { group = false } = {}) {
  const l = listToArray(labels);
  const items = listToArray(urls).map((href, i) => {
    let label = l[i];
    if (!label) {
      // Label missing for this URL: fall back to its hostname.
      try { label = new URL(href).hostname; } catch { label = href; }
    }
    return { href, label };
  });
  if (!group) return items.map((it) => chip(it.href, it.label)).join('');

  // Group by site, keeping the order in which sites first appear.
  const bySite = new Map();
  for (const it of items) {
    if (!bySite.has(it.label)) bySite.set(it.label, []);
    bySite.get(it.label).push(it);
  }
  return [...bySite].map(([label, list]) => (list.length === 1
    ? chip(list[0].href, label)
    : `<details class="link-group"><summary class="accessbutton">${chipLabelHtml(label, list.length)}</summary>` +
      `<span class="link-group-items">${list.map((it, i) => chip(it.href, tr('link_n', { n: i + 1 }))).join('')}</span></details>`
  )).join('');
}
