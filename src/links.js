import { escapeAttr, escapeHtml, listToArray } from './util.js';

// Rebuilds the access_link chips the Shiny app stored as pre-rendered HTML:
//   <a href="..." class="accessbutton" target="_blank">domain</a><br/>...
export function accessLinksHtml(urls, labels) {
  const u = listToArray(urls);
  const l = listToArray(labels);
  return u
    .map((href, i) => {
      let label = l[i];
      if (!label) {
        try { label = new URL(href).hostname; } catch { label = href; }
      }
      return `<a href="${escapeAttr(href)}" class="accessbutton" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    })
    .join('<br/>');
}
