# IDENTITY_CROSSWALK.md — Operation identity resolution

The same farm operation appears under different names in every source. Examples observed in the real data:

| gpkg `op_label` | gpkg `LAST_BUSIN` | samples `customer` | samples `farm_business` | farmer-table |
|---|---|---|---|---|
| Fugleberg Farms | Fugleberg Farms / null | **Fulgelberg** Farms (typo) | Fugleberg Farms | Fugleberg Farms |
| Hong Farms | Hong | Hong Farms (Curt & Chris Hong) | Hong | Hong Farms |
| Kyllo - Braaten - Braaten | RSK Inc / others | Shane Kyllo / Braaten / Bratten | RSK INC | Kyllo - Braaten - Braaten |
| John Fields | John Fields | John Field | — | John Fields |

Additionally: `LAST_BUSIN` is null on 110 fields and disagrees with `op_label` on 718; 224 sample rows are `match_completeness = unmatched`; 2 fields have no `op_label`.

## Design

One committed, hand-editable seed file is the single source of truth: `data/canonical/operations_crosswalk.csv`.

| Column | Notes |
|---|---|
| `op_code` | PK, e.g. `24-07` |
| `op_label` | canonical display name |
| `entity_name` | legal entity (application Table 5 name) |
| `last_busin_variants` | `\|`-joined raw values seen in gpkg `LAST_BUSIN` |
| `samples_customer_variants` | `\|`-joined raw `customer` values |
| `samples_farm_business_variants` | `\|`-joined raw `farm_business` values |
| `farmer_table_name` | exact string in farmer-table xlsx |
| `distributor_enrollment_ids` | `\|`-joined enrollment uuids |
| `region` | ND_E / ND_W / MN |
| `state` | dominant state |
| `enrollment_year` | int |
| `enroll_origin` | 2024_reenrolled / 2025_new |
| `notes` | free text (e.g. "Eeg overlap with Arnesen — do not double count") |
| `resolution` | `auto_exact` / `auto_fuzzy` / `manual` / `unresolved` |

## Generation algorithm (`pipeline/crosswalk.py`)

1. Seed rows from gpkg distinct (`op_code`, `op_label`) — 54 rows (+1 synthetic row per orphan source below if needed).
2. For each source name column (gpkg `LAST_BUSIN`, samples `customer`, samples `farm_business`, farmer-table name, enrollment `Entity Name`/`Farmer Name`):
   a. exact match on `normalize_name()` (casefold, strip punctuation and parentheticals, collapse whitespace) → attach variant, `resolution=auto_exact`;
   b. else rapidfuzz `token_set_ratio ≥ 90` against `op_label` + already-attached variants → attach, `resolution=auto_fuzzy`;
   c. else leave the raw value in a `_unresolved.csv` review report (raw value, source, row count, top-3 candidates with scores).
3. Write `operations_crosswalk.csv` **only if it does not exist**. If it exists, load it as authoritative and only report (never merge) newly-seen unmatched variants to `_unresolved.csv`. The analyst hand-edits the CSV and reruns.
4. Known hard cases to pre-resolve in the seed (put in `notes`):
   - Eeg Brothers / Stuart Eeg: late add; part of ground already under Mark Arnesen ("Arrenson" in some sources) — fields must not double count.
   - Kyllo/Braaten/RSK: one op, three business names.
   - `2023 Test Trials` in samples `farm_business`: not an operation — map to `op_code = TEST`, excluded from all farmer-facing outputs and rollups.
   - The 224 unmatched sample rows stay `op_code = UNMATCHED` and appear only in the analyst QA view (they demo the "why the old way was painful" story).

## Usage rules

- Joins to sources always go through the crosswalk (`raw name → op_code`), never direct name equality.
- The pipeline fails loudly if a raw name appears that is neither in the crosswalk nor in `_unresolved.csv` handling.
- The analyst dashboard should surface crosswalk health: counts of auto_exact / auto_fuzzy / manual / unresolved (see `specs/analyst-dashboard.md` §QA).
