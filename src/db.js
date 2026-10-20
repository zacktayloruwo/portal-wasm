/**
 * db.js — DuckDB-WASM lifecycle and the single query() helper.
 *
 * DuckDB runs inside a Web Worker; this module talks to it through the
 * AsyncDuckDB API.  The inventory is *materialised* into an in-memory table
 * (CREATE TABLE ... AS SELECT * FROM read_parquet(...)) rather than queried
 * straight from the parquet file, because every filter change runs several
 * queries over all rows and scanning the parquet each time would be slower.
 *
 * Start-up is split so the two big downloads run side by side: initDb()
 * fetches and starts the engine, prefetchTable() fetches a language's
 * parquet, and ensureTable() waits for both before building the table.
 * main.js starts all of this before anything else, and holdQueriesUntil()
 * makes query() wait until the first table exists, so the interface can be
 * built (and show the opening snapshot) while the engine is still loading.
 *
 * Tables are named inventory_en / inventory_fr, exactly as in the R app, so
 * the SQL strings in sql.js are unchanged from the Shiny modules.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
// Vite's ?url suffix copies these files into dist/assets with hashed names and
// gives us their final URLs, so the worker and wasm are served same-origin
// (no CDN, no cross-origin headers needed on GitHub Pages).
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { tableFor, SEARCH_TEXT_SQL } from './sql.js';

let db = null;
let conn = null;
let engine = null;                 // promise: worker started, wasm instantiated, connection open
let gate = Promise.resolve();      // query() waits on this (see holdQueriesUntil)
const downloads = new Map();       // lang -> Promise<Uint8Array> of its parquet
const loaded = new Map();          // lang -> Promise that resolves once its table exists
const searchText = new Map();      // lang -> Promise that resolves once search_text exists

/** Start the worker, instantiate the wasm module, open a connection (once). */
export function initDb() {
  if (!engine) {
    engine = (async () => {
      // "eh" = wasm exception handling (faster); "mvp" = fallback for old browsers.
      // selectBundle() feature-detects and picks one.  The "coi" (multi-threaded)
      // bundle is deliberately omitted: it needs COOP/COEP response headers, which
      // static hosting cannot set.
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
        eh: { mainModule: ehWasm, mainWorker: ehWorker },
      });
      const worker = new Worker(bundle.mainWorker);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      // COUNT(*) is a BIGINT; ask DuckDB to hand it back as a JS number, not a BigInt.
      await db.open({ query: { castBigIntToDouble: true } });
      conn = await db.connect();
    })().catch((err) => { engine = null; throw err; });
  }
  return engine;
}

/**
 * fetch() with a byte-progress callback so the overlay can show a counter.
 * Falls back to a plain arrayBuffer() when streaming is unavailable.
 */
async function fetchBytes(url, onProgress) {
  const res = await fetch(url, { cache: 'no-cache' }); // revalidate: data may change between deploys
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  // Concatenate the chunks into one contiguous buffer for DuckDB.
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Start downloading a language's parquet without waiting for the engine (once). */
export function prefetchTable(lang, onProgress) {
  if (!downloads.has(lang)) {
    const url = `${import.meta.env.BASE_URL}data/${tableFor(lang)}.parquet`;
    downloads.set(lang, fetchBytes(url, onProgress).catch((err) => { downloads.delete(lang); throw err; }));
  }
  return downloads.get(lang);
}

/**
 * Make sure inventory_<lang> exists.  Idempotent and de-duplicated: repeated
 * calls while a download is in flight all await the same promise.  On failure
 * the entry is removed so a later call can retry.
 */
export function ensureTable(lang, onProgress) {
  const tbl = tableFor(lang);
  if (!loaded.has(lang)) {
    loaded.set(lang, (async () => {
      // Engine and parquet download in parallel; build once both are here.
      const [buf] = await Promise.all([prefetchTable(lang, onProgress), initDb()]);
      const fname = `${tbl}.parquet`;
      // Expose the bytes to DuckDB's virtual file system, copy them into a
      // real table, then drop the file so the parquet isn't held twice.
      await db.registerFileBuffer(fname, buf);
      await conn.query(`CREATE TABLE ${tbl} AS SELECT * FROM read_parquet('${fname}')`);
      await db.dropFile(fname);
      downloads.delete(lang); // the bytes are in the table now
    })().catch((err) => { loaded.delete(lang); throw err; }));
  }
  return loaded.get(lang);
}

/**
 * Add the keyword-search column to inventory_<lang> (once): see
 * SEARCH_TEXT_SQL in sql.js.  Takes about 0.2 s; main.js starts it in the
 * background when the keyword tab is first opened, and search_kw.js awaits it
 * before a keyword query.
 */
export function ensureSearchText(lang) {
  if (!searchText.has(lang)) {
    searchText.set(lang, (async () => {
      await ensureTable(lang);
      const tbl = tableFor(lang);
      await conn.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS search_text VARCHAR`);
      await conn.query(`UPDATE ${tbl} SET search_text = ${SEARCH_TEXT_SQL}`);
    })().catch((err) => { searchText.delete(lang); throw err; }));
  }
  return searchText.get(lang);
}

/** Make every query() wait for this promise (the engine plus the first table). */
export function holdQueriesUntil(promise) {
  gate = promise;
}

/**
 * Run SQL and return plain row objects.
 * With params, a prepared statement is used so user-typed values are bound
 * rather than interpolated (see sql.js).  Arrow's toJSON() leaves LIST cells
 * as Arrow vectors; util.listToArray() normalises those at render time.
 */
export async function query(sql, params = []) {
  await gate;
  let table;
  if (params.length) {
    const stmt = await conn.prepare(sql);
    try {
      table = await stmt.query(...params);
    } finally {
      await stmt.close();
    }
  } else {
    table = await conn.query(sql);
  }
  return table.toArray().map((r) => r.toJSON());
}
