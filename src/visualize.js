import { el, csvCell, downloadBlob } from './util.js';
import { getMeta, lang, tr, colLabel } from './i18n.js';

// "Visualize" tab (port of mod_visualize.R): one bar chart of record counts
// by year for a chosen attribute/item, drawn from the pre-aggregated counts.
export function createVisualize({ panel }) {
  let Plotly = null;
  let counts = null;
  let ready = null;
  const state = { attr: '', item: '', time: 'itemYearsCovered' };

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

  function sortedByLabel(keys) {
    return keys.map((k) => ({ key: k, label: colLabel(k) })).sort((a, b) => a.label.localeCompare(b.label, lang()));
  }

  function fillAttr() {
    attrSel.innerHTML = '';
    attrSel.appendChild(el('option', { value: '' }, ['']));
    for (const { key, label } of sortedByLabel(getMeta().viz_attrs)) {
      attrSel.appendChild(el('option', { value: key, selected: key === state.attr }, [label]));
    }
  }

  function fillItems() {
    itemSel.innerHTML = '';
    itemSel.appendChild(el('option', { value: '' }, ['']));
    if (!state.attr || !counts) { itemSel.disabled = true; return; }
    const vals = [...new Set(counts.yearPub[lang()].filter((r) => r[1] === state.attr && r[2] != null).map((r) => r[2]))].sort();
    for (const v of vals) itemSel.appendChild(el('option', { value: v, selected: v === state.item }, [v]));
    itemSel.disabled = false;
  }

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

  function plotRows() {
    if (!counts || !state.attr || !state.item) return [];
    const src = state.time === 'itemYearPub' ? counts.yearPub : counts.yearCov;
    return src[lang()].filter((r) => r[1] === state.attr && r[2] === state.item)
      .map((r) => ({ Year: r[0] ?? 'N/A', name: r[1], value: r[2], Count: r[3] }));
  }

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

  async function activate() {
    if (!ready) {
      ready = (async () => {
        const [mod, res] = await Promise.all([
          import('plotly.js-basic-dist-min'),
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
    // Values are language-specific; start over (the Shiny app said as much).
    state.attr = ''; state.item = '';
    fillAttr(); fillItems(); fillRadios(); fillDownload();
    draw();
  });

  return { activate };
}
