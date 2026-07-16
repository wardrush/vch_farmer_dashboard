# CLAUDE.md — VCH Farmer & Analyst Dashboard Demo

Builder guidance for implementing this demo. Read `PROJECT.md` first for the why; this file is the how.
Every requirement lives in `docs/` and `specs/` — do not re-derive requirements from conversation; the docs are authoritative.

## What this is

A demo (requirements-gathering vehicle, not production) of:
1. A **farmer dashboard** — project status tracker, per-project field-boundary map, enrollments view.
2. A **data-analyst dashboard** — everything farmers see plus stratification, sample/lab data, cohort rollups, exports that feed the BCarbon application.
3. An **admin backend** — multiselect growers → advance project status; enrollments database view.

Real data in, demo statuses staggered so every pipeline state is visible. See `DEMO_SCRIPT.md`.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Data pipeline | Python 3.11+, geopandas, shapely, pandas, duckdb, rapidfuzz, openpyxl | Runs locally, emits static artifacts. Ward knows Python — keep pipeline code plain and readable. |
| Frontend | Vite + React + TypeScript + Tailwind (VCH theme) | Static build, deployed to Netlify behind Ward's page password. |
| Maps | MapLibre GL JS (no Mapbox token) | Esri World Imagery raster basemap. See `specs/maps.md`. |
| Live state | Netlify Functions + Netlify Blobs | Status events + enrollment edits only. Everything else is baked JSON. |
| Analyst store | DuckDB file emitted by pipeline | Also used for exports; mirrors future Snowflake views (`docs/SNOWFLAKE.md`). |

## Repo layout (to create)

```
pipeline/
  source_schemas.py      # THE mapping layer — the only file that knows raw source column names
  adapters.py            # SourceAdapter.from_files() now; .from_snowflake() later
  crosswalk.py           # identity resolution (docs/IDENTITY_CROSSWALK.md)
  geometry.py            # reprojection, simplification, sub-clustering
  rollups.py             # soil/credit/acreage aggregation
  fabricate.py           # ALL demo-fabricated data lives here, nowhere else
  build.py               # orchestrator: sources → data/canonical/ → web/public/data/
data/
  source/                # copies of the five input files (see docs/DATA_SOURCES.md)
  canonical/             # parquet per canonical entity + operations_crosswalk.csv (committed, hand-editable)
web/
  public/data/           # baked JSON/GeoJSON artifacts (contracts in docs/DATA_PIPELINE.md §8)
  src/                   # React app: routes /farmer/:opCode/*, /analyst/*, /admin/*
functions/               # Netlify Functions: status.ts, enrollments.ts
```

## Hard rules

1. **No raw source column names outside `pipeline/source_schemas.py`.** Source attribute names (gpkg, SSURGO, lab export) are NOT stable. Every source column is mapped to the canonical schema (`docs/FIELD_MAPPING.md`) in one place, with loud validation on drift. If you find yourself typing `BDR_ACRES` or `bulk_density_master` anywhere else, stop.
2. **Farmer-facing outputs never contain stratification.** No texture class, no stratum table, no per-stratum anything in any JSON consumed by farmer routes. Enforced by an output-schema allowlist test in the pipeline (see `docs/DATA_PIPELINE.md` §8 and `specs/farmer-dashboard.md`). This is a business rule, not a style choice: partial-treatment behavior would corrupt the program's data.
3. **Measured gain ≠ credited amount.** Measured carbon gain (gross, avg 3.64 t/ac for P3) and credited tonnes (BCarbon 1 t/ac/yr interim cap, lower-90% CI floor, zero-floored strata) are distinct fields with distinct names (`measured_gain_t`, `credited_t`) end to end. Farmer UI shows credited numbers with the plain-language cap explanation. Never sum credits across years — estimated credits = baseline vs most recent year only.
4. **Reproject once.** EPSG:5070 → EPSG:4326 happens in `pipeline/geometry.py` only. Web artifacts are always 4326.
5. **Fabricated demo data is flagged.** Everything invented (statuses, distributed credits, 2024 project records, extended enrollments) is created in `fabricate.py` and carries `"demo_fabricated": true`. Real data never gets the flag.
6. **Acceptance fixtures are numbers.** The pipeline must reproduce: Table 2 totals (389,133 ac property / 386,514 ac creditable), Table 13 totals (1,334,549.5 t estimated / 352,126.1 t requested), farmer-table grand total (366,539.6 creditable ac in the per-farmer table). Assert these in pipeline tests; small tolerance (±0.5%) allowed for geometry simplification, none for tabular sums.
7. **The crosswalk file is authoritative once committed.** `data/canonical/operations_crosswalk.csv` is generated once, hand-edited by the analyst, then treated as source of truth. The pipeline must never overwrite it silently.

## Conventions

- Operation key: `op_code` (e.g. `24-02`) everywhere; `op_label` is display-only. `LAST_BUSIN`, samples `customer`/`farm_business` are source variants resolved by the crosswalk.
- Periods: `S24`, `F24`, `S25`, `F25` (season+year). Baseline for P3 = `S25`, monitoring = `F25`.
- Texture classes: canonical Title Case ("Sandy Loam"); `normalize_texture()` in the mapping layer.
- Units in column names where ambiguous: `_acres`, `_t` (tonnes C, not CO2e), `_t_per_acft`, `_g_cm3`, `_pct`.
- All dates ISO `YYYY-MM-DD`.

## Build order (suggested)

1. `pipeline/source_schemas.py` + `adapters.py` + validation → canonical parquet.
2. `crosswalk.py` → `operations_crosswalk.csv`, review unresolved.
3. `geometry.py` + `rollups.py` → verify acceptance fixtures (Hard rule 6).
4. `fabricate.py` + `build.py` → `web/public/data/` artifacts.
5. Web app: design system (`specs/design-system.md`) → farmer pages → analyst pages → admin.
6. Netlify Functions + Blobs seeding; deploy.

## Doc map

| Doc | Contents |
|---|---|
| `PROJECT.md` | Personas, requirements traceability, glossary, out-of-scope |
| `docs/DATA_SOURCES.md` | Column dictionaries for the 5 source files |
| `docs/FIELD_MAPPING.md` | Canonical schema + per-source column maps + `source_schemas.py` spec |
| `docs/IDENTITY_CROSSWALK.md` | Operation identity resolution |
| `docs/STATUS_MODEL.md` | Micro/macro stage machines, status event schema |
| `docs/DATA_PIPELINE.md` | Pipeline stages + output artifact contracts |
| `docs/ARCHITECTURE.md` | Deployment shape, functions, auth posture |
| `docs/SNOWFLAKE.md` | Fast-follow: adapters, DDL, materialized views |
| `specs/design-system.md` | VCH visual tokens + component inventory |
| `specs/farmer-dashboard.md` | Farmer pages + acceptance criteria |
| `specs/analyst-dashboard.md` | Analyst pages, exports + acceptance criteria |
| `specs/admin.md` | Admin pages |
| `specs/maps.md` | MapLibre layers, meta-box clustering, sample map |
| `specs/sampling.md` | Soil sampling planner: stratification, point placement, sample-size model, manual editing, exports |
| `DEMO_SCRIPT.md` | Which grower demonstrates which state |
