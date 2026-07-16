"""docs/DATA_PIPELINE.md Stage 7 — demo fabrication.

ONLY place fabricated data is created (CLAUDE.md hard rule 5). Every record
built here carries demo_fabricated: true. Real data (acres, samples, credit
math) is never touched here — this module only invents statuses, a 2024
project-year for ops with real 2024 samples, enrollment paperwork, and
grower_since dates, per docs/DEMO_SCRIPT.md's named anchors.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

import pandas as pd

MICRO_STAGES = [
    "enrollment_began", "all_files_submitted", "maps_approved",
    "baseline_samples_requested", "baseline_sampling_completed",
    "post_season_sampling_completed", "lab_data_received",
    "project_submitted", "project_validated", "credits_available",
]
STAGE_INDEX = {s: i + 1 for i, s in enumerate(MICRO_STAGES)}  # 1-indexed, matches STATUS_MODEL.md

CURRENT_PROJECT_ID = "P3-2025"
HISTORY_PROJECT_ID = "P2-2024"
TRUEUP_YEAR = 2028
DEMO_PRICE_PER_TONNE_USD = 20.0  # documented assumption (DATA_PIPELINE.md Stage 7.2)
GROWER_SHARE = 0.55

TODAY = date(2026, 7, 15)
APPLICATION_SUBMITTED_DATE = date(2026, 7, 11)

RNG_SEED = 42

# docs/DEMO_SCRIPT.md "Named anchors (stage these exactly)" — op's CURRENT
# (most recent) project-year micro stage.
NAMED_ANCHOR_STAGES: dict[str, str] = {
    "24-04": "credits_available",               # Hoverson Brothers — flagship
    "24-05": "project_validated",                # Hong Farms
    "24-07": "project_submitted",                 # Fugleberg Farms
    "25-42": "lab_data_received",                 # Kristian Sorum
    "25-33": "post_season_sampling_completed",    # Doug Ginther
    "25-45": "baseline_sampling_completed",       # Majeres Farms
    "25-30": "baseline_samples_requested",        # Dan Pfeifle
    "25-49": "maps_approved",                     # Cose Farms
    "25-20": "all_files_submitted",               # Brandon Down — fresh 2025_new enrollment
}
ENROLLMENT_BEGAN_OP = "25-24"  # Brock Mitchell — builder's pick, missing-docs demo beat

# docs/DATA_SOURCES.md — the 16 ops with real S24/F24 lab samples get a
# fabricated completed 2024 "Year 1" project-year (verified against real
# sample data in samples_join.py's customer_raw counts).
REAL_2024_HISTORY_OPS = [
    "24-02", "24-03", "24-04", "24-05", "24-06", "24-07", "24-08", "24-09",
    "24-10", "24-11", "24-12", "24-13", "24-14", "24-15", "24-17", "24-18",
]

REMAINING_STAGE_WEIGHTS = {
    "baseline_sampling_completed": 0.10,
    "post_season_sampling_completed": 0.10,
    "lab_data_received": 0.15,
    "project_submitted": 0.50,
    "project_validated": 0.15,
}

DOC_CHECKLIST = ["FSA Form 578", "Signed landholder agreement", "W-9", "Bill of sale"]
DISTRIBUTOR_NAMES = [
    "PM Ag Sources; Cose", "Prairie Soil Solutions; Fargo",
    "Northern Plains Ag; Devils Lake", "Red River Valley Coop; Grand Forks",
]


def _rng_for(op_code: str, salt: str = "") -> random.Random:
    return random.Random(f"{RNG_SEED}:{op_code}:{salt}")


def assign_current_stages(op_codes: list[str]) -> dict[str, str]:
    """Every op's current micro stage for its most-recent project-year."""
    assignment: dict[str, str] = dict(NAMED_ANCHOR_STAGES)
    assignment[ENROLLMENT_BEGAN_OP] = "enrollment_began"

    pool_stages = list(REMAINING_STAGE_WEIGHTS.keys())
    pool_weights = list(REMAINING_STAGE_WEIGHTS.values())
    rng = random.Random(RNG_SEED)
    for op_code in sorted(op_codes):
        if op_code in assignment:
            continue
        assignment[op_code] = rng.choices(pool_stages, weights=pool_weights, k=1)[0]
    return assignment


def _stage_dates(current_stage: str, op_code: str) -> dict[str, date]:
    """Plausible increasing dates for every stage up to current_stage, per
    STATUS_MODEL.md's real timeline anchors (S25 baseline Apr-May 2025, F25
    monitoring Oct-Nov 2025, lab data through early 2026, application
    submitted 2026-07-11, "today" mid-July 2026)."""
    rng = _rng_for(op_code, "dates")
    anchors = {
        "enrollment_began": date(2025, 1, 15),
        "all_files_submitted": date(2025, 2, 15),
        "maps_approved": date(2025, 3, 10),
        "baseline_samples_requested": date(2025, 4, 1),
        "baseline_sampling_completed": date(2025, 5, 20),
        "post_season_sampling_completed": date(2025, 11, 5),
        "lab_data_received": date(2026, 2, 10),
        "project_submitted": APPLICATION_SUBMITTED_DATE,
        "project_validated": date(2026, 9, 15),
        "credits_available": date(2026, 10, 30),
    }
    reached_idx = STAGE_INDEX[current_stage]
    dates = {}
    for stage in MICRO_STAGES[:reached_idx]:
        jitter = timedelta(days=rng.randint(-3, 3))
        dates[stage] = anchors[stage] + jitter
    return dates


def build_status_events(op_codes: list[str], stage_assignment: dict[str, str]) -> list[dict]:
    """Event log per docs/STATUS_MODEL.md — one event per stage reached, so
    "last change" and micro-stage history are both meaningful, not just a
    single jump to the final stage."""
    events = []
    by_options = ["katie", "system_seed"]
    for op_code in op_codes:
        current_stage = stage_assignment[op_code]
        dates = _stage_dates(current_stage, op_code)
        rng = _rng_for(op_code, "events")
        for stage, d in dates.items():
            events.append({
                "op_code": op_code,
                "project_year_id": f"{CURRENT_PROJECT_ID}-Y2" if op_code in REAL_2024_HISTORY_OPS else f"{CURRENT_PROJECT_ID}-Y1",
                "stage": stage,
                "entered_at": d.isoformat(),
                "by": "katie" if stage != "enrollment_began" else rng.choice(by_options),
                "note": "Application 3 submitted to BCarbon" if stage == "project_submitted" else "",
                "demo_fabricated": True,
            })
        if op_code in REAL_2024_HISTORY_OPS:
            y1_dates = {
                "enrollment_began": date(2024, 1, 20),
                "all_files_submitted": date(2024, 2, 20),
                "maps_approved": date(2024, 3, 15),
                "baseline_samples_requested": date(2024, 4, 5),
                "baseline_sampling_completed": date(2024, 5, 15),
                "post_season_sampling_completed": date(2024, 11, 1),
                "lab_data_received": date(2025, 1, 20),
                "project_submitted": date(2025, 2, 10),
                "project_validated": date(2025, 4, 1),
                "credits_available": date(2025, 5, 15),
            }
            for stage, d in y1_dates.items():
                events.append({
                    "op_code": op_code,
                    "project_year_id": f"{HISTORY_PROJECT_ID}-Y1",
                    "stage": stage,
                    "entered_at": d.isoformat(),
                    "by": "katie",
                    "note": "",
                    "demo_fabricated": True,
                })
    return events


def build_project_years(op_codes: list[str], stage_assignment: dict[str, str]) -> pd.DataFrame:
    rows = []
    for op_code in op_codes:
        has_history = op_code in REAL_2024_HISTORY_OPS
        rows.append({
            "project_year_id": f"{CURRENT_PROJECT_ID}-Y2" if has_history else f"{CURRENT_PROJECT_ID}-Y1",
            "project_id": CURRENT_PROJECT_ID,
            "op_code": op_code,
            "year_index": 2 if has_history else 1,
            "season_span": "S25 -> F25",
            "submitted_at": APPLICATION_SUBMITTED_DATE.isoformat() if STAGE_INDEX[stage_assignment[op_code]] >= STAGE_INDEX["project_submitted"] else None,
            "is_current": True,
        })
        if has_history:
            rows.append({
                "project_year_id": f"{HISTORY_PROJECT_ID}-Y1",
                "project_id": HISTORY_PROJECT_ID,
                "op_code": op_code,
                "year_index": 1,
                "season_span": "S24 -> F24",
                "submitted_at": date(2025, 2, 10).isoformat(),
                "is_current": False,
            })
    return pd.DataFrame(rows)


def fabricate_2024_credit_ledger(op_code: str, current_cycle_credited_t: float) -> dict:
    """Year-1 (2024) credited tonnage — no separate 2024 application exists
    to source real numbers from, so magnitude is modeled on the op's own
    Project 3 (2025) credited tonnage (acreage/soil don't change year to
    year) with plausible variance. Fully demo_fabricated, as documented in
    docs/DATA_PIPELINE.md Stage 7.2."""
    rng = _rng_for(op_code, "credit2024")
    factor = rng.uniform(0.80, 1.05)
    credited_t = round(max(current_cycle_credited_t, 0.0) * factor, 1)
    distributed_usd = round(credited_t * DEMO_PRICE_PER_TONNE_USD * GROWER_SHARE, 2)
    return {
        "op_code": op_code,
        "project_year_id": f"{HISTORY_PROJECT_ID}-Y1",
        "credited_t": credited_t,
        "status": "distributed",
        "distributed_usd": distributed_usd,
        "distributed_at": date(2025, 6, 1).isoformat(),
        "demo_fabricated": True,
    }


def fabricate_grower_since(op_code: str) -> str:
    rng = _rng_for(op_code, "grower_since")
    year = 2024 if op_code.startswith("24-") or op_code == "24-18" else 2025
    month = rng.randint(1, 3) if year == 2024 else rng.randint(1, 4)
    day = rng.randint(1, 28)
    return date(year, month, day).isoformat()


def fabricate_enrollments(op_codes: list[str], op_acres: dict[str, float]) -> list[dict]:
    """Extends the real 4-row distributor export with one (some ops: two)
    fabricated record(s) per op — docs/DATA_PIPELINE.md Stage 7.3."""
    rows = []
    rng_global = random.Random(RNG_SEED)
    two_enrollment_ops = set(rng_global.sample(sorted(op_codes), k=max(1, len(op_codes) // 8)))
    missing_docs_ops = set(rng_global.sample(sorted(op_codes), k=max(1, len(op_codes) // 10))) | {ENROLLMENT_BEGAN_OP}

    for op_code in op_codes:
        n_records = 2 if op_code in two_enrollment_ops else 1
        acres = op_acres.get(op_code, 1000.0)
        for i in range(n_records):
            rng = _rng_for(op_code, f"enrollment{i}")
            share = 1.0 if n_records == 1 else (0.6 if i == 0 else 0.4)
            record_acres = round(acres * share, 1)
            tote_count = max(1, round(record_acres / 1100))
            submitted = date(2024, 11, 1) + timedelta(days=rng.randint(0, 150))
            missing = op_code in missing_docs_ops and i == 0
            docs_needed = rng.sample(DOC_CHECKLIST, k=rng.randint(1, 2)) if missing else []
            docs_received = [d for d in DOC_CHECKLIST if d not in docs_needed]
            rows.append({
                "enrollment_id": f"demo-{op_code}-{i}",
                "op_code": op_code,
                "farmer_name": None,  # filled from crosswalk op_label downstream
                "entity_name": None,
                "distributor": rng.choice(DISTRIBUTOR_NAMES),
                "total_acreage": record_acres,
                "billed_acreage": round(record_acres * rng.uniform(0.97, 1.0), 1),
                "tote_count": tote_count,
                "status": "completed" if not missing else "in_progress",
                "bill_of_sale_at": (submitted + timedelta(days=30)).isoformat() if not missing else None,
                "submitted_at": submitted.isoformat(),
                "docs_received": docs_received,
                "docs_needed": docs_needed,
                "demo_fabricated": True,
            })
    return rows
