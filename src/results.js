/**
 * results.js — the paged results block shared by both search tabs.
 *
 *   [ 23,351 records · sorted by first census year covered    Rows [25▾]  ‹ 1 of 935 › ]
 *   [ table (wide screens) or list of records (narrow screens)                         ]
 *   [                                                                     ‹ 1 of 935 › ]
 *
 * Searching, sorting and paging all happen in SQL (LIMIT/OFFSET); this module
 * only draws the current page.  Which columns appear comes from
 * meta.columns[].visible_results, set in prep/namestable.xlsx.
 *
 * Long list cells are summarised so one record cannot fill the screen:
 * years covered become a range ("1665-6 → 1870-71") with "+64 more" for the
 * years in between, and other lists show their first two values and "+19 more".  Those
 * buttons expand the cell in place.  Below 900 px wide the table becomes a
 * list of records, each with its title, one line of details and its subjects.
 */
import { el, escapeHtml, listToArray } from './util.js';
import { accessLinksHtml } from './links.js';
import { getMeta, tr, colLabel, fmtNumber } from './i18n.js';
import { PAGE_SIZES } from './sql.js';

const NARROW = window.matchMedia('(max-width: 900px)');

// Header text: the long years-covered name is shortened in the table only.
const headerLabel = (key) => (key === 'itemYearsCovered' ? tr('short_itemYearsCovered') : colLabel(key));

// ── summarised cells ────────────────────────────────────────────────────────
// An expandable cell holds a short form and the full form; .xp-btn swaps them.
function expandable(shortHtml, fullHtml, moreLabel, extraClass = '') {
  return `<span class="xp ${extraClass}" data-xp>` +
    `<span class="xp-short">${shortHtml} <button type="button" class="xp-btn" aria-expanded="false">${escapeHtml(moreLabel)}</button></span>` +
    `<span class="xp-full" hidden>${fullHtml} <button type="button" class="xp-btn" aria-expanded="true">${escapeHtml(tr('show_less'))}</button></span>` +
    `</span>`;
}

function yearsCell(v) {
  const a = listToArray(v).filter((x) => x != null);
  // Each year stays on one line ("1665-6" must not break at the hyphen).
  if (a.length <= 3) return a.map((y) => `<span class="yr">${escapeHtml(y)}</span>`).join(', ');
  // The range shows the first and last years; "+N more" counts the distinct years between.
  const hidden = new Set(a).size - new Set([a[0], a[a.length - 1]]).size;
  if (hidden <= 0) return escapeHtml([...new Set(a)].join(', '));
  return expandable(
    `<span class="yr-range">${escapeHtml(a[0])} → ${escapeHtml(a[a.length - 1])}</span>`,
    escapeHtml(a.join(', ')),
    tr('more_n', { n: hidden }),
    'xp-years',
  );
}

function listCell(v, keep = 2) {
  const a = listToArray(v).filter((x) => x != null);
  if (a.length <= keep + 1) return escapeHtml(a.join(', '));
  return expandable(escapeHtml(a.slice(0, keep).join(', ')), escapeHtml(a.join(', ')), tr('more_n', { n: a.length - keep }));
}

function tagsCell(v, keep = 5) {
  const a = listToArray(v).filter((x) => x != null);
  const tags = (xs) => xs.map((x) => `<span class="portal-tag">${escapeHtml(x)}</span>`).join('');
  if (a.length <= keep + 1) return tags(a);
  return expandable(tags(a.slice(0, keep)), tags(a), tr('more_n', { n: a.length - keep }));
}

// How many values a list cell shows before "+N more". Formats are short codes
// (CSV, PDF, ...), so up to five fit; longer names show two.
const KEEP = { itemFormat: 5 };

function valueHtml(c, row) {
  if (c.key === 'access_link') return accessLinksHtml(row.access_urls, row.access_labels, { group: true });
  if (c.key === 'itemTitle') return `<a href="#" class="portal-title-link">${escapeHtml(row.itemTitle ?? '')}</a>`;
  if (c.key === 'itemYearsCovered') return yearsCell(row[c.key]);
  if (c.list) return listCell(row[c.key], KEEP[c.key] ?? 2);
  return escapeHtml(row[c.key] ?? '');
}

// ── pager ───────────────────────────────────────────────────────────────────
function createPager(onPage, extraClass = '') {
  const prev = el('button', { type: 'button', class: 'portal-pg', html: '&#8249;' });
  const next = el('button', { type: 'button', class: 'portal-pg', html: '&#8250;' });
  const info = el('span', { class: 'portal-page-of' });
  prev.addEventListener('click', () => onPage(-1));
  next.addEventListener('click', () => onPage(+1));
  const root = el('div', { class: `portal-pages ${extraClass}` }, [prev, info, next]);
  return {
    root,
    update(page, pages) {
      info.textContent = tr('page_of', { page: fmtNumber(page), pages: fmtNumber(pages) });
      prev.disabled = page <= 1;
      next.disabled = page >= pages;
      prev.setAttribute('aria-label', tr('prev_page'));
      next.setAttribute('aria-label', tr('next_page'));
    },
  };
}

/**
 * @param container       element to append the block to
 * @param onOpen(row)     title clicked
 * @param onPage(±1)      previous / next page
 * @param onPageSize(n)   rows-per-page changed
 * @param pageSize        initial rows per page
 */
export function createResultsView({ container, onOpen, onPage, onPageSize, pageSize = 25 }) {
  // ── toolbar ──
  const count = el('p', { class: 'portal-count' });
  const sizeSelect = el('select', { class: 'portal-rows-select' },
    PAGE_SIZES.map((n) => el('option', { value: n, selected: n === pageSize }, [String(n)])));
  sizeSelect.addEventListener('change', () => onPageSize(Number(sizeSelect.value)));
  const topPager = createPager(onPage);
  const toolbar = el('div', { class: 'portal-toolbar' }, [
    count,
    el('div', { class: 'portal-pager' }, [
      el('label', { class: 'portal-rows' }, [el('span', { 'data-i18n': 'rows' }), sizeSelect]),
      topPager.root,
    ]),
  ]);

  // ── results + spinner overlay (shown via the .is-loading class) ──
  const host = el('div', { class: 'portal-table-host' });
  const wrapper = el('div', { class: 'portal-results-wrapper' }, [
    el('div', { class: 'portal-results-spinner-overlay' }, [el('div', { class: 'portal-spinner' })]),
    host,
  ]);
  const bottomPager = createPager(onPage, 'portal-pages-bottom');

  const root = el('div', { class: 'portal-results' }, [
    el('h2', { class: 'sr-only', 'data-i18n': 'title_results' }),
    toolbar, wrapper, bottomPager.root,
  ]);
  container.appendChild(root);

  let last = null; // most recent render() arguments, replayed by relabel()

  // One listener for the whole block: open a record, or expand/collapse a cell.
  host.addEventListener('click', (e) => {
    const xpBtn = e.target.closest('.xp-btn');
    if (xpBtn) {
      const xp = xpBtn.closest('[data-xp]');
      const open = xpBtn.getAttribute('aria-expanded') === 'false';
      xp.querySelector('.xp-short').hidden = open;
      xp.querySelector('.xp-full').hidden = !open;
      xp.querySelector(open ? '.xp-full .xp-btn' : '.xp-short .xp-btn').focus();
      return;
    }
    const a = e.target.closest('a.portal-title-link');
    if (a && last) {
      e.preventDefault();
      onOpen(last.rows[Number(a.closest('[data-idx]').dataset.idx)]);
    }
  });

  const columns = () => getMeta().columns.filter((c) => c.visible_results);

  function tableHtml(rows) {
    const cols = columns();
    const thead = `<thead><tr>${cols.map((c) =>
      `<th class="col-${c.key}"${c.key === 'itemYearsCovered' ? ` title="${escapeHtml(colLabel(c.key))}"` : ''}>${escapeHtml(headerLabel(c.key))}</th>`).join('')}</tr></thead>`;
    const tbody = rows.length
      ? rows.map((row, i) => `<tr data-idx="${i}">${cols.map((c) => `<td class="col-${c.key}">${valueHtml(c, row)}</td>`).join('')}</tr>`).join('')
      : `<tr><td class="portal-no-data" colspan="${cols.length}">${escapeHtml(tr('no_entries'))}</td></tr>`;
    return `<table class="portal-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  function listHtml(rows) {
    if (!rows.length) return `<p class="portal-no-data">${escapeHtml(tr('no_entries'))}</p>`;
    const meta = columns().filter((c) => !['itemTitle', 'itemSubject', 'access_link'].includes(c.key));
    return `<div class="portal-list">${rows.map((row, i) => {
      const details = meta.map((c) => {
        const v = c.key === 'itemYearsCovered' ? yearsCell(row[c.key]) : c.list ? listCell(row[c.key], KEEP[c.key] ?? 2) : escapeHtml(row[c.key] ?? '');
        return v ? `<span><i>${escapeHtml(headerLabel(c.key))}</i> ${v}</span>` : '';
      }).join('');
      return `<article class="portal-rec" data-idx="${i}">` +
        `<h3 class="portal-rec-title"><a href="#" class="portal-title-link">${escapeHtml(row.itemTitle ?? '')}</a></h3>` +
        `<div class="portal-rec-links">${accessLinksHtml(row.access_urls, row.access_labels, { group: true })}</div>` +
        `<p class="portal-rec-meta">${details}</p>` +
        `<p class="portal-rec-tags">${tagsCell(row.itemSubject)}</p>` +
        `</article>`;
    }).join('')}</div>`;
  }

  /** Draw one page.  rows = current page only; total = full match count. */
  function render({ rows, total, page, pageSize: size }) {
    last = { rows, total, page, pageSize: size };
    host.innerHTML = NARROW.matches ? listHtml(rows) : tableHtml(rows);
    const pages = Math.max(1, Math.ceil(total / size));
    count.innerHTML = `<b>${fmtNumber(total)}</b> ${escapeHtml(tr(total === 1 ? 'record' : 'records'))}` +
      `<span class="portal-count-sep" aria-hidden="true">·</span>${escapeHtml(tr('sorted_note'))}`;
    topPager.update(page, pages);
    bottomPager.update(page, pages);
    bottomPager.root.hidden = pages <= 1;
    sizeSelect.value = String(size);
    sizeSelect.setAttribute('aria-label', tr('rows'));
  }

  // Switch between table and list when the window crosses 900 px.
  NARROW.addEventListener('change', () => { if (last) render(last); });

  return {
    root,
    render,
    setLoading(on) { wrapper.classList.toggle('is-loading', on); },
    /** Re-render the last page in the current language (headers, counts). */
    relabel() { if (last) render(last); },
    show(v) { root.hidden = !v; },
  };
}
