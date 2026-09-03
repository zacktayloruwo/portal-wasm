import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { tableFor } from './sql.js';

let db = null;
let conn = null;
const loaded = new Map(); // lang -> Promise

export async function initDb() {
  if (conn) return;
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({ query: { castBigIntToDouble: true } });
  conn = await db.connect();
}

// Fetch with a byte-progress callback (Content-Length permitting).
async function fetchBytes(url, onProgress) {
  const res = await fetch(url, { cache: 'no-cache' });
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
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Load one language's parquet into a table (idempotent, deduplicated).
export function ensureTable(lang, onProgress) {
  const tbl = tableFor(lang);
  if (!loaded.has(lang)) {
    loaded.set(lang, (async () => {
      const url = `${import.meta.env.BASE_URL}data/${tbl}.parquet`;
      const buf = await fetchBytes(url, onProgress);
      const fname = `${tbl}.parquet`;
      await db.registerFileBuffer(fname, buf);
      await conn.query(`CREATE TABLE ${tbl} AS SELECT * FROM read_parquet('${fname}')`);
      await db.dropFile(fname);
    })().catch((err) => { loaded.delete(lang); throw err; }));
  }
  return loaded.get(lang);
}

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
