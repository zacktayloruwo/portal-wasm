/**
 * links.js — rebuild the "Links" column.
 *
 * The Shiny database stored a pre-rendered HTML string (access_link) for every
 * row, which accounted for 8 MB of the 67 MB file.  The parquet export keeps
 * two parallel list columns instead — access_urls and access_labels — and this
 * function recreates the same markup on demand:
 *   <a href="…" class="accessbutton" target="_blank">domain</a><br/>…
 */
import { escapeAttr, escapeHtml, listToArray } from './util.js';

export function accessLinksHtml(urls, labels) {
  const u = listToArray(urls);
  const l = listToArray(labels);
  return u
    .map((href, i) => {
      let label = l[i];
      if (!label) {
        // Label missing for this URL: fall back to its hostname.
        try { label = new URL(href).hostname; } catch { label = href; }
      }
      return `<a href="${escapeAttr(href)}" class="accessbutton" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    })
    .join('<br/>');
}
