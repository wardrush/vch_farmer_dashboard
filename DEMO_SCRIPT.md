# DEMO_SCRIPT.md — Demo walkthrough & status staging

The fabricated status seed (`fabricate.py`) must stage these specific growers so the demo tells the full story. All fabricated records carry `demo_fabricated: true` and render a `DemoBadge`.

## Named anchors (stage these exactly)

| Grower (op) | Stage (P3-2025 project-year) | Why |
|---|---|---|
| **Hoverson Brothers** | `credits_available` + completed 2024 history with distributed credits | The flagship: biggest op (486 fields, ~61k ac), real S24/F24 samples, shows the full macro arc (Year 1 completed) + "credits distributed" rollup + map performance test. |
| **Hong Farms** | `project_validated` | Real 2024 samples; shows validated-but-not-yet-credited. |
| **Fugleberg Farms** | `project_submitted` | Also demos crosswalk healing the "Fulgelberg" lab typo (QA view tie-in). |
| **Kristian Sorum** | `lab_data_received` | Highest S25 sample count (384) — rich sample map. |
| **Doug Ginther** | `post_season_sampling_completed` | Mid-pipeline 2025_new op. |
| **Majeres Farms** | `baseline_sampling_completed` | Baseline done, monitoring pending — the "baselined but treated sampling hasn't happened" state Ward called out. |
| **Dan Pfeifle** | `baseline_samples_requested` | Early stage. |
| **Cose Farms** | `maps_approved` | Early stage; also ties to distributor "PM Ag Sources; Cose". |
| **A 2025_new small op** (builder picks, e.g. Brandon Downs) | `all_files_submitted` | Fresh enrollment. |
| **One op** (builder picks) | `enrollment_began` + missing docs in enrollments | Shows the "still needed" checklist on farmer Page 3 / admin drawer. |
| Remaining ops | Spread across stages 5–9 weighted toward `project_submitted` | Matches reality (application submitted 2026-07-11, awaiting validation). |

Ops with real 2024 samples (16 — Stuart Eeg, Hong, Fugleberg, Hoverson, Kyllo/Braaten, Tim & Randy Garrett, Ross Johnson, James Aarsvold, Kohls, Ben Bring, Shawn Knutson, Joseph Swenson, Jason Rossler, Chase Elliott, Schatzke, John Field) all get the completed-2024 history + distributed credits (Stage 7 of `DATA_PIPELINE.md`).

## Walkthrough (the 10-minute demo)

1. **Farmer, mid-pipeline** — `/farmer/{Majeres}`: macro tracker at Baseline gathered; expand micro → `baseline_sampling_completed`; credits slot says "after submission". Map with clustered fields.
2. **Farmer, flagship** — `/farmer/{Hoverson}`: Year 1 completed on macro; credits card with cap caveat; enrollments page rollup (grower since 2024, credits distributed). Zoom the 486-field map, click a meta-box.
3. **Admin** — `/admin`: filter to `lab_data_received`, multiselect, advance to `project_submitted`, confirm; flip to the farmer tab and reload — tracker moved. No redeploy.
4. **Analyst, per-farmer** — `/analyst/op/{Kristian Sorum}`: stratification panel, credited strata highlights; sample map filter All → 2025 → S25; click a point → lab card; export CSV.
5. **Analyst, cohort** — `/analyst`: select all → rollup reproduces the application numbers (386,514 ac / 352,126 t); then group by region ND_E, export Application CSV.
6. **Analyst, status map** — fields choropleth; toggle to period coverage.
7. **QA close** — `/analyst/qa`: crosswalk healed variants, 224 unmatched legacy samples — "this is why the barcode system going forward".

## Demo integrity notes

- "Today" for the demo narrative is **July 2026** (application submitted 2026-07-11, awaiting BCarbon validation — matches Ward's grower email).
- Any number a farmer could quote must be the credited (capped) figure with the caveat; the measured 3.64 t/ac average appears only on analyst surfaces.
- If demoing against the live intake site in the same session, make clear any submitted intake data is test data.
