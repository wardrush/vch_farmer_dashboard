# sampling.md — Soil sampling planner spec

A new analyst-gated view (`/analyst/sampling`, "like analyst") that turns a
project's SSURGO soil textures + (fabricated) elevation into a concrete,
editable, exportable soil-sampling plan under the BCarbon Soil Protocol v3.0 /
Verra VM0042 approach. Reached from the analyst home nav and from a "Plan soil
sampling for this project" link on each per-farmer view (`/analyst/op/:opCode`).

Works for **newly enrolled** ops (no prior samples → naive design) and
**already-sampled** ops (prior monitoring stats → CI-optimising design).

## Data flow

- **Pipeline** (`pipeline/sampling_artifacts.py`, run from `pipeline/build.py`):
  bakes, per op:
  - `sampling/index.json` — op picker (region, acres, `has_prior_samples`, `has_elevation_split`).
  - `sampling/ops/{op}/fields.strat.geojson` — field polygons + dominant
    `texture_class` + fabricated per-field elevation (`elev_min/max/mean_m`,
    `relief_m`, `low_pt`, `high_pt`).
  - `sampling/ops/{op}/strata.json` — per-texture stratum: acres, share %,
    stratum elevation range, avg bulk density, sand/silt/clay, prior monitoring
    stats + measured TOC SD (from `analyst/ops/{op}/strat.json` + samples),
    fabricated SD fallback.
- **Engine** (`web/src/lib/sampling.ts`): runs client-side so sliders, clustering
  and manual edits are instant. Pure functions; deterministic (seeded RNG).
- **Map** (`web/src/components/SamplingMap.tsx`): MapLibre, fields filled by
  texture, centroids + cores as editable point layers.
- **View** (`web/src/routes/analyst/AnalystSampling.tsx`): controls, tables,
  export. Draft auto-saved to `localStorage`; no backend (per product decision).

## Stratification

Stratum = **soil texture** (dominant SSURGO texture per field). Geographic region
is already handled at the project level (one op = one region), so it is not a
sub-stratum. Each stratum is optionally split by **elevation** into a low and a
high centroid when its elevation range across member fields ≥ the relief
threshold (`elevation_split_eligible`). This matches the protocol's validated
option to break strata by slope/elevation in addition to texture.

## Point placement

- Per stratum, the engine picks **N centroids** (see sample-size model). With an
  elevation split the first two are the low- and high-elevation centroids
  (placed at the lowest field's `low_pt` / highest field's `high_pt`); extra
  centroids are random interior points, area-weighted across fields.
- Around each centroid, **10 cores** at random bearings, **10–50 m** out — each a
  unique `core_uuid` + `barcode` + `lab_no` (protocol: processed separately).
- **Clustering** slider (0 = max spread / representative → 1 = tight / min
  driving) pulls centroids toward the stratum hub; a nearest-neighbour tour
  length is shown as a driving-distance proxy.

## Sample-size model (demo-grade but coherent)

Sizes fall out of a target **90% CI half-width** on the stratum's OC-gain
estimate, given within-stratum SD (measured from prior samples where available,
else fabricated by texture). `n = (z·SD / target)²`, `z = 1.645`.

- **Elevation split** guarantees ≥2 centroids for high-relief strata.
- **Acreage cap** keeps a modest stratum from demanding a huge crew.
- **Density** slider scales all sizes; a **power warning** flags strata whose
  achieved CI still exceeds 1.5× the target.
- **Prior-informed** mode: where last year's gain has a wide CI (and a positive
  gain), add points to close it toward the target; well-sampled strata drop to a
  maintenance level.
- **Acreage-vs-cost**: strata below a min-acres / min-share threshold become a
  single "tracking" sample or are excluded (e.g. 2,000 ac of silty clay in a
  500k-ac project → 1 point or none).
- **Cost** = cores × configurable $/core; shown live against the CI tradeoff.

## Manual editing (required)

Edit mode lets the analyst **drag** a core (or a whole centroid + its cores) to
relocate points off inaccessible ground, **delete** a selected point/centroid
(Delete key or button), and **add** a core to a centroid. Stratum counts, CI,
power flags, cost and driving proxy recompute on every edit. Edits persist in
the `localStorage` draft; "Regenerate" discards them.

## Output

**Finalize & export** downloads the sampling table as CSV (one row per core:
`core_uuid, barcode, lab_no, op_code, farmer, stratum_id, texture_class,
elevation_band, centroid_id, lat, lon, demo_fabricated`) and a matching points
GeoJSON.

## Demo / fabrication notes (Hard rule 5)

- **Elevation** is a synthetic deterministic surface (`pipeline/elevation.py`) —
  no DEM in the source data. Every field's elevation block carries
  `demo_fabricated: true`; `strata.json` carries `demo_fabricated_elevation`.
- **Variance** (within-stratum gain SD) is measured where prior samples exist,
  otherwise fabricated by texture (flagged `demo` in the UI).
- **Cost per core** is a demo assumption, editable in the UI.
- All engine output carries `demo_fabricated: true`.
- Swap-in points for production: replace `elevation.py` with real zonal DEM
  stats; feed real per-stratum variance; the engine and UI are unchanged.
