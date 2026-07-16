# admin.md — Admin backend spec

Routes: `/admin` (status control), `/admin/enrollments`. Persona: Katie (coordinator). Purpose: manually advance grower statuses (R3) and manage the enrollments database (R10). Demo auth: shared password prompt (client + function header check) — demo-grade, labeled as such.

## Status control (`/admin`)

1. **Grower grid** (`DataGrid`, `ops/index.json` + live `/api/status`): columns op_code, label, **enrolled date, state, acres, # fields** (Ward's required columns), region, current project-year, current micro stage (pill), last change (when/by). Sort/filter on all columns; checkbox **multiselect**; quick-selects by stage / region / enrollment year.
2. **Advance action bar** (appears on selection): "Advance N growers to →" stage picker (only stages valid as next-forward for every selected op; mixed-stage selections show which ops would skip and require confirm), optional note, **Confirm** dialog listing affected ops. `POST /api/status/advance {op_codes[], stage, note, by}` → one event per op → grid refreshes.
3. **Undo**: per-op one-step-back correction (`POST /api/status/undo`) from a row menu — event-sourced, appends a corrective event, never deletes.
4. No automation: no timers, no bulk rules. These are human-confirmed milestones by design.

Acceptance: multiselect 5 ops at `lab_data_received` → advance to `project_submitted` → farmer pages for those ops reflect it on reload without redeploy; event log shows 5 events with `by` and note.

## Enrollments admin (`/admin/enrollments`)

The backing view for farmer Page 3 (farmers see read-only; admin edits).

1. **Enrollments grid** (distributor-export schema): enrollment_id, farmer, entity, op_code (crosswalk-resolved; UNRESOLVED flagged red), distributor, total/billed acreage, tote count, status, bill-of-sale date, submitted date, docs summary (`3/4 received`).
2. **Row detail drawer**: docs checklist — toggle each required doc (FSA Form 578, landholder agreement, W-9, bill of sale) received/needed; free-text note. `PUT /api/enrollments/:id` persists to Blobs.
3. **Rollups strip**: total enrollments, total acres, ops with missing docs count.

Acceptance: toggling a doc updates the farmer's "still needed" list live; an enrollment with unresolved op_code is visibly flagged (crosswalk hygiene surfacing).
