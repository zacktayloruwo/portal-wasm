/**
 * facets.js — one controlled-vocabulary filter: label + multi-select + AND/OR toggle.
 *
 * Reproduces filter_row() from R/mod_search.R.  The multi-select is Tom Select
 * (the successor of the selectize.js widget Shiny used); the toggle is the
 * same custom-styled checkbox (.s2-toggle) as before.
 *
 * When meta.json has a translation named help_<key> (rows in
 * prep/interface_elements.xlsx), an info glyph follows the field name and
 * shows that text on hover, focus or click.
 *
 * The widget does not know anything about SQL.  It reports changes through
 * onChange(key) and exposes getSelected()/isOr() for search_cv.js to read.
 */
import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.css';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { el } from './util.js';
import { tr, hasTr, colLabel } from './i18n.js';

// Circled "i", drawn in currentColor so it follows the label colour.
const INFO_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">' +
  '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<rect x="7.25" y="7" width="1.5" height="4.6" rx="0.75" fill="currentColor"/>' +
  '<circle cx="8" cy="4.7" r="1" fill="currentColor"/></svg>';

// Field name plus, when help text exists, the info glyph and its tooltip.
function labelWithHelp(key, label) {
  const row = el('div', { class: 'portal-label-row' }, [label]);
  const helpKey = `help_${key}`;
  if (!hasTr(helpKey)) return row;

  const info = el('button', { type: 'button', class: 'portal-info', html: INFO_ICON });
  row.appendChild(info);
  // Hover or keyboard focus shows it; a click keeps it open until the next
  // click elsewhere, which is also how it works on touch screens.
  const tip = tippy(info, {
    content: tr(helpKey),
    trigger: 'mouseenter focus click',
    placement: 'right',
    maxWidth: 320,
    theme: 'portal-light',
    appendTo: () => document.body,
  });
  const relabel = () => {
    tip.setContent(tr(helpKey));
    info.setAttribute('aria-label', `${colLabel(key)}, ${tr('more_info')}`);
  };
  relabel();
  document.addEventListener('langchange', relabel);
  return row;
}

export function createFacet({ key, container, onChange }) {
  const selectId = `facet-${key}`;
  const toggleId = `toggle-${key}`;

  // Tom Select creates its own text input with id "<selectId>-ts-control";
  // pointing the label at it keeps the widget accessible.
  const label = el('label', { class: 'portal-label', for: `${selectId}-ts-control`, 'data-i18n-col': key });
  const select = el('select', { id: selectId, multiple: true });
  const toggle = el('input', { class: 's2-toggle', type: 'checkbox', role: 'switch', id: toggleId, 'aria-label': 'AND / OR' });

  const row = el('div', { class: 's2-filter-row' }, [
    el('div', { class: 's2-filter-input' }, [labelWithHelp(key, label), select]),
    el('div', { class: 's2-toggle-wrap' }, [
      el('div', { class: 's2-toggle-labels' }, [
        el('span', { class: 's2-and-label', 'data-i18n': 'and' }),
        el('span', { class: 's2-or-label', 'data-i18n': 'or' }),
      ]),
      toggle,
    ]),
  ]);
  container.appendChild(row);

  const ts = new TomSelect(select, {
    plugins: ['remove_button'], // small × on each chip
    maxOptions: null,           // show every option (the largest facet has ~125)
    hideSelected: true,
    closeAfterSelect: false,    // keep the list open for multi-picking, like selectize
    onChange: () => onChange(key),
  });
  toggle.addEventListener('change', () => onChange(key));

  return {
    key,
    /** Currently selected values (array of strings). */
    getSelected: () => ts.getValue(),
    /** true = OR (checked, green), false = AND (unchecked, orange). */
    isOr: () => toggle.checked,
    /**
     * Replace the option list after a cascade query.  clearOptions() removes
     * only the *unselected* options, so current selections survive; the
     * cascade query always includes the selected values anyway because they
     * are part of the WHERE clause that produced the choices.
     */
    setChoices(values) {
      ts.clearOptions();
      ts.addOptions(values.map((v) => ({ value: v, text: v })));
      ts.refreshOptions(false);
    },
    /** Deselect everything silently (no onChange) and reset the toggle to AND. */
    clear() {
      ts.clear(true);
      toggle.checked = false;
    },
    setDisabled(d) { if (d) ts.disable(); else ts.enable(); },
  };
}
