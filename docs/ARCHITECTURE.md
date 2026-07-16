# ARCHITECTURE.md — Deployment shape

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│  Local: Python pipeline    │ build  │  Netlify                     │
│  data/source/*  ──────────►│───────►│  static site (web/dist)      │
│  build.py → web/public/data│ deploy │   • /farmer/:opCode/*        │
│           → status-seed    │        │   • /analyst/*               │
└────────────────────────────┘        │   • /admin/*                 │
                                      │  Functions (/api/*)          │
                                      │   • status.ts   ─┐           │
                                      │   • enrollments.ts┼─► Blobs  │
                                      └──────────────────────────────┘
```

- **Static-first:** all heavy data (geometry, samples, rollups) is baked JSON/GeoJSON produced by the pipeline. Rebuild + redeploy when source data changes.
- **Live-state exception:** status events and enrollment doc-checklists live in **Netlify Blobs**, mutated through **Netlify Functions**, so admin changes are immediately visible to all viewers without a redeploy (decision: R25).
  - `GET /api/status` → full event log; `POST /api/status/advance` `{op_codes[], stage, note, by}`; `POST /api/status/undo` (one step back, correction).
  - `GET/PUT /api/enrollments/:id` for docs_received/docs_needed edits.
  - First read seeds Blobs from `status-seed.json` if empty.
- **Auth posture (MVP):** Ward applies a Netlify page password in front of everything. Farmer "login" = navigating `/farmer/:opCode`; a simple landing page lists demo growers. Admin/analyst routes sit behind an additional shared password checked client-side + in functions via a header — demo-grade only, documented as such on the page.
- **Local dev:** `netlify dev` for functions+blobs emulation; frontend falls back to `status-seed.json` when `/api/status` is unreachable.

## Snowflake fast-follow (summary; details in SNOWFLAKE.md)

Ward has geodata, enrollment, and sample databases to connect soon. The seam is the **adapter layer**:

```python
class SourceAdapter(Protocol):
    def operations(self) -> pd.DataFrame: ...
    def fields(self) -> gpd.GeoDataFrame: ...
    def soil_components(self) -> gpd.GeoDataFrame: ...
    def samples(self) -> pd.DataFrame: ...
    def enrollments(self) -> pd.DataFrame: ...

class FileAdapter:      # now — wraps source_schemas.py SourceMaps
class SnowflakeAdapter: # later — SELECTs from materialized views, returns identical canonical frames
```

`build.py` takes `--adapter file|snowflake`. Everything from Stage 3 onward is adapter-agnostic because both return canonical schemas. Nothing else changes for the fast-follow; the static publish step remains (Snowflake → pipeline → baked artifacts → Netlify) until/unless a live API tier is wanted.

## Non-goals
No database server, no ORM, no SSR, no queue. If a requirement seems to need one, it's out of demo scope — flag it instead.
