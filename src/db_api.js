/**
 * db_api.js — the server edition's database: the same named operations as
 * db_wasm.js, run by the portal-server backend instead of in the browser.
 *
 * Built in with VITE_BACKEND=api (see vite.config.js).  run(op, args) posts
 * {op, args} to <base>api/run and returns the JSON result; the server runs
 * the operation from queries.js against its own DuckDB and never accepts
 * SQL.  There is nothing to download or build in the browser, so the table
 * functions resolve at once and are kept only so main.js and the tabs are
 * the same in both editions.
 */
const API = `${import.meta.env.BASE_URL}api/run`;

export const initDb = () => Promise.resolve();
export const prefetchTable = () => Promise.resolve();
export const ensureTable = () => Promise.resolve();
export const hasTable = () => true;
export const ensureSearchText = () => Promise.resolve();
export function holdQueriesUntil() {}

/** Run one named operation from queries.js on the server. */
export async function run(op, args) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, args }),
  });
  if (!res.ok) {
    const msg = await res.json().then((b) => b.error, () => null);
    throw new Error(`${op}: ${msg ?? `HTTP ${res.status}`}`);
  }
  return res.json();
}

/** Raw SQL is not offered by the server; only ?selftest asks for it. */
export function query() {
  return Promise.reject(new Error('the server edition runs named operations only (db.run)'));
}
