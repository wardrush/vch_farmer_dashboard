# DATA_SOURCES.md — Source file profiles

Five input files. Copy them into `data/source/` before running the pipeline (keep original filenames; `source_schemas.py` matches on patterns, not exact names — see `FIELD_MAPPING.md`).

> ⚠ Attribute names in these sources are **not stable** between exports. Never reference them outside the mapping layer.

## 1. `VCH_boundaries_2025 (1).gpkg` — field boundaries + SSURGO intersection

GeoPackage, CRS **EPSG:5070 (NAD83 / Conus Albers)**. Extent ≈ lon −102.6…−94.5, lat 46.4…49.0 (after reprojection). Three tables:

### `fields` — 2,801 rows, POLYGON
One row per enrolled field boundary.

| Column | Notes |
|---|---|
| `BDR_ID` | Field ID (e.g. 48357138). Unique per field. |
| `geom` | Field polygon. |
| `enrollment_year` | All 2025. |
| `project_scope` | All `P4`. |
| `enroll_origin` | `2024_reenrolled` (1,326) / `2025_new` (1,475). |
| `year_added`, `baseline_season` | `baseline_season` all `S25`. |
| `BDR_ACRES` | Declared boundary acres. |
| `field_geom_area_acres` | Geometry-derived acres. |
| `match_status` | `matched_existing` (2,691) / `new` (110). |
| `match_overlap_pct`, `gpkg_source_BDR_ID` | Boundary-matching provenance. |
| `CLIENTID`, `FIELDNAME`, `FARMNAME`, `FIRSTNAME` | Source-system naming (FIELDNAME is often a TRS like `20-138N-44W`). |
| `LAST_BUSIN` | Business name. **110 nulls; 718 rows disagree with `op_label`. Do not use as the grouping key** — crosswalk input only. |
| `STATE`, `CITY`, `ZIP` | 2,216 null STATE; ND 538 / MN 47 where present. Fill from op-level data via crosswalk. |
| `op_label`, `op_code`, `op_year` | **Canonical operation identity.** 54 distinct; only 2 rows null. `op_code` format `YY-NN` (e.g. `24-02`). |
| `farmer_name_source`, `property_name`, `ownership_status`, `landowner_details`, `full_address`, `lo_state` | Landowner enrichment (property_name only on 1,248 rows / 14 values). |
| `dom_usda_texture_class`, `dom_smf_cluster`, `dom_land_class` | Dominant texture per field (smf_cluster: Fine 705 / Medium 1,518 / Sandy 558). |
| `n_soil_pieces`, `soil_pieces_acres` | Count/area of SSURGO pieces intersecting the field. |
| `farmable_acres`, `nonfarmable_acres`, `water_acres` | Eligibility decomposition. |
| `wt_density_0_30`, `wt_clay_pct_0_30` | Area-weighted SSURGO 0–30 cm properties. |

### `soil_components` — 23,021 rows, MULTIPOLYGON
Field ∩ gSSURGO map-unit pieces (the enrollment-map × SSURGO intersection the application requires). Carries most `fields` context columns plus:

| Column | Notes |
|---|---|
| `is_bdr_primary_row` | One primary row per BDR for non-double-counting sums. |
| `areasymbol`, `mukey`, `musym`, `muname` | SSURGO map unit keys/names. |
| `ssurgo_texture`, `texture_name`, `usda_texture_class`, `smf_cluster` | Texture attribution. usda_texture_class distribution (by acres): Loam 159,351; Sandy Loam 73,644; Silty Clay Loam 57,268; Silt Loam 42,498; Silty Clay 27,862; Clay 13,161; Sand 6,701; Clay Loam 4,896; Muck 1,269; Loamy Sand 765; Spm 590; null 674; Mpm 34; Sandy Clay Loam 26. |
| `component_pct_r`, `soil_area_acres`, `soil_area_pct_of_bdr_acres` | Component share and area. |
| `dbovendry_0_30`, `sand_pct_0_30`, `silt_pct_0_30`, `clay_pct_0_30` | SSURGO physical properties. |
| `is_water`, `is_wetland_density`, `is_farmable_texture`, `is_nonfarmable_texture`, `land_class_exclusive` | Eligibility flags. `land_class_exclusive` acres: Farmable/mineral 381,880; Water 4,941; Nonfarmable texture 1,894; Wetland density<1.1 22. |
| `soil_source` | Provenance. |

### `landowner_reference` — 20 rows, attributes only
`property_name`, `ownership_status`, `landowner_details`, `full_address`, `lo_state`, `matched`.

## 2. `denormalized_samples_ND_MN_v5.xlsx` — real sample + lab export (11,939 rows)

Single sheet. One row per lab sample record. This is the shape the barcoded system exports going forward — treat as the reference schema for the future Snowflake samples DB.

| Group | Columns | Notes |
|---|---|---|
| Identity | `sample_uid`, `source_file`, `sample_type`, `ref_no`, `lab_no`, `field_id_raw`, `sample_id_raw`, `bd_variant` | `sample_type`: `DC` 6,533 / `BD` 5,406. `bd_variant` A/B on BD rows. |
| Dates | `received_date`, `corrected_date_received`, `reported_date` | Range 2024-08 … 2026-11. |
| Period/project | `is_spring_sample`, `sample_for_thane`, `period`, `project`, `project_code` | `period`: S25 6,778 / F25 4,369 / S24 447 / F24 345. `project`: 4 (10,293), 3 (854), 2 (629), null (163). `project_code` messy (e.g. `Region 6 Project 6`, `BCarbon  ENGEL_ND2`). |
| Location | `state`, `trs_canonical`, `trs_norm`, `trs_norm_pre_correction`, `trs_mistake_flag`, `trs_correction_confidence`, `trs_correction_review_flag`, `trs_confidence`, `lat`, `lon`, `region`, `latlon_source` | lat/lon on 11,715 rows. `region`: ND_W 5,538 / ND_E 5,369 / null 1,032. TRS correction lineage shows the historical matching pain. |
| Grower | `customer`, `farm_business`, `account` | 54 customers / 60 farm_business values — messy variants (`Fulgelberg Farms`, `Hong Farms (Curt & Chris Hong)`, `Shane Kyllo / Braaten / Bratten`). Crosswalk input. |
| Soil context | `soil_type_code`, `map_unit_name`, `mukey`, `usda_texture_class`, `smf_cluster`, `sand_pct`, `silt_pct`, `clay_pct`, `texture_source`, `texture_pct_source` | ⚠ texture case differs from gpkg: `"Sandy loam"` here vs `"Sandy Loam"` there → `normalize_texture()`. |
| Physical | `bulk_density_master`, `bulk_density_usda_dbovendry`, `core_diam`, `core_length`, `depth` | bulk_density_master: mean 1.342, range 1.12–1.63 g/cm³ (10,907 rows). |
| Lab chemistry | `TOC`, `TC`, `CCE`, `inorganic_carbon`, `OM`, `OM_LOI` | TOC: mean 2.15 %, range 0.23–5.85 (11,870 rows). OC = TC − CCE×0.12. |
| QA | `outlier_spatial_tier`, `outlier_toc_tier`, `outlier_bd_flag`, `match_completeness` | match_completeness: full 10,862 / full_corrected 807 / unmatched 224 / partial 45. |

Ops with real 2024 (S24/F24) samples — anchors for demo history (16): Stuart Eeg 167, Hong 134, Fugleberg 91, Hoverson 68, Kyllo/Braaten 63, Tim & Randy Garrett 52, Ross Johnson 46, James Aarsvold 45, Kohls 28, Ben Bring 28, Shawn Knutson 25, Joseph Swenson 12, Jason Rossler 12, Chase Elliott 9, Schatzke 6, John Field 6.

## 3. `VCH_Project3_2025_farmer_table (1).xlsx` — per-farmer gains (Project 3)

Sheet `Farmer summary`; 4 header/caveat rows then a table: `Farmer / Operation`, `Creditable acres`, `Measured carbon gain (tonnes C, gross)`, `Measured carbon gain / creditable acre (t C/ac)`. Includes subtotal rows (`24-xx …SUBTOTAL`, `25-xx …SUBTOTAL`, `Unassigned`, `GRAND TOTAL (all farms)` = 366,539.6 ac / 1,334,553.6 t / 3.64 t/ac) — **filter out subtotal/total rows on load**. The embedded caveat text (measured ≠ credited; 1 t/ac/yr cap; 352,126 t requested) is the required plain-language framing for any farmer-facing credits number. Per-op **source of truth for measured gain and creditable acres**.

## 4. `distributor-enrollments-20260715.zip` → `distributor-enrollments.csv`

The enrollments-backend export format (4 sample rows; extend to ~54 in fabrication). Columns: `Enrollment ID` (uuid), `Farmer Name`, `Entity Name`, `Distributor` (e.g. `PM Ag Sources; Cose`), `Total Acreage`, `Tote Count`, `Billed Acreage`, `Status` (`COMPLETED`), `Bill-of-Sale Generated At`. This schema defines the enrollments admin grid and the farmer Enrollments page rows.

## 5. `Anthony_copy_VCH_BCarbon_Application_Project3_V01 (1).docx` — the analyst deliverable

BCarbon Soil Protocol v3.0 application, "Project 3: S25–F25 ND and MN". The analyst dashboard exists to produce these numbers/artifacts:

- **Table 2**: total property area **389,133 ac** (57 operations); creditable **386,514 ac** (excl. water, wetland bd<1.1, non-farmable textures via `is_farmable_texture`).
- **Table 5**: per-property rows — property name, ownership, landowner, address, state, total ac, creditable ac.
- **Table 13 (interim credit per stratum)** — the acceptance fixture:

| Stratum | Acres | Avg density (t/ac-ft) | Avg OC gain (%pts) | Avg gain (t/ac-ft) | Est. gain (t C) | Requested (t C) |
|---|---|---|---|---|---|---|
| Loam | 162,559.1 | 1,928.05 | 0.242 | 4.670 | 759,182.3 | 162,559.1 |
| Silty Clay Loam | 55,883.2 | 1,977.52 | 0.203 | 4.010 | 224,068.9 | 55,883.2 |
| Silty Clay | 25,954.6 | 1,884.76 | 0.193 | 3.632 | 94,285.3 | 25,954.6 |
| Clay Loam | 5,163.3 | 1,985.78 | 0.484 | 9.613 | 49,634.9 | 5,163.3 |
| Clay | 13,062.5 | 1,842.08 | −0.195 | 0.000 | 0.0 | 0.0 |
| Loamy Sand | 1,337.3 | 1,977.89 | 0.175 | 3.465 | 4,635.3 | 1,337.3 |
| Sand | 6,818.9 | — | — | — | 0.0 | 0.0 |
| Sandy Clay Loam | 25.7 | — | — | — | 0.0 | 0.0 |
| Sandy Loam | 73,507.2 | 2,021.30 | 0.118 | 2.381 | 175,021.5 | 73,507.2 |
| Silt Loam | 42,134.4 | 2,006.01 | 0.033 | 0.658 | 27,721.4 | 27,721.4 |
| Silt | 68.2 | — | — | — | 0.0 | 0.0 |
| **Total** | **386,514.3** | | | | **1,334,549.5** | **352,126.1** |

- Credit rules encoded: adjusted gain = one-sided lower-90% CI TOC gain (%pts) × avg measured bulk density × acres, floored at 0; density t/ac-ft = bulk density g/cm³ × 1,233.48; requested = min(stratum acres × 1 t/ac/yr, est. gain), creditable only if lower-90% bound > 0 **and** stratum observed in ≥5 PLSS sections.
- Timeline: baseline S25, monitoring F25, true-up 2028 → 2031 → 2034; 10-year project.
- Sampling: 3–15 in depth, composite 10–20 cores, ≥~20 composites/stratum; lab = Agvise; OC = TC − CCE×0.12.
- Note: application says 57 properties; gpkg has 54 op_codes — Eeg Brothers was a late add and some entities are property-level splits. The crosswalk resolves; do not force the counts to match.
