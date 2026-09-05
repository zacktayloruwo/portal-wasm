/**
 * db.js — DuckDB-WASM lifecycle and the single query() helper.
 *
 * DuckDB runs inside a Web Worker; this module talks to it through the
 * AsyncDuckDB API.  The inventory is *materialised* into an in-memory table
 * (CREATE TABLE ... AS SELECT * FROM read_parquet(...)) rather than queried
 * straight from the parquet file, because every filter change runs eight
 * queries over all rows and scanning the parquet each time would be slower.
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
import { tableFor } from './sql.js';

let db = null;
let conn = null;
const loaded = new Map(); // lang -> Promise that resolves once its table exists

/** Start the worker, instantiate the wasm module, open a connection. */
export async function initDb() {
  if (conn) return;
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

/**
 * Make sure inventory_<lang> exists.  Idempotent and de-duplicated: repeated
 * calls while a download is in flight all await the same promise.  On failure
 * the entry is removed so a later call can retry.
 */
export function ensureTable(lang, onProgress) {
  const tbl = tableFor(lang);
  if (!loaded.has(lang)) {
    loaded.set(lang, (async () => {
      const url = `${import.meta.env.BASE_URL}data/${tbl}.parquet`;
      const buf = await fetchBytes(url, onProgress);
      const fname = `${tbl}.parquet`;
      // Expose the bytes to DuckDB's virtual file system, copy them into a
      // real table, then drop the file so the parquet isn't held twice.
      await db.registerFileBuffer(fname, buf);
      await conn.query(`CREATE TABLE ${tbl} AS SELECT * FROM read_parquet('${fname}')`);
      await db.dropFile(fname);
    })().catch((err) => { loaded.delete(lang); throw err; }));
  }
  return loaded.get(lang);
}

/**
 * Run SQL and return plain row objects.
 * With params, a prepared statement is used so user-typed values are bound
 * rather than interpolated (see sql.js).  Arrow's toJSON() leaves LIST cells
 * as Arrow vectors; util.listToArray() normalises those at render time.
 */
export async function query(sql, params = []) {
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
