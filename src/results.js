/**
 * results.js — the paged results block shared by both search tabs.
 *
 * Layout (same as the Shiny app):
 *   [ Search Results                       Show [5▾] rows ]
 *   [ striped table; Title is a link that opens the detail view ]
 *   [ ❮ Previous   Page 1 of 12 (57 results)   Next ❯ ]
 *
 * The table is plain HTML.  Searching, sorting and paging all happen in SQL
 * (LIMIT/OFFSET), exactly as before — reactable was only ever a renderer.
 * Which columns appear comes from meta.columns[].visible_results, set in the
 * visible_results column of prep/namestable.xlsx.
 */
import { el, escapeHtml, joinList } from './util.js';
import { accessLinksHtml } from './links.js';
import { getMeta, tr, colLabel, pageInfo } from './i18n.js';
import { PAGE_SIZES } from './sql.js';

/**
 * @param container   element to append the block to
 * @param onOpen(row)     title clicked
 * @param onPage(±1)      Previous / Next clicked
 * @param onPageSize(n)   rows-per-page changed
 */
export function createResultsView({ container, onOpen, onPage, onPageSize }) {
  // ── Header row: title + "Show n rows" pill ──
  const title = el('h3', { 'data-i18n': 'title_results' });
  const sizeSelect = el('select', { class: 'portal-page-size-select', 'aria-label': 'rows per page' },
    PAGE_SIZES.map((n) => el('option', { value: n, selected: n === 5 }, [String(n)])));
  sizeSelect.addEventListener('change', () => onPageSize(Number(sizeSelect.value)));

  const header = el('div', { class: 'portal-results-header' }, [
    title,
    el('div', { class: 'portal-page-size' }, [
      el('span', { class: 'portal-rows-before', 'data-i18n': 'show_rows_before' }),
      sizeSelect,
      el('span', { class: 'portal-rows-after', 'data-i18n': 'show_rows_after' }),
    ]),
  ]);

  // ── Table + spinner overlay (shown via the .is-loading class) ──
  const tableHost = el('div', { class: 'portal-table-host' });
  const wrapper = el('div', { class: 'portal-results-wrapper' }, [
    el('div', { class: 'portal-results-spinner-overlay' }, [el('div', { class: 'portal-spinner' })]),
    tableHost,
  ]);

  // ── Pagination ──
  const prev = el('button', { class: 'btn btn-default btn-sm', type: 'button', 'data-i18n': 'prev' });
  const next = el('button', { class: 'btn btn-default btn-sm', type: 'button', 'data-i18n': 'next' });
  const info = el('span', { class: 'portal-page-info' });
  const pager = el('div', { class: 'portal-pagination' }, [prev, info, next]);
  prev.addEventListener('click', () => onPage(-1));
  next.addEventListener('click', () => onPage(+1));

  const root = el('div', { class: 'portal-results' }, [header, wrapper, pager]);
  container.appendChild(root);

  let last = null; // most recent render() arguments, replayed by relabel()

  function columns() {
    return getMeta().columns.filter((c) => c.visible_results);
  }

  // One cell.  Everything is escaped except the link chips, which are built
  // from URL/label lists by links.js.
  function cellHtml(c, row) {
    if (c.key === 'access_link') return accessLinksHtml(row.access_urls, row.access_labels);
    if (c.key === 'itemTitle') {
      return `<a href="#" class="portal-title-link">${escapeHtml(row.itemTitle)}</a>`;
    }
    return escapeHtml(c.list ? joinList(row[c.key]) : row[c.key]);
  }

  /** Draw one page.  rows = current page only; total = full match count. */
  function render({ rows, total, page, pageSize }) {
    last = { rows, total, page, pageSize };
    const cols = columns();
    // Per-column classes (col-itemTitle etc.) carry the width hints in base.css.
    const thead = `<thead><tr>${cols.map((c) => `<th class="col-${c.key}">${escapeHtml(colLabel(c.key))}</th>`).join('')}</tr></thead>`;
    let tbody;
    if (!rows.length) {
      tbody = `<tbody><tr><td class="portal-no-data" colspan="${cols.length}">${escapeHtml(tr('no_entries'))}</td></tr></tbody>`;
    } else {
      tbody = '<tbody>' + rows.map((row, i) =>
        `<tr data-idx="${i}">${cols.map((c) => `<td class="col-${c.key}">${cellHtml(c, row)}</td>`).join('')}</tr>`
      ).join('') + '</tbody>';
    }
    tableHost.innerHTML = `<table class="portal-table">${thead}${tbody}</table>`;
    // Title links: look the row up by its index on this page and hand it back.
    tableHost.querySelectorAll('a.portal-title-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = Number(a.closest('tr').dataset.idx);
        onOpen(rows[idx]);
      });
    });

    const pages = Math.max(1, Math.ceil(total / pageSize));
    info.textContent = pageInfo(page, pages, total);
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    sizeSelect.value = String(pageSize);
  }

  return {
    root,
    render,
    setLoading(on) { wrapper.classList.toggle('is-loading', on); },
    /** Re-render the last page in the current language (headers, page info). */
    relabel() { if (last) render(last); },
    show(v) { root.hidden = !v; },
  };
}
