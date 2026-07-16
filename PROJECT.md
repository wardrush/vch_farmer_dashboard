# PROJECT.md — VCH Farmer & Analyst Dashboard Demo

## Vision

Veterans Carbon Holdings (VCH) runs a measurement-based soil-carbon crediting program across North Dakota and northwest Minnesota under BCarbon Soil Protocol v3.0. Ninth Wonder Consulting (Ward Rushton) does the statistical work. The crediting pipeline has historically been opaque to growers ("when do I get an answer?") and painful for the analyst (lab, enrollment, and soil data arrived in different formats with inconsistent identifiers — tens of thousands of manual verification points).

This demo shows what the fixed system looks like:
- **Farmers** get a Domino's-pizza-tracker view of exactly where their project is, a map of their enrolled fields, their acres, and their credits — building trust and reducing "where are we?" calls.
- **The analyst** gets one place where boundaries, SSURGO textures, sample points, and lab results are already joined, with the rollups and exports needed to produce a BCarbon application (the real deliverable, see `Anthony_copy_VCH_BCarbon_Application_Project3_V01`).
- **Admin (coordinator)** manually advances grower statuses (these are not real-time events; a human confirms each milestone) and manages the enrollments database.

The demo uses **real Project 3 / 2025-cohort data** (boundaries, SSURGO intersection, 11,939 real lab-linked samples, per-farmer gains matching the submitted application) plus explicitly-flagged fabricated data (statuses, 2024 history, distributed credits) so every feature is demonstrable.

## Personas

| Persona | Who | Needs |
|---|---|---|
| **Farmer** | e.g. Mike Hoverson (Hoverson Brothers, 486 fields, ~61k ac) | Where is my project? What did I submit? What are my estimated credits? What's been paid? No jargon, no stratification detail. |
| **Analyst** | Ward (Ninth Wonder) | Per-farmer stratification, sample↔lab QA, cohort rollups by region/enrollment-year, application-ready exports, submission-status maps. |
| **Admin/Coordinator** | Katie Lorenz (VCH) | Multiselect growers → advance status; see enrolled date/state/acres/#fields; manage enrollments records (docs received / still needed). |

## Requirements traceability

Every line of Ward's brief, mapped to where it is specified. The builder should verify each row is satisfied before calling the demo done.

| # | Requirement (from brief) | Spec |
|---|---|---|
| R1 | Domino's-style tracker, zoomed in (10 micro stages: enrollment began → credits available) and out (5 macro stages: enrollment submitted → true-up completed), flow repeats per interim year | `docs/STATUS_MODEL.md`, `specs/farmer-dashboard.md` §Page 1 |
| R2 | Estimated credits across all properties in a project = baseline vs most recent year (no double counting) | CLAUDE.md rule 3, `docs/DATA_PIPELINE.md` §6, `specs/farmer-dashboard.md` §Page 1 |
| R3 | Admin: multiselect growers w/ columns (enrolled date, state, acres, # fields) → advance statuses manually | `specs/admin.md` |
| R4 | Per-project per-farmer map: navigable, highlighted semi-transparent field boundaries, one operation (`last_busid` → resolved via crosswalk) per view | `specs/maps.md`, `specs/farmer-dashboard.md` §Page 2 |
| R5 | Disparate fields → meta boxes around sub-clusters, click to zoom | `specs/maps.md` §Sub-cluster meta-boxes |
| R6 | Project detail: acres submitted, submitted date, project-specific status tracker | `specs/farmer-dashboard.md` §Page 2 |
| R7 | Estimated current credits shown only where interim credit project submitted | `specs/farmer-dashboard.md` §Page 2 |
| R8 | **No stratification information for farmers** | CLAUDE.md rule 2, `specs/farmer-dashboard.md` §Privacy |
| R9 | Project metadata: project year, true-up date | `specs/farmer-dashboard.md` §Page 2, `docs/STATUS_MODEL.md` |
| R10 | Enrollments view: linked admin view, submitted/still-needed, rollup (total acres, grower-since, credits *distributed*) | `specs/farmer-dashboard.md` §Page 3, `specs/admin.md` §Enrollments |
| R11 | Farmer may have multiple enrolled field sets | `docs/FIELD_MAPPING.md` (enrollment 1..n per operation), `specs/farmer-dashboard.md` §Page 3 |
| R12 | Analyst: track total project acres, creditable acres, soil textures (SSURGO ∩ enrollment maps), sampling areas — everything the application needs | `specs/analyst-dashboard.md`, `docs/DATA_PIPELINE.md` §4 |
| R13 | Analyst per-farmer view = farmer view + stratification (# textures, acres, creditable acres, credited interim strata) | `specs/analyst-dashboard.md` §Per-farmer |
| R14 | Sample locations: navigable map + exportable CSV; click sample → matched lab data | `specs/analyst-dashboard.md` §Sample map, `specs/maps.md` §Sample map |
| R15 | Sample map filterable by year/period or all | `specs/analyst-dashboard.md` §Sample map |
| R16 | Cohort builder: multiselect + group growers (region, enrollment year) → summary/rollup stats | `specs/analyst-dashboard.md` §Cohort builder |
| R17 | Exports: full JSON, or denormalized CSV with application minimum (soil texture, sample points, density, …) | `specs/analyst-dashboard.md` §Exports |
| R18 | Visual map: which fields submitted / validated / etc. | `specs/analyst-dashboard.md` §Status map |
| R19 | Baseline vs treated data throughout analyst views | `specs/analyst-dashboard.md` |
| R20 | Style matches intake form (intake.veteranscarbonholdings.com/intake) | `specs/design-system.md` |
| R21 | Python architecture for processing | CLAUDE.md §Stack, `docs/DATA_PIPELINE.md` |
| R22 | Explicit mapping layer — source attribute names unstable | CLAUDE.md rule 1, `docs/FIELD_MAPPING.md` |
| R23 | Snowflake fast-follow (geodata, enrollment, sample DBs) | `docs/ARCHITECTURE.md`, `docs/SNOWFLAKE.md` |
| R24 | Login: skipped in MVP (Netlify page password) | `docs/ARCHITECTURE.md` §Auth |
| R25 | Admin status changes live (Netlify Functions + blob store) | `docs/ARCHITECTURE.md`, `specs/admin.md` |

## Glossary

- **Operation** — a farm business (`op_code`, e.g. `24-02` = Swenson Grain & Cattle). The unit farmers log in as. 54 in the 2025 data.
- **Project** — a BCarbon application cohort (e.g. "Project 3: S25→F25 ND & MN"). An operation's fields belong to one project per enrollment. `project_scope` `P4` in the gpkg; samples carry `project` 2/3/4.
- **Project-year** — one interim cycle for an operation within a project (baseline season → post-season monitoring → submission → validation → credits). The micro tracker tracks one project-year; the macro tracker spans years to true-up.
- **Stratum** — soil texture class (from gSSURGO map units) used as the statistical unit. 8–11 per project; credits computed per stratum. **Analyst-only concept.**
- **Composite point** — one sample location = composite of 10–20 cores, 3–15 in depth (2″×12″ core, ~617.92 cm³).
- **DC / BD** — sample types in the lab export: Dry Combustion carbon analysis / Bulk Density.
- **TOC / TC / CCE** — total organic carbon = TC − inorganic; inorganic = CCE × 0.12 (calcareous region).
- **Measured gain** — gross tonnes C gained (avg 3.64 t/ac in P3). **Credited** — after BCarbon 1 t/ac/yr interim cap + lower-90% CI floor + ≥5-PLSS-section rule (P3: 352,126.1 t from 1,334,549.5 t measured). Never conflate.
- **True-up** — same-season settlement sampling (2028, then 2031, 2034) that reconciles interim credits.
- **Distributed credits** — proceeds actually paid to grower (55% of net sale). Distinct from estimated and from minted.
- **Tote** — unit of treatment product purchased (distributor enrollments `Tote Count`).
- **PLSS / TRS** — Public Land Survey System town-range-section; sample location bookkeeping (`trs_canonical`).

## Out of scope (MVP demo)

- Real authentication/authorization (Netlify page password only; farmer identity via route param).
- Real-time/automated status transitions (explicitly manual by design).
- BCarbon API integration, credit marketplace, payments.
- Editing field boundaries in the UI.
- Mobile-first layouts (must not break on tablet; desktop is the demo target).
