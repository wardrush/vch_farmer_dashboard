# analyst-dashboard.md — Analyst app spec

Routes: `/analyst` (grower grid + cohort builder), `/analyst/op/:opCode` (per-farmer), `/analyst/status-map`, `/analyst/qa`. Purpose: everything needed to assemble the BCarbon application (Tables 2/5/13 + maps + sample evidence) with QA visibility.

Data: `ops/index.json`, `analyst/ops/{op}/strat.json`, `analyst/ops/{op}/samples.geojson|.csv`, `analyst/project/summary.json`, `analyst/fields-status.web.geojson`, `analyst/qa.json`, `analyst/vch_demo.duckdb` (exports).

## Per-farmer view (`/analyst/op/:opCode`) — R13, R14, R15, R19

Top: identical farmer Page 1+2 content (tracker, credits, map) in compact form — the analyst sees what the farmer sees.

Then the analyst-only panels:

1. **Stratification panel** (`strat.json`): stat row — # textures, total acres, creditable acres, # fields, # samples. Below, per-stratum table scoped to this op (Table 13 shape): texture, acres, avg density (t/ac-ft), OC gain %pts (mean + lower-90), gain t/ac-ft, est. gain t, credited t, creditable? (with reason chips: `lower90≤0`, `<5 PLSS sections`). Row highlight for credited strata ("credited interim soil strata").
2. **Sample map** (`MapInlay` + `samples.geojson`, spec in `specs/maps.md`): composite points over the op's field boundaries. `FilterChips`: All · 2024 (S24+F24) · 2025 (S25+F25) · per-period S24/F24/S25/F25; color by period (baseline sand/gold, monitoring green per design-system). Click a point → **lab card**: period, texture, TOC, TC, CCE, inorganic C, OM, bulk density (+variant, or "BD missing — partial point"), lab no, received/reported dates, outlier flags, match_completeness, TRS.
3. **Baseline vs treated strip** (R19): per-stratum paired bars (S25 mean TOC vs F25 mean TOC) with n annotations.
4. **Exports**: `Samples CSV` (respects current filter; columns = full lab_result payload + point location) and `Op JSON` (strat + samples + profile).

Acceptance: filtering to a single period updates map + counts; a point with DC but no BD renders the partial badge; export row count equals visible point count.

## Cohort builder (`/analyst`) — R16, R17

1. **Grower grid** (`DataGrid`, `ops/index.json`): columns op_code, label, region, state, enrolled date, enroll_origin, acres, creditable acres, # fields, # samples, measured gain t, credited t, current stage. Checkbox multiselect; quick-select chips: by region (ND_E / ND_W / MN), by enrollment year (2024 / 2025), all.
2. **Rollup panel** (recomputes on selection): total/creditable acres, # ops/fields/samples, measured gain, credited total, and a **per-stratum aggregate table** for the selection (same Table 13 shape, aggregated from per-op strat data).
3. **Exports** for current selection:
   - `Full JSON` — everything: profiles, strat, samples w/ lab.
   - `Application CSV` (denormalized, application-minimum): one row per op × stratum with `op_code, op_label, entity_name, state, region, enrollment_year, texture_class, stratum_acres, creditable_acres, n_points_baseline, n_points_monitoring, avg_bulk_density_g_cm3, avg_density_t_acft, toc_baseline_mean_pct, toc_monitoring_mean_pct, oc_gain_ppts, oc_gain_lower90_ppts, gain_t_acft, est_gain_t, credited_t, creditable, n_plss_sections` — the minimum needed to reproduce Table 13 + per-property rows.
   - `Sample points CSV` — one row per point × lab result for the selection.

**Acceptance fixture:** selecting **all** growers reproduces the application: creditable ≈ 386,514 ac; est. gain ≈ 1,334,549.5 t; credited ≈ 352,126.1 t (display computed deltas vs fixtures from `analyst/project/summary.json`).

## Submission status map (`/analyst/status-map`) — R18

Full-project field choropleth from `fields-status.web.geojson`: fields colored by status class (derived from op's micro stage: pre-submission sand-300 / submitted gold-400 / validated green / credited dark green). Legend + counts; click field → op popup with link to per-farmer view. Toggle: color by status ↔ color by period coverage (has S25 only vs S25+F25 — the baseline-vs-treated completeness view).

## QA view (`/analyst/qa`)

From `qa.json`: crosswalk resolution counts (auto_exact/auto_fuzzy/manual/unresolved) with unresolved list; 224 unmatched samples table; outlier counts by tier; fixture deltas from the build report. This page is the "why the new system is trustworthy" demo beat.
