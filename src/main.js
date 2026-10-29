/**
 * main.js — application entry point.
 *
 * Boot sequence (static edition: all in the browser, no server; in the
 * server edition the engine and table steps are no-ops, see db_api.js):
 *   0. as soon as this script runs, start the two big downloads side by side:
 *      the DuckDB-WASM engine and the current language's parquet
 *   1. fetch data/meta.json (translations, column metadata, version strings)
 *      and data/snapshot_<lang>.json (the opening view) in parallel
 *   2. initialise i18n + build the five tab panels (they create their own DOM)
 *   3. show the snapshot (first page of results and the field choices) and
 *      hide the overlay; the page is readable before the engine is ready
 *   4. start the hash router; any query waits for the engine (db.query is
 *      gated on it) behind the results spinner
 *
 * This file also owns the two pieces of state that span tabs: the EN/FR
 * switch and the "switching between search tabs resets the other one" rule
 * that the Shiny app implemented in app_server.R.
 */
// Self-hosted fonts (treatment A): Source Sans 3 for the interface,
// Source Serif 4 for titles and headings. Each CSS file declares the weight
// with unicode-range subsets, so browsers fetch only the Latin files needed.
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/400-italic.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-serif-4/600.css';
import './styles/base.css';
import './styles/portal.css';
import { initI18n, detectLang, applyStatic, setLang, lang, tr } from './i18n.js';
import { initRouter } from './router.js';
import { initDb, ensureTable, ensureSearchText, hasTable, holdQueriesUntil, query, run } from '#db';
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

const dataLabel = (l) => (l === 'fr' ? 'Chargement des données' : 'Loading data');

// Download + register one language's inventory table (no-op if already loaded).
async function loadLang(l) {
  await ensureTable(l, progress(dataLabel(lang())));
}

// 0. Start the engine and this language's data now, in parallel, before
//    anything else.  Queries wait on this; the page does not.
const startLang = detectLang();
const engineReady = Promise.all([initDb(), ensureTable(startLang, progress(dataLabel(startLang)))]);
holdQueriesUntil(engineReady);
engineReady.then(() => { document.documentElement.dataset.engine = 'ready'; }, () => {});

const fetchJson = async (path) => {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

/**
 * Optional self-test, enabled by adding ?selftest to the URL.
 * data/selftest.json is written by prep/prep_db.R and holds SQL, parameters,
 * and the counts/ids that R's DuckDB returned.  Running
 * the same statements through DuckDB-WASM proves the two engines agree on the
 * exported parquet.  Keyword cases also run the raw search text through the
 * app's own keyword operation (the pre-built search_text column) and must
 * give the same count and first records (app_ok).  Results go to
 * console.table() and window.__selftest.  The server edition takes no SQL
 * from the browser; its backend runs the same fixtures (npm run selftest).
 */
async function selftest() {
  if (import.meta.env.VITE_BACKEND === 'api') { console.warn('selftest: run `npm run selftest` in the server\'s backend/'); return; }
  let cases;
  try { cases = await fetchJson('data/selftest.json'); } catch { console.warn('selftest.json missing'); return; }
  const out = [];
  for (const c of cases) {
    if (c.lang && c.lang !== lang()) await ensureTable(c.lang); // FR fixtures need the FR table
    const [{ n }] = await query(c.count_sql, c.params ?? []);
    const ids = (await query(c.ids_sql, c.params ?? [])).map((r) => r.id);
    const idsOk = JSON.stringify(ids) === JSON.stringify(c.first_ids);
    let appOk = true;
    if (c.kw_text != null) {
      const r = await run('kwSearch', { lang: c.lang, kw: c.kw_text, isOr: c.kw_or, page: 1, pageSize: 5 });
      const aids = r.rows.map((row) => row.id);
      appOk = r.total === c.expected_count && JSON.stringify(aids) === JSON.stringify(c.first_ids);
    }
    out.push({ label: c.label, expected: c.expected_count, actual: Number(n), count_ok: Number(n) === c.expected_count, ids_ok: idsOk, app_ok: appOk });
  }
  console.table(out);
  const failed = out.filter((r) => !r.count_ok || !r.ids_ok || !r.app_ok).length;
  console.log(`selftest: ${out.length - failed}/${out.length} passed`);
  window.__selftest = out;
}

async function boot() {
  // 1. Metadata and the opening snapshot (small files) while the engine loads.
  //    A missing snapshot is not fatal: the page then waits for the engine.
  const [meta, snapshot] = await Promise.all([
    fetchJson('data/meta.json'),
    fetchJson(`data/snapshot_${startLang}.json`).catch(() => null),
  ]);
  initI18n(meta);

  // Footer strings come from the settings block in prep/prep_db.R via meta.json.
  document.getElementById('footer-version').textContent = meta.version;
  document.getElementById('footer-db-date').textContent = meta.db_date;
  document.getElementById('footer-app-date').textContent = meta.app_date;

  // The EN | FR control in the masthead: the pressed button is the current language.
  const langButtons = [...document.querySelectorAll('.portal-lang button[data-lang]')];
  const markLang = () => langButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang())));
  markLang();

  // 2. Build the tab panels.  Each factory appends its own DOM to the empty
  //    <section> in index.html and returns a small controller object.
  const cv = createCvSearch({ panel: document.getElementById('panel-search') });
  const kw = createKwSearch({ panel: document.getElementById('panel-search_kw') });
  const viz = createVisualize({ panel: document.getElementById('panel-visualize') });
  const doc = createMarkdownPage({ container: document.getElementById('panel-documentation'), slug: 'doc' });
  const about = createMarkdownPage({ container: document.getElementById('panel-about'), slug: 'about' });
  // Now that every [data-i18n] node exists, fill in the translated text.
  applyStatic();

  // 3. Opening view: from the snapshot if there is one, else from the engine.
  setStatus(tr('loading') + '…');
  if (snapshot) {
    await cv.showSnapshot(snapshot);
    await kw.showSnapshot(snapshot);
  } else {
    await engineReady;
    await cv.refresh();
    kw.refresh();
  }
  showOverlay(false);

  // Once the engine is ready and the browser is idle, load the other
  // language's table in the background (low-priority download) so the EN | FR
  // switch is instant.  Skipped when the visitor has asked to save data.
  const other = startLang === 'en' ? 'fr' : 'en';
  const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 1000));
  if (!navigator.connection?.saveData) {
    engineReady.then(() => whenIdle(() => ensureTable(other, null, { background: true }).catch(() => {})), () => {});
  }

  // If the engine fails after the snapshot is on screen, say so.
  engineReady.catch((err) => {
    console.error(err);
    setStatus(`Error: ${err.message ?? err}`);
    overlay.classList.add('is-error');
    showOverlay(true);
  });

  // 5. Tabs are driven by the URL hash so they are bookmarkable.  The router
  //    calls this on every change; the tab modules are lazy where it matters
  //    (the chart data and the markdown pages only load on first visit).
  initRouter((tab, prev) => {
    // Switching between the two search tabs clears the other one (app_server.R).
    if (tab === 'search' && prev === 'search_kw') kw.reset();
    if (tab === 'search_kw' && prev === 'search') cv.reset();
    // Build the keyword-search column in the background on first visit.
    if (tab === 'search_kw') ensureSearchText(lang()).catch(console.error);
    if (tab === 'visualize') viz.activate();
    if (tab === 'documentation') doc.load();
    if (tab === 'about') about.load();
  });

  // Language switch: make sure the other table exists before announcing the
  // change, so the modules' 'langchange' handlers can query it immediately.
  async function switchLang(next) {
    if (next === lang()) return;
    langButtons.forEach((b) => { b.disabled = true; });
    // The overlay is only needed if the other table is not built yet.
    if (!hasTable(next)) showOverlay(true);
    try {
      await loadLang(next);
      setLang(next); // updates static labels and dispatches 'langchange'
      const tab = location.hash.replace(/^#/, '');
      // On the keyword tab, build this language's search column right away.
      if (tab === 'search_kw') ensureSearchText(next).catch(console.error);
      // Markdown pages only reload if they are the tab on screen.
      if (tab === 'documentation') doc.load();
      if (tab === 'about') about.load();
    } catch (err) {
      console.error(err);
      alert(String(err));
    } finally {
      markLang();
      langButtons.forEach((b) => { b.disabled = false; });
      showOverlay(false);
    }
  }
  langButtons.forEach((b) => b.addEventListener('click', () => switchLang(b.dataset.lang)));

  if (new URLSearchParams(location.search).has('selftest')) engineReady.then(selftest).catch(console.error);
}

// Any boot failure (no WebAssembly, blocked download, ...) is shown in the overlay.
boot().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message ?? err}`);
  overlay.classList.add('is-error');
});
