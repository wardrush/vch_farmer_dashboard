# farmer-dashboard.md — Farmer app spec

Routes: `/farmer/:opCode` (status), `/farmer/:opCode/project/:projectYearId` (project detail), `/farmer/:opCode/enrollments`. MVP "login": a landing page (`/`) listing demo growers → link into `/farmer/:opCode`; real auth out of scope (Netlify page password in front).

Data: `ops/{op_code}/profile.json`, `fields.web.geojson`, `enrollments.json`, plus live status from `/api/status` (fallback `status-seed.json`).

## Privacy (R8 — hard rule)
Nothing on any farmer route mentions or renders: soil texture, stratum, SSURGO, map units, per-stratum anything, sample locations. The farmer artifacts physically exclude these fields (pipeline allowlist), so a UI mistake can't leak them. If a design need arises that seems to want texture data on a farmer page — stop, it's a business-rule violation, flag it.

## Page 1 — Project status (`/farmer/:opCode`)

Layout top→bottom:
1. **Greeting header**: op label, entity name, "Grower since {grower_since}".
2. **Macro tracker** (`StageTracker size=macro`): Enrollment submitted → Baseline gathered → Year 1 completed → Year 2 completed → True-up completed. Clicking a macro stage (or an "expand" affordance) unfolds the **micro tracker** for the corresponding project-year beneath it — this is the R1 "zoomed in and out" pizza tracker. Default state: macro bar + micro bar for the *current* project-year already expanded.
3. **Estimated credits card** (`StatCard`): headline `credited_t` (formatted `xx,xxx tonnes C`) across all properties in the project — **baseline vs most recent monitoring year only** (R2). Footnote opens `Callout`: plain-language explanation that measured gain is capped at 1 t/ac/yr for interim crediting and settles at true-up ({trueup_year}). If the op's 2024 history exists, a secondary line: "Credits distributed to date: {distributed}" with `DemoBadge`.
4. **Projects list**: one card per project-year (year, season span `S25 → F25`, acres, current micro stage as a small pill, link → Page 2).

Acceptance:
- Every one of the 10 micro stages is reachable/visible across the demo growers (see DEMO_SCRIPT.md).
- Stage copy under the tracker matches `STATUS_MODEL.md` farmer-facing copy.
- Credits number equals `credit_ledger.credited_t` for the current cycle — never a sum across years.

## Page 2 — Project detail (`/farmer/:opCode/project/:projectYearId`)

1. **Micro tracker** for this project-year (full 10 pills; carried-from-baseline stages rendered completed, per STATUS_MODEL).
2. **Map inlay** (`MapInlay`, ~55% width on desktop, full-width stacked on tablet): op's field boundaries — gold semi-transparent fill (`#A67C17` @ 0.25) with solid 2px gold outline over satellite imagery; auto-fit to op bounds. **Sub-cluster meta-boxes** (R5) per `specs/maps.md`: when the op has >1 geometry cluster, dashed white/gold boxes wrap each cluster with a field-count chip; clicking a box zooms to that cluster; a "fit all" control returns to full extent. Hovering a field shows name + acres tooltip. No soil layers exist in this artifact.
3. **Facts panel** (StatCards): Acres submitted (`boundary_acres` sum), Fields (count), Submitted on (`submitted_at`), Project year (`season_span`), True-up ({trueup_year}).
4. **Estimated current credits** — rendered **only when** micro stage ≥ `project_submitted` (R7: interim credit project submitted). Before that, the slot shows "Estimates available after your project is submitted."

Acceptance:
- Hoverson Brothers (486 fields, ~61k ac) renders at 60fps pan/zoom with the simplified geojson (≤ ~2 MB); initial load < 3s on broadband.
- An op with disparate clusters (verify against DBSCAN output; e.g. an op spanning distant counties) shows ≥2 meta-boxes and box-click zoom works.
- Credits slot hidden for ops staged before `project_submitted`, shown at/after.

## Page 3 — Enrollments (`/farmer/:opCode/enrollments`)

1. **Rollup header** (R10): Total acres enrolled · "Grower with us since {year}" · **Credits distributed** (actually distributed, not estimated; `credit_ledger.status = distributed` rows only; 0 → "—" with "first distribution follows validation" microcopy).
2. **Enrollment sets table** — one row per enrollment record (an op may have several — R11): entity, distributor, total/billed acreage, tote count, status, bill-of-sale date, submitted date. Row expands to a **submitted / still-needed checklist** (docs_received vs docs_needed: FSA Form 578, landholder agreement, W-9, bill of sale) — read-only here; editable in admin (this is the "linked view into the admin dashboard" — same data source, farmer sees read-only).

Acceptance:
- An op with 2 enrollment sets displays both; at least one demo op has missing docs showing the "still needed" list.
- Distributed credits figure matches admin/analyst views exactly (single ledger source).
