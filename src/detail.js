/**
 * detail.js — the "Selected Record" view opened by clicking a title.
 *
 * Replaces the results block with:
 *   [← Back to Results]
 *   Selected Record
 *   | Field label (tooltip) | value |   … one row per field
 *
 * Which fields, in which order, comes from meta.columns: every column flagged
 * visible_detail that has a popup definition (25 of them), in database order.
 * That reproduces the pivot_longer + left_join(popups) pipeline in mod_search.R.
 */
import { el, escapeHtml, escapeAttr, joinList } from './util.js';
import { accessLinksHtml } from './links.js';
import { getMeta, lang, tr } from './i18n.js';
import { initTippy } from './tooltips.js';

export function createDetailView({ container, onBack }) {
  const back = el('button', { class: 'btn portal-btn-primary portal-back-btn', type: 'button' });
  back.addEventListener('click', onBack);
  const title = el('h3', { 'data-i18n': 'title_details' });
  const host = el('div', { class: 'portal-detail-host' });
  const root = el('div', { class: 'portal-detail', hidden: true }, [back, title, host]);
  container.appendChild(root);

  let row = null; // the record currently shown (full row from SELECT * WHERE id = ?)

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
      // The label carries its definition in data-tippy-content; tooltips.js turns it into a popup.
      return `<tr><th scope="row" class="portal-detail-key"><span data-tippy-content="${escapeAttr(tip)}">${escapeHtml(label)}</span></th>` +
             `<td class="portal-detail-value${c.key === 'itemTitle' ? ' portal-detail-title' : ''}">${valueHtml(c)}</td></tr>`;
    }).join('') + '</tbody></table>';
    initTippy(host);
  }

  return {
    root,
    show(r) { row = r; render(); root.hidden = false; },
    hide() { row = null; host.innerHTML = ''; root.hidden = true; },
    /** Redraw labels/tooltips after a language change (the row itself is requeried by the caller). */
    relabel() { render(); },
    get visible() { return !root.hidden; },
    /** The id of the record shown (the same in both languages), or null. */
    get id() { return row?.id ?? null; },
  };
}
