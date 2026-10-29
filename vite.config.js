import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// BASE_PATH lets the same build target a project site (default) or a root
// domain: BASE_PATH=/ npm run build
//
// VITE_BACKEND picks the database the tabs import as '#db':
//   (unset)  db_wasm.js — DuckDB-WASM in the browser (GitHub Pages)
//   api      db_api.js  — the portal-server backend (Alliance VM)
// Only the chosen file is bundled, so the server edition ships no engine.
const api = process.env.VITE_BACKEND === 'api';
const base = process.env.BASE_PATH ?? '/portal-wasm/';

export default defineConfig({
  base,
  // While developing the server edition, `npm run dev` hands <base>api/* to
  // the backend (portal-server/backend, port 3003 unless API_PORT is set).
  server: api ? {
    proxy: {
      [`${base}api`]: {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 3003}`,
        rewrite: (p) => p.slice(base.length - 1),
      },
    },
  } : {},
  resolve: {
    alias: { '#db': fileURLToPath(new URL(`./src/${api ? 'db_api.js' : 'db_wasm.js'}`, import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
});
