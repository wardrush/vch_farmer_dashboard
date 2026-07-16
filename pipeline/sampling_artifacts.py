"""Bake the input artifacts the interactive Sampling tool consumes.

The sampling *engine* runs client-side (web/src/lib/sampling.ts) so the sliders,
clustering, and manual point edits are instant. This module bakes the read-only
inputs it needs, per operation:

  web/public/data/sampling/index.json              -- op picker
  web/public/data/sampling/ops/{op}/strata.json    -- per-texture stratum stats
  web/public/data/sampling/ops/{op}/fields.strat.geojson
                                                   -- field polygons + texture
                                                      + fabricated elevation

No raw source column names appear here -- everything reads from the canonical
parquet + the already-simplified web GeoJSON (Hard rule 1). Elevation is
fabricated (Hard rule 5); every field carries demo_fabricated on its elevation
block, and strata.json is flagged at the top level.

Run:  python -m pipeline.sampling_artifacts     (from repo root)
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import duckdb

from pipeline.elevation import field_elevation_stats

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "data" / "canonical"
WEB_DATA = ROOT / "web" / "public" / "data"
OPS_DIR = WEB_DATA / "ops"
STRAT_DIR = WEB_DATA / "analyst" / "ops"
OUT_DIR = WEB_DATA / "sampling"

# Below this relief a stratum is treated as flat -> a single centroid rather
# than a low/high elevation pair. Metres. (Demo threshold; exposed in the UI.)
DEFAULT_RELIEF_THRESHOLD_M = 6.0


def _con() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute(f"create view field as select * from '{CANON / 'field.parquet'}'")
    con.execute(f"create view soil as select * from '{CANON / 'soil_component.parquet'}'")
    con.execute(f"create view samples as select * from '{CANON / 'sample_point.parquet'}'")
    con.execute(f"create view opsum as select * from '{CANON / 'operation_summary.parquet'}'")
    return con


def _load_strat_json(op: str) -> dict | None:
    p = STRAT_DIR / op / "strat.json"
    if not p.exists():
        return None
    return json.loads(p.read_text())


def _toc_sd_by_texture(con, op: str) -> dict[str, float]:
    """Within-stratum SD of monitoring TOC%, used as the demo variance input to
    the CI-optimisation math. Real where samples exist; caller fabricates when
    a stratum has no priors."""
    rows = con.execute(
        """
        select texture_class, stddev_samp(toc_pct) as sd, count(*) n
        from samples
        where op_code = ? and toc_pct is not null and texture_class is not null
        group by texture_class
        """,
        [op],
    ).fetchall()
    out: dict[str, float] = {}
    for tex, sd, n in rows:
        if tex and sd is not None and n >= 3:
            out[tex] = float(sd)
    return out


def _texture_component_stats(con, op: str) -> dict[str, dict]:
    """Area-weighted bulk density + sand/silt/clay per texture, from SSURGO
    components. Used for the density-aware sampling weight and tooltips."""
    rows = con.execute(
        """
        select texture_class,
               sum(area_acres)                                   as comp_acres,
               sum(bulk_density_g_cm3 * area_acres)
                 / nullif(sum(case when bulk_density_g_cm3 is not null then area_acres end),0) as bd,
               sum(sand_pct * area_acres) / nullif(sum(area_acres),0) as sand,
               sum(silt_pct * area_acres) / nullif(sum(area_acres),0) as silt,
               sum(clay_pct * area_acres) / nullif(sum(area_acres),0) as clay
        from soil
        where op_code = ? and texture_class is not null
        group by texture_class
        """,
        [op],
    ).fetchall()
    out: dict[str, dict] = {}
    for tex, comp_acres, bd, sand, silt, clay in rows:
        out[tex] = {
            "component_acres": round(float(comp_acres), 1) if comp_acres is not None else None,
            "avg_bulk_density_g_cm3": round(float(bd), 3) if bd is not None else None,
            "sand_pct": round(float(sand), 1) if sand is not None else None,
            "silt_pct": round(float(silt), 1) if silt is not None else None,
            "clay_pct": round(float(clay), 1) if clay is not None else None,
        }
    return out


def _field_rows(con, op: str) -> dict[int, dict]:
    rows = con.execute(
        """
        select field_id, dom_texture_class, geom_acres, boundary_acres, farmable_acres
        from field where op_code = ?
        """,
        [op],
    ).fetchall()
    out: dict[int, dict] = {}
    for fid, tex, gac, bac, fac in rows:
        out[int(fid)] = {
            "dom_texture_class": tex,
            "geom_acres": float(gac) if gac is not None else None,
            "boundary_acres": float(bac) if bac is not None else None,
            "farmable_acres": float(fac) if fac is not None else None,
        }
    return out


def build_op(con, op: str, op_label: str, region: str | None, state: str | None) -> dict | None:
    gj_path = OPS_DIR / op / "fields.web.geojson"
    if not gj_path.exists():
        return None
    geojson = json.loads(gj_path.read_text())
    field_meta = _field_rows(con, op)
    comp_stats = _texture_component_stats(con, op)
    toc_sd = _toc_sd_by_texture(con, op)
    strat = _load_strat_json(op)
    prior_by_tex: dict[str, dict] = {}
    if strat:
        for s in strat.get("strata", []):
            prior_by_tex[s["texture_class"]] = s

    # ---- per-field geojson with texture + fabricated elevation ----
    out_features = []
    tex_acres: dict[str, float] = {}
    tex_fields: dict[str, int] = {}
    tex_elev_min: dict[str, float] = {}
    tex_elev_max: dict[str, float] = {}
    op_has_relief_split = False
    for feat in geojson["features"]:
        props = feat["properties"]
        fid = int(props.get("field_id"))
        meta = field_meta.get(fid, {})
        texture = meta.get("dom_texture_class")
        acres = props.get("acres") or meta.get("geom_acres") or 0.0
        elev = field_elevation_stats(feat["geometry"])
        elev["demo_fabricated"] = True

        if texture:
            tex_acres[texture] = tex_acres.get(texture, 0.0) + float(acres)
            tex_fields[texture] = tex_fields.get(texture, 0) + 1
            emin, emax = elev.get("elev_min_m"), elev.get("elev_max_m")
            if emin is not None:
                tex_elev_min[texture] = min(tex_elev_min.get(texture, emin), emin)
            if emax is not None:
                tex_elev_max[texture] = max(tex_elev_max.get(texture, emax), emax)

        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "field_id": fid,
                    "field_name": props.get("field_name"),
                    "acres": round(float(acres), 2),
                    "texture_class": texture,
                    "farmable_acres": round(float(meta.get("farmable_acres") or acres), 2),
                    "elev_min_m": elev["elev_min_m"],
                    "elev_max_m": elev["elev_max_m"],
                    "elev_mean_m": elev["elev_mean_m"],
                    "relief_m": elev["relief_m"],
                    "low_pt": elev["low_pt"],
                    "high_pt": elev["high_pt"],
                },
                "geometry": feat["geometry"],
            }
        )

    out_op = OUT_DIR / "ops" / op
    out_op.mkdir(parents=True, exist_ok=True)
    (out_op / "fields.strat.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": out_features})
    )

    # ---- per-texture stratum table ----
    total_acres = sum(tex_acres.values())
    strata_out = []
    for tex in sorted(tex_acres):
        acres = tex_acres[tex]
        emin = tex_elev_min.get(tex)
        emax = tex_elev_max.get(tex)
        stratum_relief = (emax - emin) if (emin is not None and emax is not None) else 0.0
        if stratum_relief >= DEFAULT_RELIEF_THRESHOLD_M:
            op_has_relief_split = True
        comp = comp_stats.get(tex, {})
        prior = prior_by_tex.get(tex, {})
        sd = toc_sd.get(tex)
        strata_out.append(
            {
                "texture_class": tex,
                "acres": round(acres, 1),
                "acres_share_pct": round(100.0 * acres / total_acres, 2) if total_acres else 0.0,
                "n_fields": tex_fields.get(tex, 0),
                "stratum_relief_m": round(stratum_relief, 1),
                "stratum_elev_min_m": round(emin, 1) if emin is not None else None,
                "stratum_elev_max_m": round(emax, 1) if emax is not None else None,
                "elevation_split_eligible": stratum_relief >= DEFAULT_RELIEF_THRESHOLD_M,
                "avg_bulk_density_g_cm3": comp.get("avg_bulk_density_g_cm3"),
                "sand_pct": comp.get("sand_pct"),
                "silt_pct": comp.get("silt_pct"),
                "clay_pct": comp.get("clay_pct"),
                # prior-year inputs (null when this is a naive / never-sampled stratum)
                "prior_n_baseline": prior.get("n_points_baseline"),
                "prior_n_monitoring": prior.get("n_points_monitoring"),
                "prior_oc_gain_ppts": prior.get("oc_gain_ppts"),
                "prior_oc_gain_lower90_ppts": prior.get("oc_gain_lower90_ppts"),
                "prior_creditable": prior.get("creditable"),
                # variance input for the CI math; real SD where sampled,
                # else a fabricated fallback the client fills in.
                "toc_sd_pct": round(sd, 4) if sd is not None else None,
                "toc_sd_source": "measured" if sd is not None else "fabricated",
            }
        )

    strata_payload = {
        "op_code": op,
        "op_label": op_label,
        "region": region,
        "state": state,
        "total_acres": round(total_acres, 1),
        "n_fields": len(out_features),
        "n_textures": len(strata_out),
        "relief_threshold_m": DEFAULT_RELIEF_THRESHOLD_M,
        "has_prior_samples": bool(prior_by_tex),
        "demo_fabricated_elevation": True,
        "strata": strata_out,
    }
    (out_op / "strata.json").write_text(json.dumps(strata_payload))

    return {
        "op_code": op,
        "op_label": op_label,
        "region": region,
        "state": state,
        "n_fields": len(out_features),
        "acres": round(total_acres, 1),
        "n_textures": len(strata_out),
        "has_prior_samples": bool(prior_by_tex),
        "has_elevation_split": op_has_relief_split,
    }


def main() -> None:
    con = _con()
    ops = con.execute(
        """
        select op_code, op_label as label, region, state
        from opsum
        where op_code is not null
        order by op_code
        """
    ).fetchall()

    index = []
    for op, label, region, state in ops:
        # prefer the analyst profile label when present
        prof = OPS_DIR / op / "profile.json"
        op_label = label or op
        if prof.exists():
            try:
                op_label = json.loads(prof.read_text()).get("op_label", op_label)
            except Exception:
                pass
        row = build_op(con, op, op_label, region, state)
        if row:
            index.append(row)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "index.json").write_text(
        json.dumps(
            {
                "generated_from": "canonical parquet + web geojson",
                "demo_fabricated_elevation": True,
                "n_ops": len(index),
                "ops": index,
            }
        )
    )
    print(f"sampling artifacts: {len(index)} ops -> {OUT_DIR}")


if __name__ == "__main__":
    main()
