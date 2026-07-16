# DATA_PIPELINE.md — Python pipeline spec

`pipeline/build.py` orchestrates stages 1–8. Idempotent; safe to rerun. Inputs from `data/source/`, canonical parquet to `data/canonical/`, web artifacts to `web/public/data/`. Python 3.11+, geopandas/shapely/pandas/duckdb/rapidfuzz.

## Stage 1 — Load + validate sources
Via `source_schemas.py` maps only (`docs/FIELD_MAPPING.md`). Any schema drift → `SchemaDriftError` with a column diff. Row-count sanity asserts from `DATA_SOURCES.md` (2,801 fields / 23,021 components / 11,939 samples).

## Stage 2 — Identity resolution
`crosswalk.py` per `docs/IDENTITY_CROSSWALK.md`. Outputs `operation` parquet + `_unresolved.csv`. Everything downstream joins on `op_code`.

## Stage 3 — Geometry prep (`geometry.py`)
- Reproject 5070→4326 (once, here).
- Two variants per field polygon: `full` (as-is) and `web` (shapely `simplify(tolerance≈0.00005°~5 m, preserve_topology=True)`); budget: whole-project web GeoJSON ≤ ~15 MB, largest single op (Hoverson, 486 fields) ≤ ~2 MB.
- **Sub-cluster detection (R5):** per op, DBSCAN over field centroids in projected meters (eps = 8 km, min_samples = 1 → every field belongs to a cluster). Emit per-cluster bbox (+5% padding), field count, acres. Ops with 1 cluster get no meta-boxes. Sanity-check eps against ops known to be disparate; tune so typical ops have 1–4 clusters.
- Per-op bounds and project-wide bounds for map fitting.

## Stage 4 — Soil rollups (`rollups.py`, analyst-only outputs)
From `soil_component` (excluding `op_code in (TEST, UNMATCHED)`):
- Per op: acres by `texture_class`, farmable/water/wetland/nonfarmable split, creditable acres, # textures, # fields, dominant texture.
- Per project: Table 2 reproduction — total property acres ≈ **389,133**, creditable ≈ **386,514** (assert within ±0.5%).
- Per stratum (project scope): acres by texture → the acres column of Table 13 (assert per-stratum within ±0.5%).
- Table 5 reproduction: per-op property rows (entity, ownership, address, state, total ac, creditable ac).

## Stage 5 — Samples + lab join
- Group lab rows into composite points (grouping key in `FIELD_MAPPING.md`); pair DC + BD.
- Attach `op_code` via crosswalk; keep `UNMATCHED` for QA views only.
- Per-point popup payload: period, texture, TOC/TC/CCE/inorganic/OM, bulk density (+variant), lab & received dates, outlier flags, match_completeness, trs.
- Emit per-op GeoJSON (points, properties incl. period for client-side filtering) + per-op CSV (all lab columns, analyst export) + project-wide DuckDB tables.
- Compute per-stratum sample stats: n points per period, mean TOC by period, TOC gain %pts (F25 mean − S25 mean), lower-90% one-sided bound (t-distribution), mean bulk density → t/ac-ft via ×1,233.48, # PLSS sections per stratum.
- **Fixture check:** per-stratum computed stats should approximate Table 13 (documented: match densities within ~2%, gains within ~0.05 %pts; Anthony's exact analysis may differ slightly — record deltas in a build report, don't hard-fail).

## Stage 6 — Credits (`rollups.py`)
- Measured side per op from farmer-table xlsx (source of truth): `creditable_acres`, `measured_gain_t`, `measured_gain_t_per_ac`.
- Credited side per op: distribute the project's per-stratum requested tonnes (Table 13 rules: min(acres, est-gain), lower-90 floor, ≥5 PLSS sections) to ops by their stratum acreage share; `credited_t = Σ_strata op_share`. Assert Σ ops ≈ **352,126.1 t** (±0.5%).
- `credit_basis = baseline_vs_latest` — always S25 vs latest monitoring period; never sum year-over-year (R2).
- Farmer-facing "estimated credits" = `credited_t` for the current cycle, with cap caveat copy.

## Stage 7 — Demo fabrication (`fabricate.py` — ONLY place fabricated data is created; every record `demo_fabricated: true`)
1. **Statuses:** seed event log staggering the 54 ops across all 10 micro stages so every state is demonstrable (distribution + named anchors in `DEMO_SCRIPT.md`). Dates consistent with the real timeline (see `STATUS_MODEL.md`).
2. **2024 history:** the 16 ops with real S24/F24 samples get a completed `P?-2024` project-year: micro track fully complete, `credits_available`, and a `credit_ledger` row with `status = distributed`, plausible `distributed_usd` (credited_t × demo price × 55% grower share; document the demo price assumption, e.g. $20/t).
3. **Enrollment records:** extend the 4-row distributor export to one+ records per op (some ops get 2 to demo R11 multiple-enrollment sets). Fabricate: distributor names (reuse `PM Ag Sources; Cose` + 2–3 invented), tote counts ∝ acres/1,100, submitted dates (2024-11…2025-04 window), docs_received/docs_needed checklists (FSA Form 578, signed landholder agreement, W-9, bill of sale) with a few ops missing items to demo the "still needed" UI.
4. **grower_since:** 2024 ops → 2024 dates; 2025 ops → 2025 dates.

## Stage 8 — Emit web artifacts

All farmer-facing artifacts pass an **allowlist schema check** (rule 2): a test enumerates allowed property keys per artifact; any texture/stratum/soil key in a farmer artifact fails the build.

| Artifact | Contents | Consumer |
|---|---|---|
| `ops/index.json` | per op: op_code, label, state, region, acres, #fields, enrolled date, current macro+micro stage, credited_t, grower_since | admin grid, analyst grid, farmer resolve |
| `ops/{op_code}/profile.json` | farmer page 1+2 payload: tracker state, projects[], acres submitted, submitted_at, credited_t + caveat copy flag, true-up year, cluster bboxes | farmer |
| `ops/{op_code}/fields.web.geojson` | simplified field polygons (id, name, acres — **no soil props**) | farmer + analyst maps |
| `ops/{op_code}/enrollments.json` | enrollment rows + rollup (total acres, grower_since, credits_distributed) | farmer page 3 |
| `analyst/ops/{op_code}/strat.json` | stratification panel: per-texture acres, creditable, per-stratum stats + credited strata | analyst |
| `analyst/ops/{op_code}/samples.geojson` / `.csv` | composite points w/ popup payload | analyst map/export |
| `analyst/project/summary.json` | Table 2/5/13 reproductions + fixture deltas report | analyst |
| `analyst/fields-status.web.geojson` | all-project simplified fields w/ status class for the choropleth | analyst status map |
| `analyst/qa.json` | crosswalk health, unmatched samples, outlier counts | analyst QA |
| `status-seed.json` | initial event log | frontend fallback + Blobs seeding |
| `analyst/vch_demo.duckdb` | all canonical tables | analyst exports, local analysis |

`cohort` rollups (R16/R17) are computed client-side from `ops/index.json` + per-op strat/sample artifacts, or via DuckDB-WASM if simpler — builder's choice; contract stays the same.

## Build report
`build.py` ends by printing + writing `data/canonical/build_report.md`: row counts per entity, fixture assertions w/ deltas, crosswalk resolution counts, artifact sizes vs budgets, allowlist check result.
