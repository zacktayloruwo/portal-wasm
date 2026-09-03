import './styles/base.css';
import './styles/portal.css';
import { initI18n, applyStatic, setLang, lang, getMeta, tr } from './i18n.js';
import { initRouter } from './router.js';
import { initDb, ensureTable, query } from './db.js';
import { createCvSearch } from './search_cv.js';
import { createKwSearch } from './search_kw.js';
import { createVisualize } from './visualize.js';
import { createMarkdownPage } from './markdown.js';

const overlay = document.getElementById('app-loading-overlay');
const status = document.getElementById('app-loading-status');

function setStatus(msg) { if (status) status.textContent = msg; }
function fmtMb(b) { return (b / 1e6).toFixed(1); }
function progress(label) {
  return (received, total) => setStatus(total ? `${label} ${fmtMb(received)} / ${fmtMb(total)} MB` : `${label} ${fmtMb(received)} MB`);
}
function showOverlay(on) {
  overlay.classList.toggle('is-hidden', !on);
}

async function loadLang(l) {
  await ensureTable(l, progress(lang() === 'fr' ? 'Chargement des données' : 'Loading data'));
}

async function selftest() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/selftest.json`, { cache: 'no-cache' });
  if (!res.ok) { console.warn('selftest.json missing'); return; }
  const cases = await res.json();
  const out = [];
  for (const c of cases) {
    if (c.lang && c.lang !== lang()) await ensureTable(c.lang);
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
  const meta = await (await fetch(`${import.meta.env.BASE_URL}data/meta.json`, { cache: 'no-cache' })).json();
  initI18n(meta);

  document.getElementById('footer-version').textContent = meta.version;
  document.getElementById('footer-db-date').textContent = meta.db_date;
  document.getElementById('footer-app-date').textContent = meta.app_date;

  const langToggle = document.getElementById('language');
  langToggle.checked = lang() === 'fr';

  const cv = createCvSearch({ panel: document.getElementById('panel-search') });
  const kw = createKwSearch({ panel: document.getElementById('panel-search_kw') });
  const viz = createVisualize({ panel: document.getElementById('panel-visualize') });
  const doc = createMarkdownPage({ container: document.getElementById('panel-documentation'), slug: 'doc' });
  const about = createMarkdownPage({ container: document.getElementById('panel-about'), slug: 'about' });
  applyStatic();

  setStatus(tr('loading') + '…');
  await initDb();
  await loadLang(lang());
  await cv.refresh();
  kw.refresh();
  showOverlay(false);

  initRouter((tab, prev) => {
    // Switching between the two search tabs clears the other one (app_server.R).
    if (tab === 'search' && prev === 'search_kw') kw.reset();
    if (tab === 'search_kw' && prev === 'search') cv.reset();
    if (tab === 'visualize') viz.activate();
    if (tab === 'documentation') doc.load();
    if (tab === 'about') about.load();
  });

  langToggle.addEventListener('change', async () => {
    const next = langToggle.checked ? 'fr' : 'en';
    langToggle.disabled = true;
    showOverlay(true);
    try {
      await loadLang(next);
      setLang(next);
      const tab = location.hash.replace(/^#/, '');
      if (tab === 'documentation') doc.load();
      if (tab === 'about') about.load();
    } catch (err) {
      console.error(err);
      langToggle.checked = lang() === 'fr';
      alert(String(err));
    } finally {
      langToggle.disabled = false;
      showOverlay(false);
    }
  });

  if (new URLSearchParams(location.search).has('selftest')) selftest().catch(console.error);
}

boot().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message ?? err}`);
  overlay.classList.add('is-error');
});
