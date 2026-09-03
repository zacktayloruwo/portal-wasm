import { defineConfig } from 'vite';

// BASE_PATH lets the same build target a project site (default) or a root
// domain: BASE_PATH=/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/portal-wasm/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
});
