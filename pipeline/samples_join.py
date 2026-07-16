"""docs/DATA_PIPELINE.md Stage 5 — samples + lab join (analyst-only).

Groups DC+BD lab rows into composite sample_point records (one physical
composite core sample per period), resolves op_code via the crosswalk, and
computes per-stratum sample statistics for the analyst stratification panel.
"""
from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd
from scipy import stats as sps

from crosswalk import Crosswalk, TEST_OP_CODE, UNMATCHED_OP_CODE
from normalizers import normalize_name

CURRENT_BASELINE_PERIOD = "S25"
CURRENT_MONITORING_PERIOD = "F25"
DENSITY_G_CM3_TO_T_ACFT = 1233.48


def _point_key(customer_norm: str, period: str, lat, lon, trs) -> str:
    lat_r = round(lat, 5) if pd.notna(lat) else "none"
    lon_r = round(lon, 5) if pd.notna(lon) else "none"
    key = f"{customer_norm}|{period}|{lat_r}|{lon_r}|{trs or 'none'}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def build_sample_rows(samples_df: pd.DataFrame, cw: Crosswalk) -> pd.DataFrame:
    """Adds op_code + point_id to the raw canonical samples frame (one row
    per DC/BD lab_result; grouping into composite points is via point_id)."""
    df = samples_df.copy()
    df["op_code"] = [
        cw.resolve_sample(r.customer_raw, r.farm_business_raw, r.match_completeness)
        for r in df.itertuples()
    ]
    df["customer_norm"] = df["customer_raw"].apply(normalize_name)
    df["point_id"] = [
        _point_key(r.customer_norm, r.period, r.lat, r.lon, r.trs)
        for r in df.itertuples()
    ]
    df["sample_role"] = df["period"].map({
        "S24": "baseline", "S25": "baseline", "F24": "monitoring", "F25": "monitoring",
    })
    return df


def summarize_points(df: pd.DataFrame) -> pd.DataFrame:
    """One row per composite point (group of DC+BD rows sharing point_id)."""
    def agg(g: pd.DataFrame) -> pd.Series:
        texture = g["texture_class"].dropna()
        return pd.Series({
            "op_code": g["op_code"].iloc[0],
            "period": g["period"].iloc[0],
            "sample_role": g["sample_role"].iloc[0],
            "lat": g["lat"].iloc[0],
            "lon": g["lon"].iloc[0],
            "trs": g["trs"].iloc[0],
            "trs_confidence": g["trs_confidence"].iloc[0],
            "state": g["state"].iloc[0],
            "region": g["region"].iloc[0],
            "texture_class": texture.iloc[0] if len(texture) else None,
            "mukey": g["mukey"].iloc[0],
            "has_dc": bool((g["sample_type"] == "DC").any()),
            "has_bd": bool((g["sample_type"] == "BD").any()),
            "match_completeness": g["match_completeness"].iloc[0],
            "latlon_source": g["latlon_source"].iloc[0],
        })

    return df.groupby("point_id", group_keys=True).apply(agg, include_groups=False).reset_index()


def _lower90_bound(baseline: pd.Series, monitoring: pd.Series) -> float | None:
    n_base, n_mon = len(baseline), len(monitoring)
    if n_base < 2 or n_mon < 2:
        return None
    var_base, var_mon = baseline.var(ddof=1), monitoring.var(ddof=1)
    se = float(np.sqrt(var_base / n_base + var_mon / n_mon))
    if se == 0:
        return float(monitoring.mean() - baseline.mean())
    df_ws = (var_base / n_base + var_mon / n_mon) ** 2 / (
        (var_base / n_base) ** 2 / (n_base - 1) + (var_mon / n_mon) ** 2 / (n_mon - 1)
    )
    t_crit = sps.t.ppf(0.90, df_ws)
    gain = monitoring.mean() - baseline.mean()
    return float(gain - t_crit * se)


def compute_stratum_stats(sample_rows: pd.DataFrame, scope_op_code: str | None = None) -> pd.DataFrame:
    """Per-texture-class stats computed from real S25/F25 lab data (credit_basis
    = baseline_vs_latest, CLAUDE.md rule 3). scope_op_code=None = whole project.
    """
    working = sample_rows[
        sample_rows["period"].isin([CURRENT_BASELINE_PERIOD, CURRENT_MONITORING_PERIOD])
        & ~sample_rows["op_code"].isin([TEST_OP_CODE, UNMATCHED_OP_CODE])
    ].copy()
    if scope_op_code is not None:
        working = working[working["op_code"] == scope_op_code]

    toc = working[working["sample_type"] == "DC"].dropna(subset=["toc_pct"])
    bd = working[working["sample_type"] == "BD"].dropna(subset=["bulk_density_g_cm3"])

    textures = sorted(set(toc["texture_class"].dropna()) | set(bd["texture_class"].dropna()))
    rows = []
    for tex in textures:
        s25 = toc[(toc["texture_class"] == tex) & (toc["period"] == CURRENT_BASELINE_PERIOD)]["toc_pct"]
        f25 = toc[(toc["texture_class"] == tex) & (toc["period"] == CURRENT_MONITORING_PERIOD)]["toc_pct"]
        bd_tex = bd[bd["texture_class"] == tex]["bulk_density_g_cm3"]

        n_base, n_mon = len(s25), len(f25)
        mean_base = float(s25.mean()) if n_base else None
        mean_mon = float(f25.mean()) if n_mon else None
        gain = (mean_mon - mean_base) if (mean_base is not None and mean_mon is not None) else None
        lower90 = _lower90_bound(s25, f25) if (mean_base is not None and mean_mon is not None) else None

        density_g_cm3 = float(bd_tex.mean()) if len(bd_tex) else None
        density_t_acft = density_g_cm3 * DENSITY_G_CM3_TO_T_ACFT if density_g_cm3 is not None else None
        gain_t_acft = (lower90 / 100.0 * density_t_acft) if (lower90 is not None and density_t_acft is not None) else None

        n_plss = int(working.loc[working["texture_class"] == tex, "trs"].dropna().nunique())

        rows.append({
            "texture_class": tex,
            "n_points_baseline": n_base,
            "n_points_monitoring": n_mon,
            "toc_baseline_mean_pct": mean_base,
            "toc_monitoring_mean_pct": mean_mon,
            "oc_gain_ppts": gain,
            "oc_gain_lower90_ppts": lower90,
            "avg_bulk_density_g_cm3": density_g_cm3,
            "avg_density_t_acft": density_t_acft,
            "gain_t_acft": gain_t_acft,
            "n_plss_sections": n_plss,
        })
    columns = [
        "texture_class", "n_points_baseline", "n_points_monitoring",
        "toc_baseline_mean_pct", "toc_monitoring_mean_pct", "oc_gain_ppts",
        "oc_gain_lower90_ppts", "avg_bulk_density_g_cm3", "avg_density_t_acft",
        "gain_t_acft", "n_plss_sections",
    ]
    return pd.DataFrame(rows, columns=columns)
