# FIELD_MAPPING.md — Canonical schema & the mapping layer

**Why this file exists (Ward's explicit requirement):** gpkg/SSURGO/lab attribute names are *not stable* between exports. Every raw source column is mapped to a canonical name in exactly one place — `pipeline/source_schemas.py` — so when a source drifts, the fix is one file and the failure is loud, not a silent wrong join.

## Canonical entities

Stored as parquet in `data/canonical/`. Types: `str`, `int`, `float`, `date`, `bool`, `geometry(4326)`.

### `operation`
| Column | Type | Notes |
|---|---|---|
| `op_code` | str PK | `24-02` |
| `op_label` | str | Display name |
| `entity_name` | str | Legal entity (application Table 5) |
| `landowner_name`, `address`, `city`, `state`, `zip` | str | From crosswalk/landowner enrichment |
| `region` | str | `ND_E` / `ND_W` / `MN` |
| `enrollment_year` | int | First year enrolled (op_code prefix: `24-*` → 2024) |
| `enroll_origin` | str | `2024_reenrolled` / `2025_new` |
| `ownership_status` | str | private / leased |
| `grower_since` | date | demo_fabricated where unknown |

### `field`
| Column | Type | Source concept |
|---|---|---|
| `field_id` | int PK | gpkg BDR id |
| `op_code` | str FK | via crosswalk |
| `project_id` | str FK | e.g. `P3-2025` |
| `field_name` | str | often TRS-like |
| `boundary_acres` | float | declared acres |
| `geom_acres` | float | geometry-derived |
| `farmable_acres`, `nonfarmable_acres`, `water_acres` | float | eligibility split |
| `dom_texture_class` | str | normalized, **analyst-only** |
| `dom_smf_cluster` | str | Fine/Medium/Sandy, **analyst-only** |
| `enroll_origin`, `baseline_season`, `enrollment_year` | str/int | |
| `match_status`, `match_overlap_pct` | str/float | boundary-match provenance |
| `state`, `county_hint` | str | filled from op when null |
| `geometry` | geometry(4326) | simplified variant also emitted |

### `soil_component` (analyst-only)
`component_id` (PK, from source fid), `field_id` FK, `op_code`, `mukey`, `musym`, `mu_name`, `texture_class` (normalized), `smf_cluster`, `component_pct`, `area_acres`, `pct_of_field`, `bulk_density_g_cm3` (SSURGO dbovendry 0–30), `sand_pct`, `silt_pct`, `clay_pct`, `is_water`, `is_wetland_density`, `is_farmable`, `land_class` (`farmable_mineral|water|wetland_lowdensity|nonfarmable_texture`), `is_primary_row`, `geometry(4326)`.

### `sample_point` (analyst-only)
One row per composite point per period (grouping DC+BD lab rows for the same physical point):
`point_id` PK, `op_code` FK, `project_id`, `period` (`S24|F24|S25|F25`), `sample_role` (`baseline|monitoring`), `lat`, `lon`, `latlon_source`, `trs`, `trs_confidence`, `state`, `region`, `texture_class`, `smf_cluster`, `mukey`, `match_completeness`, `demo_fabricated`.

### `lab_result` (analyst-only)
`lab_result_id` PK (source sample_uid), `point_id` FK, `sample_type` (`DC|BD`), `bd_variant`, `lab_no`, `ref_no`, `received_date`, `reported_date`, `toc_pct`, `tc_pct`, `cce_pct`, `inorganic_c_pct`, `om_pct`, `om_loi_pct`, `bulk_density_g_cm3`, `core_diam_in`, `core_length_in`, `depth_range`, `outlier_spatial_tier`, `outlier_toc_tier`, `outlier_bd_flag`.

### `enrollment`
`enrollment_id` PK (uuid), `op_code` FK, `farmer_name`, `entity_name`, `distributor`, `total_acreage`, `billed_acreage`, `tote_count`, `status`, `bill_of_sale_at`, `submitted_at`, `docs_received` (list[str]), `docs_needed` (list[str]), `demo_fabricated`. An operation has 1..n enrollments (R11).

### `project` / `project_year`
`project`: `project_id` PK (`P3-2025`), `name`, `baseline_period`, `monitoring_period`, `trueup_years` ([2028, 2031, 2034]), `protocol` (`BCarbon Soil v3.0`).
`project_year`: `project_year_id` PK, `project_id`, `op_code`, `year_index` (1,2,…), `season_span` (`S25→F25`), `submitted_at`, `is_current`.

### `status_event` — see `STATUS_MODEL.md`
`op_code`, `project_year_id`, `stage`, `entered_at`, `by`, `note`, `demo_fabricated`.

### `credit_ledger`
Per op × project_year: `measured_gain_t`, `measured_gain_t_per_ac`, `creditable_acres`, `credited_t` (capped/floored), `credit_basis` (`baseline_vs_latest`), `status` (`estimated|requested|validated|minted|distributed`), `distributed_usd` (nullable), `distributed_at` (nullable), `demo_fabricated`. **UI must always read `credited_t` for farmer surfaces and may show `measured_gain_t` only with the cap caveat.**

### `stratum_stat` (analyst-only)
Per scope (project | op | cohort-selection) × stratum × period-pair: `texture_class`, `acres`, `avg_density_t_acft`, `oc_gain_ppts` (mean and lower-90), `gain_t_acft`, `est_gain_t`, `requested_t`, `n_points_baseline`, `n_points_monitoring`, `n_plss_sections`, `creditable` (bool + reason).

## Per-source mapping tables

Implement exactly these in `source_schemas.py`. “Transform” names refer to shared normalizers below.

### gpkg `fields` → `field`
| Source | Canonical | Transform |
|---|---|---|
| `BDR_ID` | `field_id` | int |
| `op_code` / `op_label` | (crosswalk input) | strip |
| `LAST_BUSIN` | (crosswalk input only) | strip |
| `FIELDNAME` | `field_name` | strip |
| `BDR_ACRES` | `boundary_acres` | float |
| `field_geom_area_acres` | `geom_acres` | float |
| `farmable_acres` / `nonfarmable_acres` / `water_acres` | same names | float |
| `dom_usda_texture_class` | `dom_texture_class` | `normalize_texture` |
| `dom_smf_cluster` | `dom_smf_cluster` | strip |
| `enroll_origin`, `baseline_season`, `enrollment_year`, `match_status`, `match_overlap_pct`, `STATE` | as canonical | STATE→`state`, fill-from-op |
| `geom` | `geometry` | `to_4326` |

### gpkg `soil_components` → `soil_component`
| Source | Canonical | Transform |
|---|---|---|
| `fid` | `component_id` | |
| `BDR_ID` | `field_id` | |
| `mukey`, `musym`, `muname` | `mukey`, `musym`, `mu_name` | |
| `usda_texture_class` | `texture_class` | `normalize_texture` |
| `smf_cluster` | `smf_cluster` | |
| `component_pct_r` | `component_pct` | |
| `soil_area_acres` | `area_acres` | |
| `soil_area_pct_of_bdr_acres` | `pct_of_field` | |
| `dbovendry_0_30` | `bulk_density_g_cm3` | |
| `sand_pct_0_30`/`silt_pct_0_30`/`clay_pct_0_30` | `sand_pct`/`silt_pct`/`clay_pct` | |
| `is_water`, `is_wetland_density`, `is_farmable_texture` | `is_water`, `is_wetland_density`, `is_farmable` | to bool |
| `land_class_exclusive` | `land_class` | `normalize_land_class` (`Farmable/mineral`→`farmable_mineral`, `Water`→`water`, `Wetland density <1.1`→`wetland_lowdensity`, `Nonfarmable texture`→`nonfarmable_texture`) |
| `is_bdr_primary_row` | `is_primary_row` | |
| `geom` | `geometry` | `to_4326` |

### samples xlsx → `sample_point` + `lab_result`
| Source | Canonical | Transform |
|---|---|---|
| `sample_uid` | `lab_result_id` | |
| `sample_type` | `sample_type` | upper ∈ {DC, BD} |
| `bd_variant` | `bd_variant` | |
| `period` | `period` | validate ∈ {S24,F24,S25,F25}; derive `sample_role` (S→baseline, F→monitoring for current cycle) |
| `customer`, `farm_business` | (crosswalk input) | `normalize_name` |
| `lat`, `lon`, `latlon_source` | same | drop rows with `latlon_source == 'none'` from map artifacts, keep in tables |
| `trs_canonical`, `trs_confidence` | `trs`, `trs_confidence` | |
| `usda_texture_class` | `texture_class` | `normalize_texture` (fixes case drift) |
| `mukey`, `smf_cluster`, `state`, `region`, `match_completeness` | same | |
| `TOC`,`TC`,`CCE`,`inorganic_carbon`,`OM`,`OM_LOI` | `toc_pct`,`tc_pct`,`cce_pct`,`inorganic_c_pct`,`om_pct`,`om_loi_pct` | float |
| `bulk_density_master` | `bulk_density_g_cm3` | float |
| `core_diam`,`core_length`,`depth` | `core_diam_in`,`core_length_in`,`depth_range` | |
| `received_date`/`corrected_date_received`/`reported_date` | `received_date` (prefer corrected), `reported_date` | date |
| `outlier_*` | same | |

**Point grouping:** DC and BD rows for the same physical composite share location/period/customer; group by (`normalize_name(customer)`, `period`, rounded lat/lon 5 decimals, `trs`) → `point_id = sha1(...)[:12]`. A point may lack one of DC/BD — render with a "partial" badge.

### distributor CSV → `enrollment`
`Enrollment ID`→`enrollment_id`; `Farmer Name`→`farmer_name`; `Entity Name`→`entity_name`; `Distributor`→`distributor`; `Total Acreage`→`total_acreage`; `Tote Count`→`tote_count`; `Billed Acreage`→`billed_acreage`; `Status`→`status` (lower); `Bill-of-Sale Generated At`→`bill_of_sale_at` (nullable date). `op_code` via crosswalk on entity/farmer name.

### farmer table xlsx → `credit_ledger` (measured side)
Skip 4 preamble rows; drop rows where farmer matches `/SUBTOTAL|GRAND TOTAL|Unassigned/`. `Farmer / Operation`→crosswalk→`op_code`; `Creditable acres`→`creditable_acres`; `Measured carbon gain (tonnes C, gross)`→`measured_gain_t`; per-acre column→`measured_gain_t_per_ac`.

## Shared normalizers (spec)

```python
def normalize_texture(v) -> str | None:
    # "Sandy loam" | "SANDY LOAM" | "sandy loam " -> "Sandy Loam"
    # Map oddballs: "Spm"/"Mpm" -> "Organic (Spm)"/"Organic (Mpm)"; keep "Muck".
    # None/"" -> None. Unknown value -> raise UnknownTextureError (add to map deliberately).

def normalize_name(v) -> str:
    # casefold, strip punctuation/parentheticals, collapse whitespace — used ONLY for matching, never display.

def normalize_land_class(v) -> str: ...
def to_4326(geom): ...  # pyproj CRS 5070 -> 4326, applied once in geometry.py
```

## `source_schemas.py` contract

```python
@dataclass
class SourceMap:
    source_name: str                  # "gpkg.fields"
    file_pattern: str                 # glob matched inside data/source/
    required: list[str]               # raw columns that MUST exist
    renames: dict[str, str]           # raw -> canonical
    transforms: dict[str, Callable]   # canonical -> fn
    optional: list[str] = ...         # tolerated-if-missing

    def load(self) -> pd.DataFrame | gpd.GeoDataFrame:
        """Read, then validate():
        - missing required columns  -> SchemaDriftError listing them
        - unexpected new columns    -> WARN with the full list (candidates for mapping)
        - enum columns out of range -> SchemaDriftError with offending values
        Then rename, transform, and return ONLY canonical columns."""
```

Rules:
- Everything downstream of `adapters.py` sees canonical names only.
- A `SchemaDriftError` must print a copy-pasteable diff of expected vs found columns — that's the whole point.
- Unit tests: load each real source file and assert canonical output columns + row counts from `DATA_SOURCES.md`.
