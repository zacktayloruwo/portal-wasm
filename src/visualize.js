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
 * Plotly (≈380 KB gzipped) and the JSON are only loaded the first time the
 * tab is opened.
 */
import { el, csvCell, downloadBlob } from './util.js';
import { getMeta, lang, tr, colLabel } from './i18n.js';

export function createVisualize({ panel }) {
  let Plotly = null;   // set after the lazy import
  let counts = null;   // parsed viz_counts.json
  let ready = null;    // promise for the one-time load
  const state = { attr: '', item: '', time: 'itemYearsCovered' };

  // ── DOM ──
  const attrSel = el('select', { id: 'viz-attr', class: 'form-control' });
  const itemSel = el('select', { id: 'viz-item', class: 'form-control', disabled: true });
  const radios = el('div', { class: 'portal-radio-group' });
  const dl = el('button', { type: 'button', class: 'btn portal-btn-green portal-dl-btn', disabled: true });
  const plotEl = el('div', { class: 'portal-plot', id: 'viz-plot' });

  const header = el('div', { class: 'portal-filter-header portal-filter-header-viz' }, [
    el('div', { class: 'portal-col-4' }, [el('div', { class: 'portal-instructions portal-instructions-sm', 'data-i18n': 'viz_top', 'data-i18n-html': '' })]),
    el('div', { class: 'portal-col-6 portal-viz-selectors' }, [
      el('div', { class: 'portal-field' }, [el('label', { class: 'portal-label', for: 'viz-attr', 'data-i18n': 'viz_attr' }), attrSel]),
      el('div', { class: 'portal-field' }, [el('label', { class: 'portal-label', for: 'viz-item', 'data-i18n': 'viz_item' }), itemSel]),
      el('div', { class: 'portal-field' }, [el('span', { class: 'portal-label', 'data-i18n': 'viz_time' }), radios]),
    ]),
    el('div', { class: 'portal-col-2 portal-viz-download' }, [dl]),
  ]);
  panel.append(header, el('div', { class: 'portal-body' }, [plotEl]));

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
    dl.innerHTML = `<span>${tr('label_csv')}</span><span class="portal-dl-arrow" aria-hidden="true">&#8595;</span>`;
  }

  // Rows for the current attribute/item/time selection, as objects.
  // A null year (undated items) is shown as "N/A", as in R.
  function plotRows() {
    if (!counts || !state.attr || !state.item) return [];
    const src = state.time === 'itemYearPub' ? counts.yearPub : counts.yearCov;
    return src[lang()].filter((r) => r[1] === state.attr && r[2] === state.item)
      .map((r) => ({ Year: r[0] ?? 'N/A', name: r[1], value: r[2], Count: r[3] }));
  }

  // Redraw (or clear) the chart.  Styling follows the ggplot theme_bw() look
  // of the original: portal-blue bars, bold blue title "Attribute | Item",
  // vertical year labels, boxed axes.  The mode bar is trimmed to the PNG
  // download button, at the same 1920×720 size.
  function draw() {
    const rows = plotRows();
    dl.disabled = !rows.length;
    if (!Plotly) return;
    if (!rows.length) { Plotly.purge(plotEl); return; }
    const attrLabel = colLabel(state.attr);
    Plotly.react(plotEl, [{
      type: 'bar',
      x: rows.map((r) => r.Year),
      y: rows.map((r) => r.Count),
      marker: { color: '#0b5394' },
      hovertemplate: '%{x}: %{y}<extra></extra>',
    }], {
      title: { text: `<b>${attrLabel} | ${state.item}</b>`, font: { family: 'Arial', size: 18, color: '#0b5394' }, x: 0.02 },
      // Years are strings ("1870-71"); ggplot sorted them alphabetically, hence category ascending.
      xaxis: { title: { text: colLabel(state.time) }, type: 'category', categoryorder: 'category ascending', tickangle: -90, showline: true, mirror: true, linecolor: '#333', gridcolor: '#e5e5e5' },
      yaxis: { title: { text: tr('viz_yaxis') }, showline: true, mirror: true, linecolor: '#333', gridcolor: '#e5e5e5' },
      font: { family: 'Arial', size: 13 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      showlegend: false,
      margin: { t: 60, b: 120, l: 70, r: 20 },
      autosize: true,
    }, {
      responsive: true,
      displaylogo: false,
      displayModeBar: true,
      modeBarButtonsToRemove: ['zoomIn2d', 'zoomOut2d', 'select2d', 'pan2d', 'lasso2d',
        'hoverClosestCartesian', 'hoverCompareCartesian', 'autoScale2d', 'resetScale2d', 'zoom2d'],
      toImageButtonOptions: { format: 'png', width: 1920, height: 720, filename: attrLabel },
    });
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

  /** Called by the router each time the tab is shown; loads Plotly + data once. */
  async function activate() {
    if (!ready) {
      ready = (async () => {
        const [mod, res] = await Promise.all([
          import('plotly.js-basic-dist-min'), // separate chunk, fetched on demand
          fetch(`${import.meta.env.BASE_URL}data/viz_counts.json`, { cache: 'no-cache' }),
        ]);
        Plotly = mod.default ?? mod;
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
