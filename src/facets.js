import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.css';
import { el } from './util.js';

// One facet = label + Tom Select multi-select + AND/OR pill toggle,
// laid out like filter_row() in mod_search.R.
export function createFacet({ key, container, onChange }) {
  const selectId = `facet-${key}`;
  const toggleId = `toggle-${key}`;

  const label = el('label', { class: 'portal-label', for: `${selectId}-ts-control`, 'data-i18n-col': key });
  const select = el('select', { id: selectId, multiple: true });
  const toggle = el('input', { class: 's2-toggle', type: 'checkbox', role: 'switch', id: toggleId, 'aria-label': 'AND / OR' });

  const row = el('div', { class: 's2-filter-row' }, [
    el('div', { class: 's2-filter-input' }, [label, select]),
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
    plugins: ['remove_button'],
    maxOptions: null,
    hideSelected: true,
    closeAfterSelect: false,
    onChange: () => onChange(key),
  });
  toggle.addEventListener('change', () => onChange(key));

  return {
    key,
    getSelected: () => ts.getValue(),
    isOr: () => toggle.checked,
    setChoices(values) {
      ts.clearOptions();
      ts.addOptions(values.map((v) => ({ value: v, text: v })));
      ts.refreshOptions(false);
    },
    clear() {
      ts.clear(true);
      toggle.checked = false;
    },
    setDisabled(d) { if (d) ts.disable(); else ts.enable(); },
  };
}
