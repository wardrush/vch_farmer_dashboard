"""Fabricated synthetic elevation surface for the sampling demo.

There is no DEM in the source data (see docs/DATA_SOURCES.md), but the BCarbon
soil protocol lets us break strata by elevation/slope in addition to texture.
To *demonstrate* that stratification without wiring a real DEM, we synthesize a
smooth, deterministic elevation surface over the project extent and derive
per-field relief from the actual field geometry.

Everything produced here is demo data and is flagged ``demo_fabricated: true``
wherever it surfaces (Hard rule 5 in CLAUDE.md). Swap :func:`elevation_m` for a
real zonal-statistics lookup when a DEM is available and the rest of the
pipeline is unchanged.

The surface is a sum of low-frequency sinusoids plus a gentle west->east
regional trend, tuned so that:
  * absolute values land in a plausible Northern Plains range (~250-560 m), and
  * a field spanning a few hundred metres picks up a few metres of relief,
    while some fields sit on locally flat spots (little relief).

Because it is a closed-form function of (lon, lat), the client never has to
re-implement it: the pipeline bakes the per-field min/max points it needs.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

# Project extent (from specs/maps.md): lon -102.6..-94.5, lat 46.4..49.0.
_LON0 = -98.5  # reference meridian for the regional trend
_BASE_M = 380.0  # mean elevation, metres


def elevation_m(lon: float, lat: float) -> float:
    """Synthetic elevation in metres at a WGS84 coordinate. Deterministic."""
    # Regional trend: the Dakotas rise to the west. ~18 m per degree of lon.
    trend = (_LON0 - lon) * 18.0

    # Multi-scale rolling terrain. Wavelengths chosen in degrees so that a
    # ~0.01-0.05 deg field sees a usable local gradient without the surface
    # looking noisy at project scale.
    rolling = (
        26.0 * math.sin(lon * 3.1 + 0.7) * math.cos(lat * 2.7 - 0.4)
        + 14.0 * math.sin(lon * 7.3 - 1.1) * math.cos(lat * 6.1 + 0.9)
        + 7.0 * math.sin((lon + lat) * 11.0 + 0.3)
        + 4.0 * math.cos((lon - lat) * 17.0 - 0.6)
        # higher-frequency local rolling (wavelength ~0.02-0.03 deg) so an
        # individual field picks up a few metres of relief.
        + 3.5 * math.sin(lon * 42.0 + 1.3) * math.cos(lat * 39.0 - 0.8)
        + 2.0 * math.cos((lon + 2 * lat) * 55.0 + 0.5)
    )
    return _BASE_M + trend + rolling


def _ring_points(ring: Sequence[Sequence[float]]) -> list[tuple[float, float]]:
    """Exterior ring vertices, densified along each edge so relief is captured
    even when a field is described by only a handful of coarse vertices."""
    pts: list[tuple[float, float]] = []
    n = len(ring)
    if n == 0:
        return pts
    for i in range(n):
        lon0, lat0 = ring[i][0], ring[i][1]
        lon1, lat1 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        pts.append((lon0, lat0))
        # one midpoint per edge is enough at these field sizes
        pts.append(((lon0 + lon1) / 2.0, (lat0 + lat1) / 2.0))
    return pts


def _iter_exterior_rings(geometry: dict) -> Iterable[Sequence[Sequence[float]]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        if coords:
            yield coords[0]
    elif gtype == "MultiPolygon":
        for poly in coords:
            if poly:
                yield poly[0]


def field_elevation_stats(geometry: dict) -> dict:
    """Return elevation summary + representative low/high points for a field.

    Keys: elev_min_m, elev_max_m, elev_mean_m, relief_m, low_pt [lon,lat],
    high_pt [lon,lat]. All rounded for compact JSON.
    """
    samples: list[tuple[float, float, float]] = []  # (lon, lat, elev)
    for ring in _iter_exterior_rings(geometry):
        for lon, lat in _ring_points(ring):
            samples.append((lon, lat, elevation_m(lon, lat)))

    if not samples:
        return {
            "elev_min_m": None,
            "elev_max_m": None,
            "elev_mean_m": None,
            "relief_m": None,
            "low_pt": None,
            "high_pt": None,
        }

    lo = min(samples, key=lambda s: s[2])
    hi = max(samples, key=lambda s: s[2])
    mean = sum(s[2] for s in samples) / len(samples)
    return {
        "elev_min_m": round(lo[2], 1),
        "elev_max_m": round(hi[2], 1),
        "elev_mean_m": round(mean, 1),
        "relief_m": round(hi[2] - lo[2], 1),
        "low_pt": [round(lo[0], 6), round(lo[1], 6)],
        "high_pt": [round(hi[0], 6), round(hi[1], 6)],
    }
