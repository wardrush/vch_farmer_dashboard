"""Shared normalizers used only by source_schemas.py transforms and crosswalk.py.

Per docs/FIELD_MAPPING.md — these are the ONLY place texture/name/land-class
strings get cleaned up. Nothing downstream should re-implement this logic.
"""
from __future__ import annotations

import re
import unicodedata

import pyproj
from shapely.ops import transform as shapely_transform

_TEXTURE_MAP = {
    "clay": "Clay",
    "clay loam": "Clay Loam",
    "loam": "Loam",
    "loamy sand": "Loamy Sand",
    "sand": "Sand",
    "sandy clay loam": "Sandy Clay Loam",
    "sandy loam": "Sandy Loam",
    "silt": "Silt",
    "silt loam": "Silt Loam",
    "silty clay": "Silty Clay",
    "silty clay loam": "Silty Clay Loam",
    "muck": "Muck",
    "spm": "Organic (Spm)",
    "mpm": "Organic (Mpm)",
}


class UnknownTextureError(ValueError):
    pass


def normalize_texture(v) -> str | None:
    """"Sandy loam" | "SANDY LOAM" | "sandy loam " -> "Sandy Loam". None/"" -> None."""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return None
    key = s.lower()
    if key not in _TEXTURE_MAP:
        raise UnknownTextureError(f"Unmapped texture value: {v!r} — add it to _TEXTURE_MAP in normalizers.py")
    return _TEXTURE_MAP[key]


_PUNCT_RE = re.compile(r"[^\w\s]")
_PAREN_RE = re.compile(r"\([^)]*\)")
_WS_RE = re.compile(r"\s+")
_SUFFIX_RE = re.compile(r"\b(inc|llc|gp|co|corp)\b\.?")


def normalize_name(v) -> str:
    """casefold, strip punctuation/parentheticals/legal suffixes, collapse whitespace.

    Matching only — never used for display.
    """
    if v is None:
        return ""
    s = str(v)
    if s.strip().lower() == "nan":
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = _PAREN_RE.sub(" ", s)
    s = _PUNCT_RE.sub(" ", s)
    s = s.casefold()
    s = _SUFFIX_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


_LAND_CLASS_MAP = {
    "farmable/mineral": "farmable_mineral",
    "water": "water",
    "wetland density <1.1": "wetland_lowdensity",
    "nonfarmable texture": "nonfarmable_texture",
}


def normalize_land_class(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return None
    key = s.lower()
    if key not in _LAND_CLASS_MAP:
        raise ValueError(f"Unmapped land_class value: {v!r} — add it to _LAND_CLASS_MAP in normalizers.py")
    return _LAND_CLASS_MAP[key]


_TRANSFORMER_5070_TO_4326 = pyproj.Transformer.from_crs("EPSG:5070", "EPSG:4326", always_xy=True)


def to_4326(geom):
    """Reproject a shapely geometry from EPSG:5070 (NAD83 / Conus Albers) to EPSG:4326."""
    if geom is None:
        return None
    return shapely_transform(_TRANSFORMER_5070_TO_4326.transform, geom)
