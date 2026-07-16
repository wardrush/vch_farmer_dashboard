"""SourceAdapter seam (docs/ARCHITECTURE.md) — FileAdapter wraps source_schemas.py
SourceMaps today; a SnowflakeAdapter with identical method signatures can
replace it later without touching geometry.py / rollups.py / fabricate.py.

Everything returned here still carries *_raw identity columns (op_code_raw,
customer_raw, ...) — crosswalk.py is what resolves those to canonical op_code.
"""
from __future__ import annotations

from typing import Protocol

import geopandas as gpd
import pandas as pd

from source_schemas import ENROLLMENTS, FARMER_TABLE, GPKG_FIELDS, GPKG_SOIL_COMPONENTS, SAMPLES


class SourceAdapter(Protocol):
    def fields(self) -> gpd.GeoDataFrame: ...
    def soil_components(self) -> gpd.GeoDataFrame: ...
    def samples(self) -> pd.DataFrame: ...
    def enrollments(self) -> pd.DataFrame: ...
    def farmer_table(self) -> pd.DataFrame: ...


class FileAdapter:
    """Reads data/source/* via the SourceMaps. Today's adapter."""

    def fields(self) -> gpd.GeoDataFrame:
        return GPKG_FIELDS.load()

    def soil_components(self) -> gpd.GeoDataFrame:
        return GPKG_SOIL_COMPONENTS.load()

    def samples(self) -> pd.DataFrame:
        return SAMPLES.load()

    def enrollments(self) -> pd.DataFrame:
        return ENROLLMENTS.load()

    def farmer_table(self) -> pd.DataFrame:
        return FARMER_TABLE.load()


# SnowflakeAdapter (fast-follow, docs/SNOWFLAKE.md): same method signatures,
# each a `SELECT * FROM CANONICAL.<view>` returning identical canonical frames.
# Not implemented — out of demo scope until Ward's Snowflake account is wired up.
