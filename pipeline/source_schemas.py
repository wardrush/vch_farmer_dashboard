"""THE mapping layer (CLAUDE.md hard rule 1).

Every raw source column name that exists anywhere in data/source/ is named
in this file and nowhere else. Downstream pipeline code (crosswalk.py,
geometry.py, rollups.py, fabricate.py) only ever sees canonical column names.

If a source drifts (columns renamed/added/removed by the exporting system),
loading here raises SchemaDriftError with a copy-pasteable diff — loud, not
a silent wrong join.
"""
from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import geopandas as gpd
import pandas as pd

from normalizers import normalize_land_class, normalize_texture

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "data" / "source"


class SchemaDriftError(Exception):
    pass


class RowCountDriftError(Exception):
    pass


def _resolve_path(file_pattern: str) -> Path:
    matches = sorted(SOURCE_DIR.glob(file_pattern))
    if not matches:
        raise SchemaDriftError(
            f"No file in {SOURCE_DIR} matches pattern {file_pattern!r}. "
            f"Files present: {[p.name for p in SOURCE_DIR.iterdir()]}"
        )
    if len(matches) > 1:
        raise SchemaDriftError(f"Pattern {file_pattern!r} matched multiple files: {[p.name for p in matches]}")
    return matches[0]


@dataclass
class SourceMap:
    source_name: str  # e.g. "gpkg.fields"
    file_pattern: str  # glob matched inside data/source/
    required: list[str]  # raw columns that MUST exist
    renames: dict[str, str]  # raw -> canonical
    transforms: dict[str, Callable] = field(default_factory=dict)  # canonical -> fn
    optional: list[str] = field(default_factory=list)  # tolerated-if-missing raw cols to also keep
    layer: str | None = None  # gpkg layer name
    zip_member: str | None = None  # csv filename inside a zip
    sheet_name: "str | int" = 0
    header_row: int = 0
    drop_row_pattern: "tuple[str, str] | None" = None  # (raw_column, regex) rows to drop before validate
    expected_row_count: int | None = None
    enum_checks: dict[str, set] = field(default_factory=dict)  # canonical col -> allowed values (post-transform)

    def _read_raw(self) -> "pd.DataFrame | gpd.GeoDataFrame":
        path = _resolve_path(self.file_pattern)
        if path.suffix == ".gpkg":
            return gpd.read_file(path, layer=self.layer)
        if path.suffix == ".xlsx":
            return pd.read_excel(path, sheet_name=self.sheet_name, header=self.header_row)
        if path.suffix == ".zip":
            with zipfile.ZipFile(path) as z:
                with z.open(self.zip_member) as f:
                    return pd.read_csv(f)
        if path.suffix == ".csv":
            return pd.read_csv(path)
        raise SchemaDriftError(f"Don't know how to read {path.suffix} for {self.source_name}")

    def _validate_columns(self, raw: "pd.DataFrame | gpd.GeoDataFrame") -> None:
        found = set(raw.columns)
        missing = [c for c in self.required if c not in found]
        if missing:
            expected = sorted(self.required)
            raise SchemaDriftError(
                f"[{self.source_name}] SchemaDriftError — missing required columns.\n"
                f"  expected (required): {expected}\n"
                f"  found:               {sorted(found)}\n"
                f"  missing:             {missing}\n"
                f"Fix the mapping in source_schemas.py or investigate the source export."
            )
        known = set(self.required) | set(self.optional) | set(self.renames.keys())
        unexpected = sorted(found - known)
        if unexpected:
            print(f"WARN [{self.source_name}] unexpected new columns (candidates for mapping): {unexpected}")

    def load(self) -> "pd.DataFrame | gpd.GeoDataFrame":
        raw = self._read_raw()

        if self.drop_row_pattern is not None:
            col, pattern = self.drop_row_pattern
            mask = raw[col].astype(str).str.contains(pattern, regex=True, na=False)
            raw = raw.loc[~mask].copy()

        self._validate_columns(raw)

        if self.expected_row_count is not None and len(raw) != self.expected_row_count:
            raise RowCountDriftError(
                f"[{self.source_name}] expected {self.expected_row_count} rows, found {len(raw)}. "
                f"Source data changed shape — re-verify docs/DATA_SOURCES.md."
            )

        keep_raw = [c for c in raw.columns if c in self.renames]
        out = raw[keep_raw].rename(columns=self.renames)

        for canon_col, fn in self.transforms.items():
            if canon_col in out.columns:
                out[canon_col] = out[canon_col].apply(fn)

        for canon_col, allowed in self.enum_checks.items():
            if canon_col not in out.columns:
                continue
            observed = set(out[canon_col].dropna().unique())
            bad = observed - allowed
            if bad:
                raise SchemaDriftError(
                    f"[{self.source_name}] canonical column {canon_col!r} has values outside the expected enum.\n"
                    f"  allowed:  {sorted(allowed)}\n"
                    f"  offending: {sorted(bad)}"
                )

        if isinstance(out, gpd.GeoDataFrame) and "geometry" in out.columns:
            out = out.set_geometry("geometry")

        return out.reset_index(drop=True)


def _to_bool(v) -> bool | None:
    if pd.isna(v):
        return None
    if isinstance(v, bool):
        return v
    return bool(float(v))


def _strip(v):
    if pd.isna(v):
        return None
    s = str(v).strip()
    return s if s else None


def _to_float(v):
    if pd.isna(v):
        return None
    return float(v)


# ---------------------------------------------------------------------------
# 1. gpkg `fields` -> canonical `field`
# ---------------------------------------------------------------------------
GPKG_FIELDS = SourceMap(
    source_name="gpkg.fields",
    file_pattern="VCH_boundaries*.gpkg",
    layer="fields",
    expected_row_count=2801,
    required=[
        "BDR_ID", "FIELDNAME", "BDR_ACRES", "field_geom_area_acres",
        "farmable_acres", "nonfarmable_acres", "water_acres",
        "dom_usda_texture_class", "dom_smf_cluster",
        "enroll_origin", "baseline_season", "enrollment_year",
        "match_status", "match_overlap_pct", "STATE", "op_code", "op_label",
        "LAST_BUSIN", "geometry",
    ],
    optional=["CITY", "ZIP", "project_scope", "year_added", "op_year"],
    renames={
        "BDR_ID": "field_id",
        "op_code": "op_code_raw",
        "op_label": "op_label_raw",
        "LAST_BUSIN": "last_busin_raw",
        "FIELDNAME": "field_name",
        "BDR_ACRES": "boundary_acres",
        "field_geom_area_acres": "geom_acres",
        "farmable_acres": "farmable_acres",
        "nonfarmable_acres": "nonfarmable_acres",
        "water_acres": "water_acres",
        "dom_usda_texture_class": "dom_texture_class",
        "dom_smf_cluster": "dom_smf_cluster",
        "enroll_origin": "enroll_origin",
        "baseline_season": "baseline_season",
        "enrollment_year": "enrollment_year",
        "match_status": "match_status",
        "match_overlap_pct": "match_overlap_pct",
        "STATE": "state",
        "geometry": "geometry",
    },
    transforms={
        "op_code_raw": _strip,
        "op_label_raw": _strip,
        "last_busin_raw": _strip,
        "field_name": _strip,
        "dom_texture_class": normalize_texture,
        "state": _strip,
        # geometry stays EPSG:5070 here — CLAUDE.md hard rule 4: reprojection
        # to 4326 happens exactly once, in pipeline/geometry.py.
    },
)

# ---------------------------------------------------------------------------
# 2. gpkg `soil_components` -> canonical `soil_component`
# ---------------------------------------------------------------------------
GPKG_SOIL_COMPONENTS = SourceMap(
    source_name="gpkg.soil_components",
    file_pattern="VCH_boundaries*.gpkg",
    layer="soil_components",
    expected_row_count=23021,
    required=[
        "BDR_ID", "mukey", "musym", "muname", "usda_texture_class", "smf_cluster",
        "component_pct_r", "soil_area_acres", "soil_area_pct_of_bdr_acres",
        "dbovendry_0_30", "sand_pct_0_30", "silt_pct_0_30", "clay_pct_0_30",
        "is_water", "is_wetland_density", "is_farmable_texture",
        "land_class_exclusive", "is_bdr_primary_row", "op_code", "geometry",
    ],
    optional=["fid", "is_nonfarmable_texture", "soil_source", "areasymbol", "ssurgo_texture", "texture_name"],
    renames={
        "BDR_ID": "field_id",
        "op_code": "op_code_raw",
        "mukey": "mukey",
        "musym": "musym",
        "muname": "mu_name",
        "usda_texture_class": "texture_class",
        "smf_cluster": "smf_cluster",
        "component_pct_r": "component_pct",
        "soil_area_acres": "area_acres",
        "soil_area_pct_of_bdr_acres": "pct_of_field",
        "dbovendry_0_30": "bulk_density_g_cm3",
        "sand_pct_0_30": "sand_pct",
        "silt_pct_0_30": "silt_pct",
        "clay_pct_0_30": "clay_pct",
        "is_water": "is_water",
        "is_wetland_density": "is_wetland_density",
        "is_farmable_texture": "is_farmable",
        "land_class_exclusive": "land_class",
        "is_bdr_primary_row": "is_primary_row",
        "geometry": "geometry",
    },
    transforms={
        "op_code_raw": _strip,
        "texture_class": normalize_texture,
        "is_water": _to_bool,
        "is_wetland_density": _to_bool,
        "is_farmable": _to_bool,
        "land_class": normalize_land_class,
        # geometry stays EPSG:5070 here — reprojected once in geometry.py.
    },
)

# ---------------------------------------------------------------------------
# 3. samples xlsx -> canonical `sample_point` + `lab_result` (built together
#    downstream in adapters.py; both draw from this one load())
# ---------------------------------------------------------------------------
SAMPLES = SourceMap(
    source_name="samples.xlsx",
    file_pattern="denormalized_samples_ND_MN_v5.xlsx",
    expected_row_count=11939,
    required=[
        "sample_uid", "sample_type", "bd_variant", "period", "customer", "farm_business",
        "lat", "lon", "latlon_source", "trs_canonical", "trs_confidence",
        "usda_texture_class", "mukey", "smf_cluster", "state", "region", "match_completeness",
        "TOC", "TC", "CCE", "inorganic_carbon", "OM", "OM_LOI",
        "bulk_density_master", "core_diam", "core_length", "depth",
        "received_date", "corrected_date_received", "reported_date",
        "outlier_spatial_tier", "outlier_toc_tier", "outlier_bd_flag",
        "ref_no", "lab_no", "project",
    ],
    optional=["source_file", "field_id_raw", "sample_id_raw", "project_code", "account",
              "trs_norm", "is_spring_sample", "sample_for_thane", "trs_norm_pre_correction",
              "trs_mistake_flag", "trs_correction_confidence", "trs_correction_review_flag",
              "soil_type_code", "map_unit_name", "sand_pct", "silt_pct", "clay_pct",
              "texture_source", "texture_pct_source", "bulk_density_usda_dbovendry"],
    renames={
        "sample_uid": "lab_result_id",
        "sample_type": "sample_type",
        "bd_variant": "bd_variant",
        "ref_no": "ref_no",
        "lab_no": "lab_no",
        "period": "period",
        "project": "project_num",
        "customer": "customer_raw",
        "farm_business": "farm_business_raw",
        "lat": "lat",
        "lon": "lon",
        "latlon_source": "latlon_source",
        "trs_canonical": "trs",
        "trs_confidence": "trs_confidence",
        "usda_texture_class": "texture_class",
        "mukey": "mukey",
        "smf_cluster": "smf_cluster",
        "state": "state",
        "region": "region",
        "match_completeness": "match_completeness",
        "TOC": "toc_pct",
        "TC": "tc_pct",
        "CCE": "cce_pct",
        "inorganic_carbon": "inorganic_c_pct",
        "OM": "om_pct",
        "OM_LOI": "om_loi_pct",
        "bulk_density_master": "bulk_density_g_cm3",
        "core_diam": "core_diam_in",
        "core_length": "core_length_in",
        "depth": "depth_range",
        "received_date": "received_date_raw",
        "corrected_date_received": "corrected_date_received",
        "reported_date": "reported_date",
        "outlier_spatial_tier": "outlier_spatial_tier",
        "outlier_toc_tier": "outlier_toc_tier",
        "outlier_bd_flag": "outlier_bd_flag",
    },
    transforms={
        "lab_result_id": lambda v: str(v).strip(),  # DC rows are numeric, BD rows alphanumeric (e.g. "NW3282") in the real export
        "sample_type": lambda v: _strip(v).upper() if _strip(v) else None,
        "period": _strip,
        "customer_raw": _strip,
        "farm_business_raw": _strip,
        "texture_class": normalize_texture,
        "trs": _strip,
        "toc_pct": _to_float,
        "tc_pct": _to_float,
        "cce_pct": _to_float,
        "inorganic_c_pct": _to_float,
        "bulk_density_g_cm3": _to_float,
    },
    enum_checks={
        "period": {"S24", "F24", "S25", "F25"},
    },
)

# ---------------------------------------------------------------------------
# 4. distributor CSV -> canonical `enrollment` (real 4-row seed; fabrication
#    extends this in fabricate.py)
# ---------------------------------------------------------------------------
ENROLLMENTS = SourceMap(
    source_name="distributor-enrollments.csv",
    file_pattern="distributor-enrollments*.zip",
    zip_member="distributor-enrollments.csv",
    expected_row_count=4,
    required=[
        "Enrollment ID", "Farmer Name", "Entity Name", "Distributor",
        "Total Acreage", "Tote Count", "Billed Acreage", "Status", "Bill-of-Sale Generated At",
    ],
    renames={
        "Enrollment ID": "enrollment_id",
        "Farmer Name": "farmer_name",
        "Entity Name": "entity_name",
        "Distributor": "distributor",
        "Total Acreage": "total_acreage",
        "Tote Count": "tote_count",
        "Billed Acreage": "billed_acreage",
        "Status": "status_raw",
        "Bill-of-Sale Generated At": "bill_of_sale_at",
    },
    transforms={
        "status_raw": lambda v: _strip(v).lower() if _strip(v) else None,
        "farmer_name": _strip,
        "entity_name": _strip,
        "distributor": _strip,
    },
)

# ---------------------------------------------------------------------------
# 5. farmer table xlsx -> canonical `credit_ledger` (measured side)
# ---------------------------------------------------------------------------
FARMER_TABLE = SourceMap(
    source_name="VCH_Project3_2025_farmer_table.xlsx",
    file_pattern="VCH_Project3_2025_farmer_table*.xlsx",
    sheet_name="Farmer summary",
    header_row=4,
    drop_row_pattern=("Farmer / Operation", r"SUBTOTAL|GRAND TOTAL|Unassigned"),
    required=[
        "Farmer / Operation", "Creditable acres",
        "Measured carbon gain (tonnes C, gross)",
        "Measured carbon gain / creditable acre (t C/ac)",
    ],
    renames={
        "Farmer / Operation": "farmer_table_name",
        "Creditable acres": "creditable_acres",
        "Measured carbon gain (tonnes C, gross)": "measured_gain_t",
        "Measured carbon gain / creditable acre (t C/ac)": "measured_gain_t_per_ac",
    },
    transforms={
        "farmer_table_name": _strip,
        "creditable_acres": _to_float,
        "measured_gain_t": _to_float,
        "measured_gain_t_per_ac": _to_float,
    },
)


# Fixture-check-only variant: keeps the "Unassigned" row (which has no op_code
# and is excluded from FARMER_TABLE above) so build.py can reproduce the raw
# farmer-table grand total of 366,539.6 ac exactly (CLAUDE.md hard rule 6).
FARMER_TABLE_ALL_ROWS = SourceMap(
    source_name="VCH_Project3_2025_farmer_table.xlsx (incl. Unassigned)",
    file_pattern="VCH_Project3_2025_farmer_table*.xlsx",
    sheet_name="Farmer summary",
    header_row=4,
    drop_row_pattern=("Farmer / Operation", r"SUBTOTAL|GRAND TOTAL"),
    required=FARMER_TABLE.required,
    renames=FARMER_TABLE.renames,
    transforms=FARMER_TABLE.transforms,
)


ALL_SOURCE_MAPS = {
    "gpkg.fields": GPKG_FIELDS,
    "gpkg.soil_components": GPKG_SOIL_COMPONENTS,
    "samples": SAMPLES,
    "enrollments": ENROLLMENTS,
    "farmer_table": FARMER_TABLE,
}
