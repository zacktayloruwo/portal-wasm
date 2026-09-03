# Census Discovery Portal (static)

A static, browser-only port of the Census Discovery Portal Shiny app. The
inventory lives in two parquet files that are queried in the browser with
[DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview); there is no server.

Live site: https://zacktayloruwo.github.io/portal-wasm/

## Develop

```bash
npm install
npm run dev
```

`npm run build` writes `dist/`; `BASE_PATH=/ npm run build` builds for a root
domain instead of the `/portal-wasm/` project path.

Append `?selftest` to the URL to run the queries in `public/data/selftest.json`
against DuckDB-WASM and print pass/fail to the browser console.

## Update the data

The data files in `public/data/` are generated from the R project
(`portal_20260330_claude`):

1. Rebuild `inst/extdata/portal.duckdb` and `inst/extdata/app_data.RData` as
   usual (`prep/prep_db.R`).
2. Bump `version`, `db_date`, `app_date` in `R/utils_global.R`.
3. From the R project root run

   ```bash
   Rscript dev/export_web.R          # parquet + meta.json + viz_counts.json
   Rscript dev/verify_web_export.R   # cross-checks and selftest.json
   ```

   The output directory defaults to `../portal-wasm/public/data` (override
   with `PORTAL_WEB_DATA`).
4. Commit the changed files in this repo and push `main`. The GitHub Actions
   workflow rebuilds and deploys the site.

Documentation and About pages are fetched at runtime from
`census-recensement/portal` (`doc_{en,fr}.md`, `about_{en,fr}.md`).
