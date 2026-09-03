import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

// Mirrors the JS injected by mod_search.R: destroy stale instances, then
// initialise every [data-tippy-content] under root.
export function initTippy(root = document) {
  const nodes = root.querySelectorAll('[data-tippy-content]');
  nodes.forEach((n) => { if (n._tippy) n._tippy.destroy(); });
  tippy(nodes, {
    placement: 'right',
    allowHTML: true,
    appendTo: () => document.body,
    maxWidth: 350,
  });
}
