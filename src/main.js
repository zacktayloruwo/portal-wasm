/**
 * main.js — application entry point.
 *
 * Boot sequence (all in the browser, no server):
 *   1. fetch data/meta.json            → translations, column metadata, version strings
 *   2. initialise i18n + build the five tab panels (they create their own DOM)
 *   3. start DuckDB-WASM in a Web Worker and load the current language's parquet
 *   4. run the first controlled-vocabulary query so the page has content
 *   5. hide the full-page overlay and start the hash router
 *
 * This file also owns the two pieces of state that span tabs: the EN/FR
 * switch and the "switching between search tabs resets the other one" rule
 * that the Shiny app implemented in app_server.R.
 */
import './styles/base.css';
import './styles/portal.css';
import { initI18n, applyStatic, setLang, lang, tr } from './i18n.js';
import { initRouter } from './router.js';
import { initDb, ensureTable, query } from './db.js';
import { createCvSearch } from './search_cv.js';
import { createKwSearch } from './search_kw.js';
import { createVisualize } from './visualize.js';
import { createMarkdownPage } from './markdown.js';

// Full-page overlay shown while the engine and data load (and again while the
// other language's parquet downloads after a toggle).
const overlay = document.getElementById('app-loading-overlay');
const status = document.getElementById('app-loading-status');

function setStatus(msg) { if (status) status.textContent = msg; }
function fmtMb(b) { return (b / 1e6).toFixed(1); }

// Byte-progress callback for db.ensureTable(): "Loading data 0.4 / 1.3 MB".
// Some servers omit Content-Length (compressed responses), so total may be 0.
function progress(label) {
  return (received, total) => setStatus(total ? `${label} ${fmtMb(received)} / ${fmtMb(total)} MB` : `${label} ${fmtMb(received)} MB`);
}

function showOverlay(on) {
  overlay.classList.toggle('is-hidden', !on);
}

// Download + register one language's inventory table (no-op if already loaded).
async function loadLang(l) {
  await ensureTable(l, progress(lang() === 'fr' ? 'Chargement des données' : 'Loading data'));
}

/**
 * Optional self-test, enabled by adding ?selftest to the URL.
 * data/selftest.json is written by dev/verify_web_export.R in the R project and
 * holds SQL + parameters + the counts/ids that R's DuckDB returned.  Running
 * the same statements through DuckDB-WASM proves the two engines agree on the
 * exported parquet.  Results go to console.table() and window.__selftest.
 */
async function selftest() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/selftest.json`, { cache: 'no-cache' });
  if (!res.ok) { console.warn('selftest.json missing'); return; }
  const cases = await res.json();
  const out = [];
  for (const c of cases) {
    if (c.lang && c.lang !== lang()) await ensureTable(c.lang); // FR fixtures need the FR table
    const [{ n }] = await query(c.count_sql, c.params ?? []);
    const ids = (await query(c.ids_sql, c.params ?? [])).map((r) => r.id);
    const idsOk = JSON.stringify(ids) === JSON.stringify(c.first_ids);
    out.push({ label: c.label, expected: c.expected_count, actual: Number(n), count_ok: Number(n) === c.expected_count, ids_ok: idsOk });
  }
  console.table(out);
  const failed = out.filter((r) => !r.count_ok || !r.ids_ok).length;
  console.log(`selftest: ${out.length - failed}/${out.length} passed`);
  window.__selftest = out;
}

async function boot() {
  // 1. Metadata first: everything else needs translations and column info.
  const meta = await (await fetch(`${import.meta.env.BASE_URL}data/meta.json`, { cache: 'no-cache' })).json();
  initI18n(meta);

  // Footer strings come from R/utils_global.R via meta.json.
  document.getElementById('footer-version').textContent = meta.version;
  document.getElementById('footer-db-date').textContent = meta.db_date;
  document.getElementById('footer-app-date').textContent = meta.app_date;

  // The EN/FR switch: unchecked = English, checked = French (same as Shiny).
  const langToggle = document.getElementById('language');
  langToggle.checked = lang() === 'fr';

  // 2. Build the tab panels.  Each factory appends its own DOM to the empty
  //    <section> in index.html and returns a small controller object.
  const cv = createCvSearch({ panel: document.getElementById('panel-search') });
  const kw = createKwSearch({ panel: document.getElementById('panel-search_kw') });
  const viz = createVisualize({ panel: document.getElementById('panel-visualize') });
  const doc = createMarkdownPage({ container: document.getElementById('panel-documentation'), slug: 'doc' });
  const about = createMarkdownPage({ container: document.getElementById('panel-about'), slug: 'about' });
  // Now that every [data-i18n] node exists, fill in the translated text.
  applyStatic();

  // 3. Engine + data.
  setStatus(tr('loading') + '…');
  await initDb();
  await loadLang(lang());

  // 4. First query populates the facet dropdowns and the results table.
  //    The keyword tab's empty search is kicked off but not awaited.
  await cv.refresh();
  kw.refresh();
  showOverlay(false);

  // 5. Tabs are driven by the URL hash so they are bookmarkable.  The router
  //    calls this on every change; the tab modules are lazy where it matters
  //    (Plotly and the markdown pages only load on first visit).
  initRouter((tab, prev) => {
    // Switching between the two search tabs clears the other one (app_server.R).
    if (tab === 'search' && prev === 'search_kw') kw.reset();
    if (tab === 'search_kw' && prev === 'search') cv.reset();
    if (tab === 'visualize') viz.activate();
    if (tab === 'documentation') doc.load();
    if (tab === 'about') about.load();
  });

  // Language toggle: make sure the other table exists before announcing the
  // change, so the modules' 'langchange' handlers can query it immediately.
  langToggle.addEventListener('change', async () => {
    const next = langToggle.checked ? 'fr' : 'en';
    langToggle.disabled = true;
    showOverlay(true);
    try {
      await loadLang(next);
      setLang(next); // updates static labels and dispatches 'langchange'
      // Markdown pages only reload if they are the tab on screen.
      const tab = location.hash.replace(/^#/, '');
      if (tab === 'documentation') doc.load();
      if (tab === 'about') about.load();
    } catch (err) {
      console.error(err);
      langToggle.checked = lang() === 'fr'; // roll the switch back
      alert(String(err));
    } finally {
      langToggle.disabled = false;
      showOverlay(false);
    }
  });

  if (new URLSearchParams(location.search).has('selftest')) selftest().catch(console.error);
}

// Any boot failure (no WebAssembly, blocked download, ...) is shown in the overlay.
boot().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message ?? err}`);
  overlay.classList.add('is-error');
});
