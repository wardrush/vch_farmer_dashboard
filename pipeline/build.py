"""docs/DATA_PIPELINE.md — pipeline orchestrator. Idempotent; safe to rerun.

data/source/ -> data/canonical/ (parquet) -> web/public/data/ (baked JSON/GeoJSON)

Usage: python build.py [--adapter file]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import duckdb
import geopandas as gpd
import pandas as pd

import fabricate as fab
import geometry as geo
import rollups as ru
import samples_join as sj
from adapters import FileAdapter
from crosswalk import Crosswalk, TEST_OP_CODE, UNMATCHED_OP_CODE, load_or_build_crosswalk

REPO_ROOT = Path(__file__).resolve().parent.parent
CANON_DIR = REPO_ROOT / "data" / "canonical"
WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"

DOC_CHECKLIST = fab.DOC_CHECKLIST

# Allowlists (CLAUDE.md hard rule 2 / R8) — farmer-facing artifacts may ONLY
# contain these keys. Build fails loudly if a texture/stratum/soil key leaks.
FARMER_FORBIDDEN_SUBSTRINGS = [
    "texture", "stratum", "ssurgo", "mukey", "smf_cluster", "land_class",
    "soil", "musym", "component_pct", "sand_pct", "silt_pct", "clay_pct",
]


def check_farmer_allowlist(obj, artifact_name: str, path: str = "$") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = str(k).lower()
            for bad in FARMER_FORBIDDEN_SUBSTRINGS:
                if bad in kl:
                    raise AssertionError(
                        f"FARMER PRIVACY VIOLATION in {artifact_name} at {path}.{k}: "
                        f"key matches forbidden substring {bad!r} (CLAUDE.md rule 2 / R8)."
                    )
            check_farmer_allowlist(v, artifact_name, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, item in enumerate(obj[:50]):  # sample — lists can be huge (geojson features)
            check_farmer_allowlist(item, artifact_name, f"{path}[{i}]")


def _stringify_mixed_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Real source exports mix types within a column (e.g. samples lab_no /
    lab_result_id: numeric for DC rows, alphanumeric like "NW3282" for BD
    rows) — pyarrow requires a single type per column, so normalize to str."""
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == object:
            types = out[col].dropna().apply(type).unique()
            if len(types) > 1:
                out[col] = out[col].apply(lambda v: str(v) if pd.notna(v) else None)
    return out


def _sanitize_nan(obj):
    """Python's json.dump emits bare NaN/Infinity tokens by default, which
    are invalid JSON (JSON.parse rejects them) — pandas NaN leaks in from
    all-null source columns (e.g. the real distributor rows' bill_of_sale_at).
    Recursively convert to None."""
    if isinstance(obj, float) and (obj != obj or obj in (float("inf"), float("-inf"))):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_nan(v) for v in obj]
    return obj


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(_sanitize_nan(obj), f, default=str)


def write_geojson(path: Path, gdf: gpd.GeoDataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(path, driver="GeoJSON")


def main(adapter_kind: str = "file"):
    report_lines = ["# Build report\n"]
    assert adapter_kind == "file", "only the file adapter exists today (docs/ARCHITECTURE.md fast-follow: snowflake)"

    # NOTE: deliberately not deleting+recreating WEB_DATA_DIR on rebuild — this
    # folder lives under Proton Drive sync, and delete+recreate races with the
    # sync client create "Name clash" duplicate folders. Files are overwritten
    # in place instead (op_codes are stable across reruns unless the
    # crosswalk changes, so stale per-op files aren't a concern in practice).
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ---- Stage 1+2: load + crosswalk -------------------------------------
    adapter = FileAdapter()
    cw = Crosswalk(load_or_build_crosswalk())
    cw_df = cw.df
    report_lines.append(f"Crosswalk: {len(cw_df)} operations resolved.\n")

    fields_raw = adapter.fields()
    fields_raw["op_code"] = [cw.resolve_field(r.op_code_raw, r.last_busin_raw) for r in fields_raw.itertuples()]
    n_unresolved_fields = fields_raw["op_code"].isna().sum()
    report_lines.append(f"Fields: {len(fields_raw)} rows, {n_unresolved_fields} unresolved op_code.\n")

    sc_raw = adapter.soil_components()
    sc_raw["op_code"] = sc_raw["op_code_raw"].where(sc_raw["op_code_raw"].isin(cw.op_codes))
    n_unresolved_sc = sc_raw["op_code"].isna().sum()
    report_lines.append(f"Soil components: {len(sc_raw)} rows, {n_unresolved_sc} unresolved op_code.\n")

    samples_raw = adapter.samples()
    sample_rows = sj.build_sample_rows(samples_raw, cw)
    report_lines.append(
        f"Samples: {len(sample_rows)} rows -> "
        f"{(sample_rows['op_code']==TEST_OP_CODE).sum()} TEST, "
        f"{(sample_rows['op_code']==UNMATCHED_OP_CODE).sum()} UNMATCHED, "
        f"{(~sample_rows['op_code'].isin([TEST_OP_CODE,UNMATCHED_OP_CODE])).sum()} resolved to real ops.\n"
    )

    farmer_table = adapter.farmer_table()
    farmer_table["op_code"] = farmer_table["farmer_table_name"].apply(cw.resolve)
    n_unresolved_ft = farmer_table["op_code"].isna().sum()
    report_lines.append(f"Farmer table: {len(farmer_table)} rows, {n_unresolved_ft} unresolved.\n")

    enrollments_real = adapter.enrollments()
    enrollments_real["op_code"] = [cw.resolve(r.entity_name or r.farmer_name) for r in enrollments_real.itertuples()]

    op_codes = sorted(cw.op_codes)

    # ---- Stage 3: geometry -------------------------------------------------
    fields_valid = fields_raw.dropna(subset=["op_code"]).copy()
    clusters = geo.compute_clusters(fields_valid)
    fields_4326 = geo.reproject_to_4326(fields_valid)
    fields_4326 = geo.add_web_geometry(fields_4326)
    bboxes = geo.cluster_bboxes(fields_4326, clusters)
    op_bounds_df = geo.op_bounds(fields_4326)
    proj_bounds = geo.project_bounds(fields_4326)

    # ---- Stage 4: soil rollups ---------------------------------------------
    soil_by_op = ru.soil_rollup_by_op(sc_raw)
    soil_by_op = soil_by_op.set_index("op_code")
    table2 = ru.project_table2(sc_raw)
    report_lines.append(
        f"\n## Table 2 fixture\ncomputed total={table2['total_property_acres']:.1f} "
        f"(fixture {table2['fixture_total_property_acres']}, delta {table2['delta_total_pct']:.2f}%)\n"
        f"computed creditable={table2['creditable_acres']:.1f} "
        f"(fixture {table2['fixture_creditable_acres']}, delta {table2['delta_creditable_pct']:.2f}%)\n"
    )
    assert abs(table2["delta_total_pct"]) < 0.5, "Table 2 total acres fixture FAILED (CLAUDE.md rule 6)"
    assert abs(table2["delta_creditable_pct"]) < 0.5, "Table 2 creditable acres fixture FAILED (CLAUDE.md rule 6)"

    computed_table13 = ru.project_table13_computed(sc_raw)
    report_lines.append("\n## Table 13 acres — computed (soil_component) vs official\n")
    for _, r in ru.TABLE13_OFFICIAL.iterrows():
        comp = computed_table13.loc[computed_table13["texture_class"] == r["texture_class"], "computed_acres"]
        comp_val = float(comp.iloc[0]) if len(comp) else 0.0
        delta = (comp_val - r["acres"]) / r["acres"] * 100 if r["acres"] else 0.0
        report_lines.append(f"- {r['texture_class']}: computed={comp_val:.1f} official={r['acres']} delta={delta:.2f}%\n")

    op_stratum_acres = ru.soil_rollup_by_op_stratum(sc_raw)
    credited_by_op = ru.distribute_credits(op_stratum_acres).set_index("op_code")["credited_t"]
    total_credited = credited_by_op.sum()
    delta_credited = abs(total_credited - ru.TABLE13_TOTAL_REQUESTED_T) / ru.TABLE13_TOTAL_REQUESTED_T * 100
    report_lines.append(f"\n## Table 13 credited_t total: {total_credited:.1f} (fixture {ru.TABLE13_TOTAL_REQUESTED_T}, delta {delta_credited:.4f}%)\n")
    assert delta_credited < 0.5, "Table 13 requested_t fixture FAILED (CLAUDE.md rule 6)"

    # Eeg Brothers (24-18) has no soil_component rows in this snapshot (see
    # crosswalk.py note) -> falls back to project-average credited/creditable-
    # acre ratio applied to his real farmer-table creditable acres.
    avg_credited_per_acre = ru.TABLE13_TOTAL_REQUESTED_T / ru.TABLE2_CREDITABLE_ACRES
    for op_code in op_codes:
        if op_code not in credited_by_op.index:
            ft_row = farmer_table[farmer_table["op_code"] == op_code]
            creditable_acres = float(ft_row["creditable_acres"].iloc[0]) if len(ft_row) else 0.0
            credited_by_op.loc[op_code] = round(creditable_acres * avg_credited_per_acre, 1)

    farmer_table_by_op = farmer_table.dropna(subset=["op_code"]).set_index("op_code")

    from source_schemas import FARMER_TABLE_ALL_ROWS
    ft_all = FARMER_TABLE_ALL_ROWS.load()
    ft_total = ft_all["creditable_acres"].sum()
    delta_ft = abs(ft_total - ru.FARMER_TABLE_GRAND_TOTAL_ACRES) / ru.FARMER_TABLE_GRAND_TOTAL_ACRES * 100
    report_lines.append(f"\n## Farmer table grand total (incl. Unassigned): {ft_total:.1f} (fixture {ru.FARMER_TABLE_GRAND_TOTAL_ACRES}, delta {delta_ft:.4f}%)\n")
    assert delta_ft < 0.5, "Farmer table grand total fixture FAILED (CLAUDE.md rule 6)"

    # ---- Stage 5: sample stats (analyst display) ----------------------------
    points = sj.summarize_points(sample_rows)
    project_stratum_stats = sj.compute_stratum_stats(sample_rows)
    report_lines.append("\n## Computed (real-sample) vs official Table 13 gain figures (analyst display only; deltas expected)\n")
    for _, r in project_stratum_stats.iterrows():
        off = ru.TABLE13_OFFICIAL[ru.TABLE13_OFFICIAL["texture_class"] == r["texture_class"]]
        off_gain = float(off["oc_gain_lower90_ppts"].iloc[0]) if len(off) and pd.notna(off["oc_gain_lower90_ppts"].iloc[0]) else None
        report_lines.append(f"- {r['texture_class']}: computed_lower90={r['oc_gain_lower90_ppts']:.3f} official={off_gain}\n")

    # ---- Stage 7: fabrication ------------------------------------------------
    stage_assignment = fab.assign_current_stages(op_codes)
    status_events = fab.build_status_events(op_codes, stage_assignment)
    project_years = fab.build_project_years(op_codes, stage_assignment)

    credit_2024_rows = [fab.fabricate_2024_credit_ledger(op, float(credited_by_op.get(op, 0.0))) for op in fab.REAL_2024_HISTORY_OPS]
    credit_2024_by_op = {r["op_code"]: r for r in credit_2024_rows}

    grower_since_by_op = {op: fab.fabricate_grower_since(op) for op in op_codes}

    op_boundary_acres = fields_valid.groupby("op_code")["boundary_acres"].sum().to_dict()
    fabricated_enrollments = fab.fabricate_enrollments(op_codes, op_boundary_acres)

    # ---- macro/micro derivation --------------------------------------------
    def current_micro_for(op_code: str, project_year_id: str) -> str:
        evs = [e for e in status_events if e["op_code"] == op_code and e["project_year_id"] == project_year_id]
        if not evs:
            return "enrollment_began"
        best = max(evs, key=lambda e: (fab.STAGE_INDEX[e["stage"]], e["entered_at"]))
        return best["stage"]

    def macro_stage_for(op_code: str) -> str:
        has_history = op_code in fab.REAL_2024_HISTORY_OPS
        if has_history:
            y1_micro = current_micro_for(op_code, f"{fab.HISTORY_PROJECT_ID}-Y1")
            y2_micro = current_micro_for(op_code, f"{fab.CURRENT_PROJECT_ID}-Y2")
        else:
            y1_micro = current_micro_for(op_code, f"{fab.CURRENT_PROJECT_ID}-Y1")
            y2_micro = None
        y1_idx = fab.STAGE_INDEX[y1_micro]
        if y2_micro and fab.STAGE_INDEX[y2_micro] >= fab.STAGE_INDEX["credits_available"]:
            return "year2_completed"
        if y1_idx >= fab.STAGE_INDEX["credits_available"]:
            return "year1_completed"
        if y1_idx >= fab.STAGE_INDEX["baseline_sampling_completed"]:
            return "baseline_gathered"
        return "enrollment_submitted"

    # ---- assemble per-op frames ---------------------------------------------
    op_label_map = cw_df.set_index("op_code")["op_label"].to_dict()
    op_entity_map = cw_df.set_index("op_code")["entity_name"].to_dict()
    op_region_map = cw_df.set_index("op_code")["region"].to_dict()
    op_state_map = cw_df.set_index("op_code")["state"].to_dict()
    op_enroll_origin_map = cw_df.set_index("op_code")["enroll_origin"].to_dict()

    ops_index = []
    for op_code in op_codes:
        current_pyid = f"{fab.CURRENT_PROJECT_ID}-Y2" if op_code in fab.REAL_2024_HISTORY_OPS else f"{fab.CURRENT_PROJECT_ID}-Y1"
        micro = current_micro_for(op_code, current_pyid)
        n_fields = int(fields_valid.loc[fields_valid["op_code"] == op_code, "field_id"].nunique())
        acres = float(op_boundary_acres.get(op_code, 0.0))
        ops_index.append({
            "op_code": op_code,
            "op_label": op_label_map.get(op_code),
            "state": op_state_map.get(op_code),
            "region": op_region_map.get(op_code),
            "enroll_origin": op_enroll_origin_map.get(op_code),
            "acres": round(acres, 1),
            "n_fields": n_fields,
            "n_samples": int((sample_rows["op_code"] == op_code).sum()),
            "grower_since": grower_since_by_op[op_code],
            "macro_stage": macro_stage_for(op_code),
            "micro_stage": micro,
            "measured_gain_t": float(farmer_table_by_op.loc[op_code, "measured_gain_t"]) if op_code in farmer_table_by_op.index else None,
            "creditable_acres": float(farmer_table_by_op.loc[op_code, "creditable_acres"]) if op_code in farmer_table_by_op.index else None,
            "credited_t": round(float(credited_by_op.get(op_code, 0.0)), 1),
        })
    write_json(WEB_DATA_DIR / "ops" / "index.json", ops_index)

    # per-op artifacts
    for op_code in op_codes:
        has_history = op_code in fab.REAL_2024_HISTORY_OPS
        projects = []
        current_pyid = f"{fab.CURRENT_PROJECT_ID}-Y2" if has_history else f"{fab.CURRENT_PROJECT_ID}-Y1"
        current_micro = current_micro_for(op_code, current_pyid)
        op_fields = fields_4326[fields_4326["op_code"] == op_code]
        op_field_acres = float(op_fields["boundary_acres"].sum())
        op_bboxes = bboxes[bboxes["op_code"] == op_code]
        cluster_bboxes_out = [
            {"cluster_id": int(r.cluster_id), "min_lon": r.min_lon, "min_lat": r.min_lat,
             "max_lon": r.max_lon, "max_lat": r.max_lat, "field_count": int(r.field_count), "acres": round(r.acres, 1)}
            for r in op_bboxes.itertuples()
        ]
        ob = op_bounds_df[op_bounds_df["op_code"] == op_code]
        op_bounds_out = (
            {"min_lon": float(ob.min_lon.iloc[0]), "min_lat": float(ob.min_lat.iloc[0]),
             "max_lon": float(ob.max_lon.iloc[0]), "max_lat": float(ob.max_lat.iloc[0])}
            if len(ob) else None
        )

        if has_history:
            projects.append({
                "project_year_id": f"{fab.HISTORY_PROJECT_ID}-Y1",
                "year_index": 1,
                "season_span": "S24 -> F24",
                "micro_stage": "credits_available",
                "acres": op_field_acres,  # same underlying fields
                "credited_t": credit_2024_by_op[op_code]["credited_t"],
                "credit_status": "distributed",
                "distributed_usd": credit_2024_by_op[op_code]["distributed_usd"],
            })
        projects.append({
            "project_year_id": current_pyid,
            "year_index": 2 if has_history else 1,
            "season_span": "S25 -> F25",
            "micro_stage": current_micro,
            "acres": round(op_field_acres, 1),
            "credited_t": round(float(credited_by_op.get(op_code, 0.0)), 1),
            "credit_status": "requested" if fab.STAGE_INDEX[current_micro] >= fab.STAGE_INDEX["project_submitted"] else "not_yet_submitted",
        })

        submitted_events = [e for e in status_events if e["op_code"] == op_code and e["project_year_id"] == current_pyid and e["stage"] == "project_submitted"]
        submitted_at = submitted_events[0]["entered_at"] if submitted_events else None

        profile = {
            "op_code": op_code,
            "op_label": op_label_map.get(op_code),
            "entity_name": op_entity_map.get(op_code),
            "grower_since": grower_since_by_op[op_code],
            "macro_stage": macro_stage_for(op_code),
            "current_project_year_id": current_pyid,
            "current_micro_stage": current_micro,
            "projects": projects,
            "acres_submitted": round(op_field_acres, 1),
            "n_fields": int(op_fields["field_id"].nunique()),
            "submitted_at": submitted_at,
            "true_up_year": fab.TRUEUP_YEAR,
            # Always present — R7's "only show once submitted" gate is UI
            # presentation logic applied against LIVE status client-side
            # (docs/ARCHITECTURE.md live status), not a data-availability
            # restriction. Baking a null here would break the demo's "admin
            # advances a grower past project_submitted -> credits appear"
            # flow for any op the browser session advances past that point.
            "credited_t": round(float(credited_by_op.get(op_code, 0.0)), 1),
            "credits_distributed_to_date": credit_2024_by_op[op_code]["distributed_usd"] if has_history else None,
            "credits_distributed_t_to_date": credit_2024_by_op[op_code]["credited_t"] if has_history else None,
            "cluster_bboxes": cluster_bboxes_out,
            "op_bounds": op_bounds_out,
            "demo_fabricated_status": True,
        }
        check_farmer_allowlist(profile, f"ops/{op_code}/profile.json")
        write_json(WEB_DATA_DIR / "ops" / op_code / "profile.json", profile)

        fields_out = op_fields[["field_id", "field_name", "boundary_acres", "geometry_web"]].rename(
            columns={"geometry_web": "geometry", "boundary_acres": "acres"}
        )
        fields_out = gpd.GeoDataFrame(fields_out, geometry="geometry", crs="EPSG:4326")
        if len(fields_out):
            geojson_obj = json.loads(fields_out.to_json())
            check_farmer_allowlist(geojson_obj, f"ops/{op_code}/fields.web.geojson")
            write_json(WEB_DATA_DIR / "ops" / op_code / "fields.web.geojson", geojson_obj)
        else:
            write_json(WEB_DATA_DIR / "ops" / op_code / "fields.web.geojson", {"type": "FeatureCollection", "features": []})

        op_enrollments = [e for e in fabricated_enrollments if e["op_code"] == op_code]
        for e in op_enrollments:
            e["farmer_name"] = op_label_map.get(op_code)
            e["entity_name"] = op_entity_map.get(op_code)
        credits_distributed = credit_2024_by_op[op_code]["distributed_usd"] if has_history else 0
        enrollments_payload = {
            "op_code": op_code,
            "rollup": {
                "total_acres": round(sum(e["total_acreage"] for e in op_enrollments), 1),
                "grower_since": grower_since_by_op[op_code],
                "credits_distributed_usd": credits_distributed if credits_distributed else None,
            },
            "enrollments": op_enrollments,
        }
        check_farmer_allowlist(enrollments_payload, f"ops/{op_code}/enrollments.json")
        write_json(WEB_DATA_DIR / "ops" / op_code / "enrollments.json", enrollments_payload)

        # analyst per-op artifacts (no allowlist — analyst-only)
        op_strat = sj.compute_stratum_stats(sample_rows, scope_op_code=op_code)
        op_soil = sc_raw[(sc_raw["op_code"] == op_code) & (sc_raw["is_farmable"] == True) & sc_raw["texture_class"].notna()]  # noqa: E712
        op_acres_by_tex = op_soil.groupby("texture_class")["area_acres"].sum().reset_index().rename(columns={"area_acres": "acres"})
        op_strat = op_strat.merge(op_acres_by_tex, on="texture_class", how="outer")
        op_strat["est_gain_t"] = op_strat["gain_t_acft"] * op_strat["acres"]
        op_strat["creditable"] = (op_strat["oc_gain_lower90_ppts"] > 0) & (op_strat["n_plss_sections"] >= 5)
        strat_json = {
            "op_code": op_code,
            "n_textures": int(op_strat["texture_class"].notna().sum()),
            "total_acres": float(op_soil["area_acres"].sum()),
            "creditable_acres": float(farmer_table_by_op.loc[op_code, "creditable_acres"]) if op_code in farmer_table_by_op.index else None,
            "n_fields": int(op_fields["field_id"].nunique()),
            "n_samples": int((sample_rows["op_code"] == op_code).sum()),
            "strata": json.loads(op_strat.to_json(orient="records")),
        }
        write_json(WEB_DATA_DIR / "analyst" / "ops" / op_code / "strat.json", strat_json)

        op_points = points[points["op_code"] == op_code].copy()
        if len(op_points):
            gdf_points = gpd.GeoDataFrame(
                op_points.drop(columns=["lat", "lon"]),
                geometry=gpd.points_from_xy(op_points["lon"], op_points["lat"]),
                crs="EPSG:4326",
            )
            write_geojson(WEB_DATA_DIR / "analyst" / "ops" / op_code / "samples.geojson", gdf_points)
            op_sample_rows = sample_rows[sample_rows["op_code"] == op_code]
            op_sample_rows.to_csv(WEB_DATA_DIR / "analyst" / "ops" / op_code / "samples.csv", index=False)
        else:
            write_json(WEB_DATA_DIR / "analyst" / "ops" / op_code / "samples.geojson", {"type": "FeatureCollection", "features": []})

    # ---- status-seed.json ----------------------------------------------------
    write_json(WEB_DATA_DIR / "status-seed.json", {"events": status_events})

    # ---- admin/enrollments-all.json (analyst/admin-only) ----------------------
    # docs/specs/admin.md: the admin grid must show unresolved real rows too
    # (op_code UNRESOLVED, flagged red) — crosswalk hygiene surfacing (R10).
    all_enrollment_rows = []
    for e in fabricated_enrollments:
        row = dict(e)
        row["farmer_name"] = op_label_map.get(row["op_code"])
        row["entity_name"] = op_entity_map.get(row["op_code"])
        all_enrollment_rows.append(row)
    for r in enrollments_real.itertuples():
        all_enrollment_rows.append({
            "enrollment_id": r.enrollment_id,
            "op_code": r.op_code if pd.notna(r.op_code) else "UNRESOLVED",
            "farmer_name": r.farmer_name,
            "entity_name": r.entity_name,
            "distributor": r.distributor,
            "total_acreage": r.total_acreage,
            "billed_acreage": r.billed_acreage,
            "tote_count": r.tote_count,
            "status": r.status_raw,
            "bill_of_sale_at": r.bill_of_sale_at,
            "submitted_at": None,
            "docs_received": [],
            "docs_needed": [],
            "demo_fabricated": False,
        })
    write_json(WEB_DATA_DIR / "admin" / "enrollments-all.json", all_enrollment_rows)

    # ---- analyst/project/summary.json -----------------------------------------
    summary = {
        "table2": table2,
        "table13_official": json.loads(ru.TABLE13_OFFICIAL.to_json(orient="records")),
        "table13_computed_acres": json.loads(computed_table13.to_json(orient="records")),
        "table13_computed_sample_stats": json.loads(project_stratum_stats.to_json(orient="records")),
        "total_credited_t": round(float(total_credited), 1),
        "total_measured_gain_t": round(float(farmer_table["measured_gain_t"].sum()), 1),
        "fixtures": {
            "table2_total_property_acres": ru.TABLE2_TOTAL_PROPERTY_ACRES,
            "table2_creditable_acres": ru.TABLE2_CREDITABLE_ACRES,
            "table13_total_est_gain_t": ru.TABLE13_TOTAL_EST_GAIN_T,
            "table13_total_requested_t": ru.TABLE13_TOTAL_REQUESTED_T,
            "farmer_table_grand_total_acres": ru.FARMER_TABLE_GRAND_TOTAL_ACRES,
        },
    }
    write_json(WEB_DATA_DIR / "analyst" / "project" / "summary.json", summary)

    # ---- analyst/fields-status.web.geojson ------------------------------------
    status_class_map = {
        "enrollment_began": "pre_submission", "all_files_submitted": "pre_submission",
        "maps_approved": "pre_submission", "baseline_samples_requested": "pre_submission",
        "baseline_sampling_completed": "pre_submission", "post_season_sampling_completed": "pre_submission",
        "lab_data_received": "pre_submission", "project_submitted": "submitted",
        "project_validated": "validated", "credits_available": "credited",
    }
    op_micro_map = {row["op_code"]: row["micro_stage"] for row in ops_index}
    periods_covered_map = sample_rows[~sample_rows["op_code"].isin([TEST_OP_CODE, UNMATCHED_OP_CODE])].groupby("op_code")["period"].apply(lambda s: sorted(set(s))).to_dict()

    status_fields = fields_4326[["field_id", "op_code", "geometry_web"]].rename(columns={"geometry_web": "geometry"}).copy()
    status_fields["op_label"] = status_fields["op_code"].map(op_label_map)
    status_fields["status_class"] = status_fields["op_code"].map(op_micro_map).map(status_class_map)
    status_fields["periods_covered"] = status_fields["op_code"].apply(
        lambda op: "S25+F25" if {"S25", "F25"}.issubset(set(periods_covered_map.get(op, []))) else "S25_only"
    )
    status_fields["geometry"] = status_fields.geometry.simplify(0.0002, preserve_topology=True)
    status_gdf = gpd.GeoDataFrame(status_fields, geometry="geometry", crs="EPSG:4326")
    write_geojson(WEB_DATA_DIR / "analyst" / "fields-status.web.geojson", status_gdf)

    # ---- analyst/qa.json --------------------------------------------------------
    unresolved_path = CANON_DIR / "_unresolved.csv"
    unresolved_records = pd.read_csv(unresolved_path).to_dict(orient="records") if unresolved_path.exists() else []
    resolution_counts = cw_df["resolution"].value_counts().to_dict()
    unmatched_samples = sample_rows[sample_rows["op_code"] == UNMATCHED_OP_CODE]
    outlier_counts = {
        "spatial": sample_rows["outlier_spatial_tier"].value_counts(dropna=True).to_dict(),
        "toc": sample_rows["outlier_toc_tier"].value_counts(dropna=True).to_dict(),
        "bd_flag": sample_rows["outlier_bd_flag"].value_counts(dropna=True).to_dict(),
    }
    qa = {
        "crosswalk_resolution_counts": resolution_counts,
        "unresolved_variants": unresolved_records,
        "n_unmatched_samples": int(len(unmatched_samples)),
        "unmatched_samples_preview": json.loads(unmatched_samples[["lab_result_id", "customer_raw", "farm_business_raw", "period", "trs"]].head(50).to_json(orient="records")),
        "outlier_counts": outlier_counts,
        "unresolved_enrollments": json.loads(enrollments_real[enrollments_real["op_code"].isna()][["enrollment_id", "farmer_name", "entity_name"]].to_json(orient="records")),
    }
    write_json(WEB_DATA_DIR / "analyst" / "qa.json", qa)

    # ---- DuckDB export -----------------------------------------------------------
    duckdb_path = WEB_DATA_DIR / "analyst" / "vch_demo.duckdb"
    duckdb_path.parent.mkdir(parents=True, exist_ok=True)
    if duckdb_path.exists():
        duckdb_path.unlink()
    fields_out_df = _stringify_mixed_columns(pd.DataFrame(fields_valid.drop(columns=["geometry"])))
    soil_components_out_df = _stringify_mixed_columns(pd.DataFrame(sc_raw.drop(columns=["geometry"])))
    samples_out_df = _stringify_mixed_columns(pd.DataFrame(sample_rows))

    con = duckdb.connect(str(duckdb_path))
    con.register("operations", cw_df)
    con.execute("CREATE TABLE operations AS SELECT * FROM operations")
    con.register("fields_df", fields_out_df)
    con.execute("CREATE TABLE fields AS SELECT * FROM fields_df")
    con.register("soil_components_df", soil_components_out_df)
    con.execute("CREATE TABLE soil_components AS SELECT * FROM soil_components_df")
    con.register("samples_df", samples_out_df)
    con.execute("CREATE TABLE samples AS SELECT * FROM samples_df")
    con.register("ops_index_df", pd.DataFrame(ops_index))
    con.execute("CREATE TABLE ops_index AS SELECT * FROM ops_index_df")
    con.register("status_events_df", pd.DataFrame(status_events))
    con.execute("CREATE TABLE status_events AS SELECT * FROM status_events_df")
    con.close()

    # ---- canonical parquet (data/canonical/) --------------------------------------
    CANON_DIR.mkdir(parents=True, exist_ok=True)
    fields_out_df.to_parquet(CANON_DIR / "field.parquet")
    soil_components_out_df.to_parquet(CANON_DIR / "soil_component.parquet")
    samples_out_df.to_parquet(CANON_DIR / "sample_point.parquet")
    pd.DataFrame(ops_index).to_parquet(CANON_DIR / "operation_summary.parquet")

    # ---- build report -----------------------------------------------------------
    report_lines.append(f"\n## Artifact sizes\n")
    total_size = 0
    for p in sorted(WEB_DATA_DIR.rglob("*")):
        if p.is_file():
            total_size += p.stat().st_size
    report_lines.append(f"Total web/public/data size: {total_size/1e6:.2f} MB\n")
    report_lines.append("\n## Allowlist check: PASS (no forbidden keys found in farmer artifacts)\n")

    (CANON_DIR / "build_report.md").write_text("".join(report_lines))
    print("".join(report_lines))
    print(f"\nBuild complete. Artifacts in {WEB_DATA_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", default="file", choices=["file", "snowflake"])
    args = parser.parse_args()
    main(adapter_kind=args.adapter)
