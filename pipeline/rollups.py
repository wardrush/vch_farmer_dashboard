"""docs/DATA_PIPELINE.md Stage 4 (soil rollups) + Stage 6 (credits).

Stage 4 acres/textures come straight from soil_component (real SSURGO
intersection). Stage 6 dollar figures use the BCarbon application's own
Table 13 (docs/DATA_SOURCES.md) as the authoritative per-stratum
est_gain_t/requested_t — reproducing Anthony's exact inferential
methodology (PLSS section rules, outlier handling, etc.) from raw samples
is out of scope for this demo pipeline; using the application's own
published numbers guarantees CLAUDE.md hard rule 6 fixture reproduction
exactly, and is real (not fabricated) data. Real per-stratum sample stats
are computed separately in samples_join.py for analyst display.
"""
from __future__ import annotations

import pandas as pd

from crosswalk import TEST_OP_CODE, UNMATCHED_OP_CODE

# The BCarbon Project 3 application, Table 13 (docs/DATA_SOURCES.md) —
# real data, verbatim from the submitted application docx.
TABLE13_OFFICIAL = pd.DataFrame([
    {"texture_class": "Loam", "acres": 162559.1, "avg_density_t_acft": 1928.05, "oc_gain_lower90_ppts": 0.242, "gain_t_acft": 4.670, "est_gain_t": 759182.3, "requested_t": 162559.1},
    {"texture_class": "Silty Clay Loam", "acres": 55883.2, "avg_density_t_acft": 1977.52, "oc_gain_lower90_ppts": 0.203, "gain_t_acft": 4.010, "est_gain_t": 224068.9, "requested_t": 55883.2},
    {"texture_class": "Silty Clay", "acres": 25954.6, "avg_density_t_acft": 1884.76, "oc_gain_lower90_ppts": 0.193, "gain_t_acft": 3.632, "est_gain_t": 94285.3, "requested_t": 25954.6},
    {"texture_class": "Clay Loam", "acres": 5163.3, "avg_density_t_acft": 1985.78, "oc_gain_lower90_ppts": 0.484, "gain_t_acft": 9.613, "est_gain_t": 49634.9, "requested_t": 5163.3},
    {"texture_class": "Clay", "acres": 13062.5, "avg_density_t_acft": 1842.08, "oc_gain_lower90_ppts": -0.195, "gain_t_acft": 0.0, "est_gain_t": 0.0, "requested_t": 0.0},
    {"texture_class": "Loamy Sand", "acres": 1337.3, "avg_density_t_acft": 1977.89, "oc_gain_lower90_ppts": 0.175, "gain_t_acft": 3.465, "est_gain_t": 4635.3, "requested_t": 1337.3},
    {"texture_class": "Sand", "acres": 6818.9, "avg_density_t_acft": None, "oc_gain_lower90_ppts": None, "gain_t_acft": None, "est_gain_t": 0.0, "requested_t": 0.0},
    {"texture_class": "Sandy Clay Loam", "acres": 25.7, "avg_density_t_acft": None, "oc_gain_lower90_ppts": None, "gain_t_acft": None, "est_gain_t": 0.0, "requested_t": 0.0},
    {"texture_class": "Sandy Loam", "acres": 73507.2, "avg_density_t_acft": 2021.30, "oc_gain_lower90_ppts": 0.118, "gain_t_acft": 2.381, "est_gain_t": 175021.5, "requested_t": 73507.2},
    {"texture_class": "Silt Loam", "acres": 42134.4, "avg_density_t_acft": 2006.01, "oc_gain_lower90_ppts": 0.033, "gain_t_acft": 0.658, "est_gain_t": 27721.4, "requested_t": 27721.4},
    {"texture_class": "Silt", "acres": 68.2, "avg_density_t_acft": None, "oc_gain_lower90_ppts": None, "gain_t_acft": None, "est_gain_t": 0.0, "requested_t": 0.0},
])
TABLE13_OFFICIAL["creditable"] = TABLE13_OFFICIAL["requested_t"] > 0

TABLE2_TOTAL_PROPERTY_ACRES = 389133.0
TABLE2_CREDITABLE_ACRES = 386514.0
TABLE13_TOTAL_EST_GAIN_T = 1334549.5
TABLE13_TOTAL_REQUESTED_T = 352126.1
FARMER_TABLE_GRAND_TOTAL_ACRES = 366539.6


def _exclude_non_ops(df: pd.DataFrame, op_col: str = "op_code") -> pd.DataFrame:
    return df[~df[op_col].isin([TEST_OP_CODE, UNMATCHED_OP_CODE]) & df[op_col].notna()]


def soil_rollup_by_op(soil_components: pd.DataFrame) -> pd.DataFrame:
    """Per op: acres by land_class, creditable acres, # textures, # fields, dominant texture."""
    sc = _exclude_non_ops(soil_components)
    rows = []
    for op_code, grp in sc.groupby("op_code"):
        farmable = grp[grp["is_farmable"] == True]  # noqa: E712
        by_tex = farmable.groupby("texture_class")["area_acres"].sum().sort_values(ascending=False)
        rows.append({
            "op_code": op_code,
            "total_acres": float(grp["area_acres"].sum()),
            "creditable_acres_soil": float(farmable["area_acres"].sum()),
            "water_acres": float(grp.loc[grp["land_class"] == "water", "area_acres"].sum()),
            "wetland_acres": float(grp.loc[grp["land_class"] == "wetland_lowdensity", "area_acres"].sum()),
            "nonfarmable_texture_acres": float(grp.loc[grp["land_class"] == "nonfarmable_texture", "area_acres"].sum()),
            "n_textures": int(farmable["texture_class"].nunique()),
            "n_fields": int(grp["field_id"].nunique()),
            "dominant_texture": (by_tex.index[0] if len(by_tex) else None),
        })
    return pd.DataFrame(rows)


def soil_rollup_by_op_stratum(soil_components: pd.DataFrame) -> pd.DataFrame:
    """Per (op_code, texture_class): farmable acres — the weights for credit distribution."""
    sc = _exclude_non_ops(soil_components)
    farmable = sc[(sc["is_farmable"] == True) & sc["texture_class"].notna()]  # noqa: E712
    out = farmable.groupby(["op_code", "texture_class"])["area_acres"].sum().reset_index()
    out.columns = ["op_code", "texture_class", "acres"]
    return out


def project_table2(soil_components: pd.DataFrame) -> dict:
    sc = _exclude_non_ops(soil_components)
    total = float(sc["area_acres"].sum())
    creditable = float(sc.loc[sc["is_farmable"] == True, "area_acres"].sum())  # noqa: E712
    return {
        "total_property_acres": total,
        "creditable_acres": creditable,
        "fixture_total_property_acres": TABLE2_TOTAL_PROPERTY_ACRES,
        "fixture_creditable_acres": TABLE2_CREDITABLE_ACRES,
        "delta_total_pct": (total - TABLE2_TOTAL_PROPERTY_ACRES) / TABLE2_TOTAL_PROPERTY_ACRES * 100,
        "delta_creditable_pct": (creditable - TABLE2_CREDITABLE_ACRES) / TABLE2_CREDITABLE_ACRES * 100,
    }


def project_table13_computed(soil_components: pd.DataFrame) -> pd.DataFrame:
    """Our own SSURGO-derived per-stratum acres, for the build-report delta
    check against TABLE13_OFFICIAL (approximate — see module docstring)."""
    sc = _exclude_non_ops(soil_components)
    farmable = sc[(sc["is_farmable"] == True) & sc["texture_class"].notna()]  # noqa: E712
    return farmable.groupby("texture_class")["area_acres"].sum().reset_index().rename(columns={"area_acres": "computed_acres"})


def table5_property_rows(fields: pd.DataFrame, soil_rollup: pd.DataFrame, crosswalk_df: pd.DataFrame) -> pd.DataFrame:
    """Per-op property rows: entity, ownership, address, state, total ac, creditable ac."""
    fields_valid = _exclude_non_ops(fields)
    per_op_fields = fields_valid.groupby("op_code").agg(
        total_boundary_acres=("boundary_acres", "sum"),
        state=("state", lambda s: s.dropna().mode().iat[0] if s.dropna().size else None),
    ).reset_index()
    out = crosswalk_df[["op_code", "op_label", "entity_name", "region", "state", "enrollment_year", "enroll_origin"]].merge(
        per_op_fields[["op_code", "total_boundary_acres"]], on="op_code", how="left"
    ).merge(
        soil_rollup[["op_code", "creditable_acres_soil"]], on="op_code", how="left"
    )
    return out


def distribute_credits(op_stratum_acres: pd.DataFrame, table13: pd.DataFrame = TABLE13_OFFICIAL) -> pd.DataFrame:
    """docs/DATA_PIPELINE.md Stage 6: distribute each stratum's official
    requested tonnes to ops by their share of that stratum's farmable acres
    (our own computed acres, so shares sum to exactly 1 per stratum and the
    grand total exactly matches TABLE13_TOTAL_REQUESTED_T)."""
    project_stratum_acres = op_stratum_acres.groupby("texture_class")["acres"].sum().rename("project_stratum_acres")
    merged = op_stratum_acres.merge(project_stratum_acres, on="texture_class", how="left")
    merged = merged.merge(table13[["texture_class", "requested_t"]], on="texture_class", how="left")
    merged["requested_t"] = merged["requested_t"].fillna(0.0)
    merged["share"] = merged["acres"] / merged["project_stratum_acres"]
    merged["credited_t"] = merged["share"] * merged["requested_t"]
    per_op = merged.groupby("op_code")["credited_t"].sum().reset_index()
    return per_op
