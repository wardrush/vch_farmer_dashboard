# maps.md — MapLibre GL spec

Library: **MapLibre GL JS** (no Mapbox token). One `MapInlay` component, three configurations: farmer field map, analyst sample map, analyst status map.

## Basemap

Raster style, satellite default with a streets toggle:
- **Satellite**: Esri World Imagery — `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (attribution "Esri, Maxar, Earthstar Geographics"; free for this use with attribution).
- **Streets** toggle: OSM raster `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (attribution required).
Project extent ≈ lon −102.6…−94.5, lat 46.4…49.0; default fallback center [−97.9, 47.8] zoom 7.

## Farmer field map (Page 2)

Sources: `ops/{op}/fields.web.geojson` (simplified; props: id, name, acres only).
Layers:
1. `fields-fill` — fill `#A67C17`, opacity 0.25 (hover 0.4).
2. `fields-line` — line `#A67C17`, width 2 (satellite) / `#8A6612` (streets).
3. `cluster-boxes` (only if op has >1 cluster; boxes from `profile.json.cluster_bboxes`) — dashed 2px `#FFFFFF` @0.9 outline with `#A67C17` 1px inner, fill transparent; symbol layer chip at box top-left: "{n} fields".
Interactions: hover field → tooltip (name, acres); click cluster box → `fitBounds(box, {padding: 40})`; "Fit all" control → op bounds; zoom/pan free; `cooperativeGestures: true` inside scrolling pages.
Auto-fit logic (R5): initial `fitBounds(op_bounds)`. If the op's largest cluster occupies <15% of the op bbox area (highly disparate fields), keep full-extent view and rely on meta-boxes for wayfinding — never auto-zoom to only one cluster.

## Analyst sample map (per-farmer view)

Sources: `fields.web.geojson` (context, fill opacity 0.12) + `analyst/ops/{op}/samples.geojson` (points; props: point_id, period, sample_role, texture_class, has_dc, has_bd, popup payload).
Layers:
- `samples-circle` — circle radius 5 (8 on hover), color by period: S24 `#C7B08A`, F24 `#8A6612`, S25 `#A67C17`, F25 `#5B7B4C`; stroke white 1.5px; partial points (missing DC or BD) get dashed stroke via a second symbol layer badge.
- Filter chips set a MapLibre `setFilter` on `period` (All / year / single period — R15).
Click point → popup lab card (fields listed in `specs/analyst-dashboard.md`). Popup uses design-system card styling.
Export button exports **currently filtered** points as CSV (client-side from the loaded GeoJSON + lab payload).

## Analyst status map

Source: `analyst/fields-status.web.geojson` (all ops, extra-simplified; props: field_id, op_code, op_label, status_class, periods_covered).
- `status-fill` — match on `status_class`: pre-submission `#ECE1CD`, submitted `#D4A72C`, validated `#5B7B4C`, credited `#3E5C36`; opacity 0.55; thin sand outline.
- Toggle switches the match expression to `periods_covered` (S25-only `#C7B08A` vs S25+F25 `#5B7B4C`).
- Legend with counts; click → op popup + link.
Performance: this artifact must stay light — simplify aggressively (tolerance ~0.0002°), drop holes < 1 ac; target ≤ 8 MB. If still heavy, split by region into three GeoJSONs loaded lazily.

## Shared

- All map cards `rounded-3xl` clipped, border sand-300, min-height 420px.
- Attribution control always visible (Esri/OSM requirements).
- No PMTiles/vector-tile infra unless the GeoJSON budgets in `DATA_PIPELINE.md` are exceeded; if needed, tippecanoe → PMTiles + pmtiles JS is the sanctioned escalation path — note it, don't preemptively build it.
