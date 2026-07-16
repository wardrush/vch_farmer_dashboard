# STATUS_MODEL.md — Project status stage machines

Two zoom levels of one tracker (R1). Statuses are **manually advanced by admin** — there is deliberately no automation at the micro level; these are human-confirmed milestones.

## Micro stages (per operation × project-year, strictly ordered)

| # | Stage id | Display label (farmer-facing) |
|---|---|---|
| 1 | `enrollment_began` | Enrollment began |
| 2 | `all_files_submitted` | All files submitted |
| 3 | `maps_approved` | Maps approved |
| 4 | `baseline_samples_requested` | Baseline samples requested |
| 5 | `baseline_sampling_completed` | Baseline sampling completed |
| 6 | `post_season_sampling_completed` | Post-growing-season sampling completed |
| 7 | `lab_data_received` | Data received from lab |
| 8 | `project_submitted` | Project submitted |
| 9 | `project_validated` | Project validated |
| 10 | `credits_available` | Credits available |

Notes:
- Stages 4–5 apply to year 1 of a cycle; for subsequent interim years the micro track for that project-year starts at stage 6 (post-season sampling) — render skipped stages as "completed (carried from baseline)" rather than hiding them, so the bar shape stays constant.
- Admin can only move forward or one step back (correction); every change is an event, nothing is overwritten.

## Macro stages (per operation × project, spanning years)

| # | Stage id | Display label | Derived from micro |
|---|---|---|---|
| 1 | `enrollment_submitted` | Enrollment submitted | year-1 micro ≥ `all_files_submitted` |
| 2 | `baseline_gathered` | Baseline gathered | year-1 micro ≥ `baseline_sampling_completed` |
| 3 | `year1_completed` | Year 1 project completed | year-1 micro = `credits_available` |
| 4 | `year2_completed` | Year 2 project completed | year-2 micro = `credits_available` |
| 5 | `trueup_completed` | True-up completed | true-up project-year validated |

The macro bar repeats per interim cycle (cycle 1 true-up 2028; then 2031, 2034). The demo shows cycle 1 only.

## Status store

Event log, not a state field:

```json
{
  "events": [
    {
      "op_code": "24-04",
      "project_year_id": "P3-2025-Y1",
      "stage": "project_submitted",
      "entered_at": "2026-07-11",
      "by": "katie",
      "note": "Application 3 submitted to BCarbon",
      "demo_fabricated": true
    }
  ]
}
```

- Current status = event with highest stage # (ties → latest `entered_at`) per (`op_code`, `project_year_id`).
- Lives in **Netlify Blobs** key `status/events.json`; read/written via `functions/status.ts` (`GET /api/status`, `POST /api/status/advance` with `{op_codes: [], stage, note}` — multiselect advance writes one event per op).
- Pipeline seeds the initial event log (`fabricate.py`) and also bakes a static copy at `web/public/data/status-seed.json`; the frontend uses the blob API and falls back to the seed when functions are unavailable (local dev / static preview).
- Timeline dates for the demo seed: keep consistent with reality — S25 baseline Apr–May 2025, F25 monitoring Oct–Nov 2025, lab data through early 2026, application submitted 2026-07-11, "today" = mid-July 2026.

## Farmer-facing copy

Under the tracker, one sentence per current stage (plain language, no jargon), e.g. `project_submitted`: "Your project has been submitted to BCarbon, the independent validator. We'll update this as soon as validation completes." Keep the full copy table in `web/src/content/stageCopy.ts`.
