"""docs/DATA_PIPELINE.md Stage 3 — geometry prep.

CLAUDE.md hard rule 4: EPSG:5070 -> EPSG:4326 reprojection happens exactly
once, in this file, via `reproject_to_4326`. Nothing else may reproject.
"""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

WEB_SIMPLIFY_TOLERANCE_DEG = 0.00005  # ~5 m, per specs/maps.md budget
CLUSTER_EPS_METERS = 8000.0  # DBSCAN eps, per docs/DATA_PIPELINE.md Stage 3
CLUSTER_BBOX_PADDING = 0.05  # +5%


def reproject_to_4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """The only place 5070->4326 happens (CLAUDE.md hard rule 4)."""
    out = gdf.copy()
    if out.crs is None:
        out = out.set_crs("EPSG:5070")
    return out.to_crs("EPSG:4326")


def add_web_geometry(gdf_4326: gpd.GeoDataFrame, tolerance: float = WEB_SIMPLIFY_TOLERANCE_DEG) -> gpd.GeoDataFrame:
    """Adds a `geometry_web` column: simplified, topology-preserving, for map display."""
    out = gdf_4326.copy()
    out["geometry_web"] = out.geometry.simplify(tolerance, preserve_topology=True)
    return out


def compute_clusters(fields_5070: gpd.GeoDataFrame, op_code_col: str = "op_code") -> pd.DataFrame:
    """DBSCAN over field centroids in projected meters (EPSG:5070), per op.

    Returns a frame with one row per field: field_id, op_code, cluster_id
    (0-indexed per op; ops with 1 cluster still get cluster_id 0).
    """
    centroids = fields_5070.geometry.centroid
    xs = centroids.x.to_numpy()
    ys = centroids.y.to_numpy()

    cluster_ids = np.full(len(fields_5070), -1, dtype=int)
    for op_code in fields_5070[op_code_col].dropna().unique():
        mask = (fields_5070[op_code_col] == op_code).to_numpy()
        pts = np.column_stack([xs[mask], ys[mask]])
        if len(pts) == 1:
            cluster_ids[mask] = 0
            continue
        labels = DBSCAN(eps=CLUSTER_EPS_METERS, min_samples=1).fit_predict(pts)
        cluster_ids[mask] = labels

    return pd.DataFrame({
        "field_id": fields_5070["field_id"].to_numpy(),
        "op_code": fields_5070[op_code_col].to_numpy(),
        "cluster_id": cluster_ids,
    })


def cluster_bboxes(fields_4326: gpd.GeoDataFrame, cluster_assignments: pd.DataFrame, acres_col: str = "boundary_acres") -> pd.DataFrame:
    """Per (op_code, cluster_id): padded bbox in 4326 lon/lat, field count, acres.

    fields_4326 must already be reprojected (see reproject_to_4326).
    """
    merged = fields_4326.merge(cluster_assignments, on="field_id", suffixes=("", "_c"))
    rows = []
    for (op_code, cluster_id), grp in merged.groupby(["op_code", "cluster_id"]):
        minx, miny, maxx, maxy = grp.geometry.total_bounds
        pad_x = (maxx - minx) * CLUSTER_BBOX_PADDING or 0.01
        pad_y = (maxy - miny) * CLUSTER_BBOX_PADDING or 0.01
        rows.append({
            "op_code": op_code,
            "cluster_id": int(cluster_id),
            "min_lon": minx - pad_x,
            "min_lat": miny - pad_y,
            "max_lon": maxx + pad_x,
            "max_lat": maxy + pad_y,
            "field_count": len(grp),
            "acres": float(grp[acres_col].sum()),
        })
    return pd.DataFrame(rows)


def op_bounds(fields_4326: gpd.GeoDataFrame, op_code_col: str = "op_code") -> pd.DataFrame:
    rows = []
    for op_code, grp in fields_4326.groupby(op_code_col):
        minx, miny, maxx, maxy = grp.geometry.total_bounds
        rows.append({"op_code": op_code, "min_lon": minx, "min_lat": miny, "max_lon": maxx, "max_lat": maxy})
    return pd.DataFrame(rows)


def project_bounds(fields_4326: gpd.GeoDataFrame) -> dict:
    minx, miny, maxx, maxy = fields_4326.geometry.total_bounds
    return {"min_lon": float(minx), "min_lat": float(miny), "max_lon": float(maxx), "max_lat": float(maxy)}
