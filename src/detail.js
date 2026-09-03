import { el, escapeHtml, escapeAttr, joinList } from './util.js';
import { accessLinksHtml } from './links.js';
import { getMeta, lang, tr } from './i18n.js';
import { initTippy } from './tooltips.js';

// Detail view: back button, title, two-column key/value table where each key
// is a tippy tooltip span (was popups[[lang]] in the Shiny app).
export function createDetailView({ container, onBack }) {
  const back = el('button', { class: 'btn btn-default portal-btn-green portal-back-btn', type: 'button' });
  back.addEventListener('click', onBack);
  const title = el('h3', { 'data-i18n': 'title_details' });
  const host = el('div', { class: 'portal-detail-host' });
  const root = el('div', { class: 'portal-detail', hidden: true }, [back, title, host]);
  container.appendChild(root);

  let row = null;

  function valueHtml(c) {
    if (c.key === 'access_link') return accessLinksHtml(row.access_urls, row.access_labels);
    const v = c.list ? joinList(row[c.key]) : row[c.key];
    return escapeHtml(v ?? '');
  }

  function render() {
    back.textContent = `← ${tr('back_to_results')}`;
    if (!row) { host.innerHTML = ''; return; }
    const l = lang();
    const cols = getMeta().columns.filter((c) => c.visible_detail && c.popup);
    host.innerHTML = '<table class="portal-table portal-detail-table"><tbody>' + cols.map((c) => {
      const tip = c.popup[l] ?? c.popup.en ?? '';
      const label = c[l] ?? c.en;
      return `<tr><th scope="row" class="portal-detail-key"><span data-tippy-content="${escapeAttr(tip)}">${escapeHtml(label)}</span></th>` +
             `<td class="portal-detail-value">${valueHtml(c)}</td></tr>`;
    }).join('') + '</tbody></table>';
    initTippy(host);
  }

  return {
    root,
    show(r) { row = r; render(); root.hidden = false; },
    hide() { row = null; host.innerHTML = ''; root.hidden = true; },
    relabel() { render(); },
    get visible() { return !root.hidden; },
  };
}
