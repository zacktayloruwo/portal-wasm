/**
 * visualize.js — "Visualize" tab (port of R/mod_visualize.R).
 *
 * Draws one bar chart: number of records per year for a chosen attribute
 * (e.g. Content type) and value within it (e.g. Census returns).  The numbers
 * do not come from the database: they are pre-aggregated by prep/prep_db.R
 * and written to data/viz_counts.json as
 *   { yearPub: { en: [[Year, attributeKey, value, Count], …], fr: […] },
 *     yearCov: { … } }
 * where yearPub counts by year of publication and yearCov by year covered.
 *
 * The chart is plain SVG drawn by barchart.js (no charting library), and
 * the JSON is only loaded the first time the tab is opened.  Two buttons
 * download the plotted figures (CSV) and the chart itself (PNG, 1920 × 720).
 */
import { el, csvCell, downloadBlob, escapeHtml } from './util.js';
import { getMeta, lang, tr, colLabel, fmtNumber } from './i18n.js';
import { barChartSvg, svgToPngBlob } from './barchart.js';

export function createVisualize({ panel }) {
  let counts = null;   // parsed viz_counts.json
  let spec = null;     // what the chart currently shows (see draw())
  let ready = null;    // promise for the one-time load
  const state = { attr: '', item: '', time: 'itemYearsCovered' };

  // ── DOM ──
  const attrSel = el('select', { id: 'viz-attr', class: 'form-control' });
  const itemSel = el('select', { id: 'viz-item', class: 'form-control', disabled: true });
  const radios = el('div', { class: 'portal-radio-group' });
  const dl = el('button', { type: 'button', class: 'btn portal-btn-primary portal-dl-btn', disabled: true });
  const dlPng = el('button', { type: 'button', class: 'btn portal-dl-btn', disabled: true });
  const plotEl = el('div', { class: 'portal-plot', id: 'viz-plot' });
  const tip = el('div', { class: 'portal-plot-tip', hidden: true, role: 'status' });

  const header = el('div', { class: 'portal-filters portal-viz-panel' }, [
    el('div', { class: 'portal-viz-grid' }, [
      el('p', { class: 'portal-intro', 'data-i18n': 'viz_top', 'data-i18n-html': '' }),
      el('div', { class: 'portal-viz-selectors' }, [
        el('div', { class: 'portal-vfield' }, [el('label', { class: 'portal-label', for: 'viz-attr', 'data-i18n': 'viz_attr' }), attrSel]),
        el('div', { class: 'portal-vfield' }, [el('label', { class: 'portal-label', for: 'viz-item', 'data-i18n': 'viz_item' }), itemSel]),
        el('div', { class: 'portal-vfield' }, [el('span', { class: 'portal-label', 'data-i18n': 'viz_time' }), radios]),
      ]),
      el('div', { class: 'portal-viz-download' }, [dl, dlPng]),
    ]),
  ]);
  panel.append(header, el('div', { class: 'portal-body' }, [el('div', { class: 'portal-plot-wrap' }, [plotEl, tip])]));

  // Options are ordered by their translated label, as sort(tr(...)) did in R.
  function sortedByLabel(keys) {
    return keys.map((k) => ({ key: k, label: colLabel(k) })).sort((a, b) => a.label.localeCompare(b.label, lang()));
  }

  // Attribute dropdown: the seven columns listed in meta.viz_attrs.
  function fillAttr() {
    attrSel.innerHTML = '';
    attrSel.appendChild(el('option', { value: '' }, ['']));
    for (const { key, label } of sortedByLabel(getMeta().viz_attrs)) {
      attrSel.appendChild(el('option', { value: key, selected: key === state.attr }, [label]));
    }
  }

  // Item dropdown: distinct values seen for that attribute (taken from the
  // yearPub table regardless of the time axis, as the R code did).
  function fillItems() {
    itemSel.innerHTML = '';
    itemSel.appendChild(el('option', { value: '' }, ['']));
    if (!state.attr || !counts) { itemSel.disabled = true; return; }
    const vals = [...new Set(counts.yearPub[lang()].filter((r) => r[1] === state.attr && r[2] != null).map((r) => r[2]))].sort();
    for (const v of vals) itemSel.appendChild(el('option', { value: v, selected: v === state.item }, [v]));
    itemSel.disabled = false;
  }

  // Time axis radios: year of publication vs year(s) covered (default).
  function fillRadios() {
    radios.innerHTML = '';
    for (const { key, label } of sortedByLabel(['itemYearPub', 'itemYearsCovered'])) {
      const id = `viz-time-${key}`;
      const r = el('input', { type: 'radio', name: 'viz-time', id, value: key, checked: key === state.time });
      r.addEventListener('change', () => { state.time = key; draw(); });
      radios.appendChild(el('label', { class: 'portal-radio', for: id }, [r, ' ', label]));
    }
  }

  function fillDownload() {
    // label_csv carries line-break markup for the old two-line button; flatten it.
    const text = tr('label_csv').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    dl.innerHTML = `<span aria-hidden="true">&#8595;</span> ${escapeHtml(text)}`;
    dlPng.innerHTML = `<span aria-hidden="true">&#8595;</span> ${escapeHtml(tr('download_chart'))}`;
  }

  // Rows for the current attribute/item/time selection, as objects.
  // A null year (undated items) is shown as "N/A", as in R.
  function plotRows() {
    if (!counts || !state.attr || !state.item) return [];
    const src = state.time === 'itemYearPub' ? counts.yearPub : counts.yearCov;
    return src[lang()].filter((r) => r[1] === state.attr && r[2] === state.item)
      .map((r) => ({ Year: r[0] ?? 'N/A', name: r[1], value: r[2], Count: r[3] }));
  }

  // Redraw (or clear) the chart for the current selection.  Years are strings
  // ("1870-71"); ggplot sorted them alphabetically, and so does this.
  function draw() {
    const rows = plotRows();
    dl.disabled = dlPng.disabled = !rows.length;
    tip.hidden = true;
    if (!rows.length) { spec = null; plotEl.innerHTML = ''; return; }
    const sorted = [...rows].sort((a, b) => (String(a.Year) < String(b.Year) ? -1 : String(a.Year) > String(b.Year) ? 1 : 0));
    spec = {
      title: `${colLabel(state.attr)} | ${state.item}`,
      xLabel: colLabel(state.time),
      yLabel: tr('viz_yaxis'),
      categories: sorted.map((r) => String(r.Year)),
      values: sorted.map((r) => r.Count),
      formatNumber: fmtNumber,
    };
    render();
  }

  // Draw spec at the container's current size.
  function render() {
    if (!spec || !plotEl.clientWidth) return;
    plotEl.innerHTML = barChartSvg({ ...spec, width: plotEl.clientWidth, height: plotEl.clientHeight });
  }
  new ResizeObserver(() => render()).observe(plotEl);

  // Hover a bar for "year: count".
  plotEl.addEventListener('mousemove', (e) => {
    const bar = e.target.closest('.portal-bar');
    if (!bar || !spec) { tip.hidden = true; return; }
    const i = Number(bar.dataset.i);
    tip.textContent = `${spec.categories[i]}: ${fmtNumber(spec.values[i])}`;
    const box = plotEl.getBoundingClientRect();
    tip.style.left = `${e.clientX - box.left + 12}px`;
    tip.style.top = `${e.clientY - box.top - 30}px`;
    tip.hidden = false;
  });
  plotEl.addEventListener('mouseleave', () => { tip.hidden = true; });

  // PNG of the chart at 1920 × 720, as Plotly's download button produced.
  async function downloadPng() {
    if (!spec) return;
    const blob = await svgToPngBlob(barChartSvg({ ...spec, width: 1920, height: 720 }), 1920, 720);
    const name = `${colLabel(state.attr)}_${state.item}`.replace(/[^A-Za-z0-9_-]/g, '_') + '.png';
    downloadBlob(blob, name, 'image/png');
  }

  // CSV of the plotted data with the same bilingual headers as the Shiny
  // downloadHandler.  A BOM is prepended so Excel reads the accents correctly.
  function downloadCsv() {
    const rows = plotRows();
    if (!rows.length) return;
    const attrLabel = colLabel(state.attr);
    const timeLabel = colLabel(state.time);
    const lines = [['Year', 'Attribute/Attribut', 'Item/Élément', 'Time/Temps', 'Count/Nombre']];
    for (const r of rows) lines.push([r.Year, attrLabel, r.value, timeLabel, r.Count]);
    const csv = lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
    const name = `${attrLabel}_${state.item}`.replace(/[^A-Za-z0-9_-]/g, '_') + '.csv';
    downloadBlob('﻿' + csv, name, 'text/csv;charset=utf-8');
  }

  attrSel.addEventListener('change', () => { state.attr = attrSel.value; state.item = ''; fillItems(); draw(); });
  itemSel.addEventListener('change', () => { state.item = itemSel.value; draw(); });
  dl.addEventListener('click', downloadCsv);
  dlPng.addEventListener('click', () => downloadPng().catch(console.error));

  /** Called by the router each time the tab is shown; loads the counts once. */
  async function activate() {
    if (!ready) {
      ready = (async () => {
        const res = await fetch(`${import.meta.env.BASE_URL}data/viz_counts.json`, { cache: 'no-cache' });
        counts = await res.json();
      })();
    }
    fillAttr(); fillRadios(); fillDownload();
    await ready;
    fillItems();
    draw();
  }

  document.addEventListener('langchange', () => {
    // Item values are language-specific, so start over (the Shiny
    // instructions text warned that language could not be changed mid-plot).
    state.attr = ''; state.item = '';
    fillAttr(); fillItems(); fillRadios(); fillDownload();
    draw();
  });

  return { activate };
}
