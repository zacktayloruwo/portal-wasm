/**
 * fetch-duckdb-ext.mjs — copy DuckDB's parquet extension into public/ so the
 * site serves it itself instead of the browser fetching it from
 * extensions.duckdb.org at start-up.
 *
 * DuckDB-WASM loads extensions from
 *   <repository>/<DuckDB version>/<platform>/<name>.duckdb_extension.wasm
 * and src/db.js points <repository> at public/duckdb-ext, so the files must
 * sit at exactly that path.  Both platforms are needed: wasm_eh (modern
 * browsers) and wasm_mvp (old ones), matching the two engine builds.
 *
 * The files are committed, so this only needs re-running after upgrading
 * @duckdb/duckdb-wasm.  The DuckDB version is not the npm package version:
 * run SELECT version() in the app (or read the warning db.js logs when the
 * self-hosted copy is missing) and pass it here.
 *
 *   node scripts/fetch-duckdb-ext.mjs v1.4.3
 */
import { mkdir, writeFile } from 'node:fs/promises';

const VERSION = process.argv[2] ?? 'v1.4.3';
const PLATFORMS = ['wasm_eh', 'wasm_mvp'];
const EXTENSIONS = ['parquet'];

for (const platform of PLATFORMS) {
  for (const name of EXTENSIONS) {
    const path = `${VERSION}/${platform}/${name}.duckdb_extension.wasm`;
    const res = await fetch(`https://extensions.duckdb.org/${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Every wasm module starts with "\0asm"; anything else is an error page.
    if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      throw new Error(`${path}: not a wasm file`);
    }
    const dir = `public/duckdb-ext/${VERSION}/${platform}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${name}.duckdb_extension.wasm`, bytes);
    console.log(`${dir}/${name}.duckdb_extension.wasm  ${(bytes.length / 1024).toFixed(0)} KB`);
  }
}
