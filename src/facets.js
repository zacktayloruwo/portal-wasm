/**
 * facets.js — one controlled-vocabulary filter, laid out as a single row:
 *
 *   Field name (i)   [ multi-select ..................... ]   [ AND | OR ]
 *
 * The multi-select is Tom Select (the successor of the selectize.js widget the
 * Shiny app used).  AND | OR replaces the old orange/green AND/OR switch:
 * AND (the default) keeps items matching every selected value, OR keeps
 * items matching at least one.
 *
 * When meta.json has a translation named help_<key> (rows in
 * prep/interface_elements.xlsx), an info glyph follows the field name and
 * shows that text on hover, focus or click.
 *
 * The widget does not know anything about SQL.  It reports changes through
 * onChange(key) and exposes getSelected()/isOr() for search_cv.js to read,
 * and restore() to put a selection back after a language switch.
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

/**
 * Two-button AND | OR control (ET | OU in French), shared with the keyword tab.
 * @param onChange  called when the user switches between AND and OR
 * @param label()   returns the group's accessible name (re-read on language change)
 */
export function createAllAny({ onChange, label }) {
  const all = el('button', { type: 'button', 'data-i18n': 'all', 'aria-pressed': 'true' });
  const any = el('button', { type: 'button', 'data-i18n': 'any', 'aria-pressed': 'false' });
  const group = el('div', { class: 'portal-allany', role: 'group' }, [all, any]);
  let isOr = false;
  const set = (v, notify) => {
    isOr = v;
    all.setAttribute('aria-pressed', String(!v));
    any.setAttribute('aria-pressed', String(v));
    if (notify) onChange();
  };
  all.addEventListener('click', () => { if (isOr) set(false, true); });
  any.addEventListener('click', () => { if (!isOr) set(true, true); });
  const relabel = () => group.setAttribute('aria-label', label());
  relabel();
  document.addEventListener('langchange', relabel);
  return {
    el: group,
    isOr: () => isOr,
    reset: () => set(false, false),
    /** Set AND (false) or OR (true) without onChange. */
    setOr: (v) => set(Boolean(v), false),
  };
}

// Field name plus, when help text exists, the info glyph and its tooltip.
function labelWithHelp(key, label) {
  const wrap = el('div', { class: 'portal-field-label' }, [label]);
  const helpKey = `help_${key}`;
  if (!hasTr(helpKey)) return wrap;

  const info = el('button', { type: 'button', class: 'portal-info', html: INFO_ICON });
  wrap.appendChild(info);
  // Hover or keyboard focus shows it; a click keeps it open until the next
  // click elsewhere, which is also how it works on touch screens.
  const tip = tippy(info, {
    content: tr(helpKey),
    trigger: 'mouseenter focus click',
    placement: 'top',
    maxWidth: 320,
    appendTo: () => document.body,
  });
  const relabel = () => {
    tip.setContent(tr(helpKey));
    info.setAttribute('aria-label', `${colLabel(key)}, ${tr('more_info')}`);
  };
  relabel();
  document.addEventListener('langchange', relabel);
  return wrap;
}

export function createFacet({ key, container, onChange }) {
  const selectId = `facet-${key}`;

  // Tom Select creates its own text input with id "<selectId>-ts-control";
  // pointing the label at it keeps the widget accessible.
  const label = el('label', { class: 'portal-label', for: `${selectId}-ts-control`, 'data-i18n-col': key });
  const select = el('select', { id: selectId, multiple: true });
  const mode = createAllAny({ onChange: () => onChange(key), label: () => tr('match_mode', { field: colLabel(key) }) });

  container.appendChild(el('div', { class: 'portal-field' }, [
    labelWithHelp(key, label),
    el('div', { class: 'portal-field-input' }, [select]),
    mode.el,
  ]));

  const ts = new TomSelect(select, {
    plugins: ['remove_button'], // small × on each chip
    maxOptions: null,           // show every option (the largest facet has ~125)
    hideSelected: true,
    closeAfterSelect: false,    // keep the list open for multi-picking, like selectize
    onChange: () => onChange(key),
  });

  return {
    key,
    /** Currently selected values (array of strings). */
    getSelected: () => ts.getValue(),
    /** true = OR (list_has_any), false = AND (list_has_all). */
    isOr: () => mode.isOr(),
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
    /** Deselect everything silently (no onChange) and reset to All. */
    clear() {
      ts.clear(true);
      mode.reset();
    },
    /**
     * Select these values and set AND | OR silently, replacing the current
     * selection (a language switch).  Values not yet among the options are
     * added; the next cascade query brings the rest.
     */
    restore(values, isOr) {
      ts.clear(true);
      ts.addOptions(values.map((v) => ({ value: v, text: v })));
      ts.setValue(values, true);
      mode.setOr(isOr);
    },
    setDisabled(d) { if (d) ts.disable(); else ts.enable(); },
  };
}
