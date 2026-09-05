/**
 * tooltips.js — tippy.js tooltips for the detail-view field labels.
 *
 * Each label is <span data-tippy-content="…">Label</span>; the content is the
 * field definition from the R app's `columnnames$popup_en/popup_fr`.  Same
 * options as the JavaScript that mod_search.R injected: shown to the right,
 * HTML allowed, appended to <body> so table overflow does not clip it.
 */
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

export function initTippy(root = document) {
  const nodes = root.querySelectorAll('[data-tippy-content]');
  // The detail table is re-rendered on every open; destroy stale instances first.
  nodes.forEach((n) => { if (n._tippy) n._tippy.destroy(); });
  tippy(nodes, {
    placement: 'right',
    allowHTML: true,
    appendTo: () => document.body,
    maxWidth: 350,
  });
}
