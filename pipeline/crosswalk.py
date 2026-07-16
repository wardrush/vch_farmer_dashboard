"""docs/IDENTITY_CROSSWALK.md — operation identity resolution.

data/canonical/operations_crosswalk.csv is generated once (if it doesn't
already exist) and treated as authoritative on every later run — the
analyst hand-edits it; the pipeline never overwrites it silently
(CLAUDE.md hard rule 7).
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
from rapidfuzz import fuzz

from adapters import FileAdapter
from normalizers import normalize_name

REPO_ROOT = Path(__file__).resolve().parent.parent
CROSSWALK_PATH = REPO_ROOT / "data" / "canonical" / "operations_crosswalk.csv"
UNRESOLVED_PATH = REPO_ROOT / "data" / "canonical" / "_unresolved.csv"

TEST_OP_CODE = "TEST"
UNMATCHED_OP_CODE = "UNMATCHED"
EEG_OP_CODE = "24-18"  # synthetic — see note below

FUZZY_THRESHOLD = 90

# Hard cases docs/IDENTITY_CROSSWALK.md calls out, plus everything plain
# token_set_ratio(name, op_label) < 90 misses in the real 2025 data (verified
# by inspection: samples `customer`/`farm_business` vs gpkg `op_label`).
# Keyed on normalize_name(raw) -> op_code.
MANUAL_OVERRIDES: dict[str, str] = {
    normalize_name("Hong"): "24-05",
    normalize_name("Kohls Farms Inc."): "24-09",
    normalize_name("Kohls Farm, Inc"): "24-09",
    normalize_name("RSK INC"): "24-11",
    normalize_name("Shane Kyllo / Braaten / Bratten"): "24-11",
    normalize_name("Cody Braaten"): "24-11",
    normalize_name("RT Farms & Trucking Inc"): "24-11",
    normalize_name("Fulgelberg Farms"): "24-07",  # the lab typo — QA tie-in (DEMO_SCRIPT.md)
    normalize_name("Shawn Knutson"): "24-12",
    normalize_name("Mark Arensen"): "24-16",
    normalize_name("Ross Johnson"): "24-10",
    normalize_name("Jace Schatzke (Schatzke Farms)"): "24-14",
    normalize_name("Sean Cose (Cose Farms)"): "25-49",
    normalize_name("Brandon Downs"): "25-20",
    normalize_name("Bill & Brad Fisher"): "25-19",
    normalize_name("Brian Toftela"): "25-23",
    normalize_name("DAN PFEIFLE"): "25-30",
    normalize_name("JORDAN SWANSON"): "25-40",
    normalize_name("K Sorum"): "25-42",
    normalize_name("MAJERES FARMS"): "25-45",
    normalize_name("Maertens"): "25-44",
    normalize_name("WERNER FARMS"): "25-52",
    normalize_name("Zach Jacobson (Z&Z Farms)"): "25-53",
    normalize_name("Zach Jacobson Z&Z Farms"): "25-53",
    normalize_name("Ben Bring New"): "24-17",
    normalize_name("Jason Rossler"): "24-15",  # gpkg spells it "Jason Roesler" — another lab-typo case
    normalize_name("Alliance Farms (Jangula)"): "25-18",
    # Stuart Eeg / Eeg Brothers — late add (2026-07-10); farmer-table note says
    # his 47 newly provided fields aren't in this gpkg snapshot, and the ground
    # tagged LAST_BUSIN="Stuart Eeg" in the gpkg is pre-existing acreage already
    # counted under Mark Arnesen (24-16). He gets his own op_code so his
    # credit_ledger/sample rows aren't lost, but NO gpkg fields attach to it —
    # attaching 24-16's fields here would double-count acres already in 24-16.
    normalize_name("Stuart Eeg"): EEG_OP_CODE,
    normalize_name("Stuart Eeg (Eeg Brothers)"): EEG_OP_CODE,
    # Not real operations
    normalize_name("2023 Test Trials"): TEST_OP_CODE,
    normalize_name("2023 Test Trials."): TEST_OP_CODE,
}

CSV_COLUMNS = [
    "op_code", "op_label", "entity_name", "last_busin_variants",
    "samples_customer_variants", "samples_farm_business_variants",
    "farmer_table_name", "distributor_enrollment_ids", "region", "state",
    "enrollment_year", "enroll_origin", "notes", "resolution",
]


def _add_variant(bag: dict[str, set[str]], op_code: str, raw: str | None) -> None:
    if not raw:
        return
    bag.setdefault(op_code, set()).add(raw)


def _region_for(state: str | None, samples_regions: set[str]) -> str:
    if state == "MN":
        return "MN"
    non_null = {r for r in samples_regions if r}
    if len(non_null) == 1:
        return next(iter(non_null))
    if "ND_E" in non_null:
        return "ND_E"
    if "ND_W" in non_null:
        return "ND_W"
    return "ND_E"


def build_crosswalk() -> tuple[pd.DataFrame, list[dict]]:
    """Generation algorithm — seeds from gpkg op_code/op_label, attaches every
    other source's name variants via exact/fuzzy match, reports the rest."""
    adapter = FileAdapter()
    fields = adapter.fields()
    samples = adapter.samples()
    farmer_table = adapter.farmer_table()
    enrollments = adapter.enrollments()

    seed = (
        fields.dropna(subset=["op_code_raw"])[["op_code_raw", "op_label_raw", "state", "enroll_origin", "enrollment_year"]]
        .drop_duplicates(subset=["op_code_raw"])
        .rename(columns={"op_code_raw": "op_code", "op_label_raw": "op_label"})
    )

    rows: dict[str, dict] = {}
    for _, r in seed.iterrows():
        rows[r["op_code"]] = {
            "op_code": r["op_code"],
            "op_label": r["op_label"],
            "entity_name": r["op_label"],
            "state": r["state"],
            "enroll_origin": r["enroll_origin"],
            "enrollment_year": int(r["enrollment_year"]) if pd.notna(r["enrollment_year"]) else None,
            "resolution": "auto_exact",
            "notes": "",
        }
    # Synthetic Eeg row — see MANUAL_OVERRIDES note.
    rows[EEG_OP_CODE] = {
        "op_code": EEG_OP_CODE,
        "op_label": "Eeg Brothers",
        "entity_name": "Eeg Brothers",
        "state": "ND",
        "enroll_origin": "2024_reenrolled",
        "enrollment_year": 2024,
        "resolution": "manual",
        "notes": (
            "Late add 2026-07-10; ground under LAST_BUSIN='Stuart Eeg' in this gpkg "
            "snapshot is pre-existing acreage already counted under Mark Arnesen "
            "(24-16) — do not double count. His farmer-table creditable acres cover "
            "47 fields added after this gpkg export, so no field geometries exist "
            "for this op_code in the current dataset."
        ),
    }

    last_busin_variants: dict[str, set[str]] = {}
    for _, r in fields.dropna(subset=["op_code_raw"]).iterrows():
        _add_variant(last_busin_variants, r["op_code_raw"], r["last_busin_raw"])

    known_op_codes = set(rows.keys())
    label_pool = {normalize_name(v["op_label"]): code for code, v in rows.items()}

    def resolve_name(raw: str | None) -> tuple[str | None, str, int | None]:
        if not raw:
            return None, "unresolved", None
        norm = normalize_name(raw)
        if not norm:
            return None, "unresolved", None
        if norm in MANUAL_OVERRIDES:
            return MANUAL_OVERRIDES[norm], "manual", 100
        if norm in label_pool:
            return label_pool[norm], "auto_exact", 100
        best_code, best_score = None, -1
        for cand_norm, code in label_pool.items():
            score = fuzz.token_set_ratio(norm, cand_norm)
            if score > best_score:
                best_score, best_code = score, code
        if best_score >= FUZZY_THRESHOLD:
            return best_code, "auto_fuzzy", best_score
        return None, "unresolved", best_score

    def is_test_farm_business(raw: str | None) -> bool:
        return bool(raw) and MANUAL_OVERRIDES.get(normalize_name(raw)) == TEST_OP_CODE

    unresolved: dict[tuple[str, str], dict] = {}

    def record_unresolved(raw: str, source: str, score: int | None):
        key = (normalize_name(raw), source)
        if key not in unresolved:
            unresolved[key] = {"raw_value": raw, "source": source, "row_count": 0, "best_score": score}
        unresolved[key]["row_count"] += 1

    samples_customer_variants: dict[str, set[str]] = {}
    samples_farm_business_variants: dict[str, set[str]] = {}
    samples_regions: dict[str, set[str]] = {}
    for _, r in samples.iterrows():
        # "2023 Test Trials" rows carry a real customer name (e.g. "Tim &
        # Randy Garrett", whose field the test ran on) but must still resolve
        # to TEST — checked narrowly, NOT a general farm_business-first
        # priority (real data has mismatched rows, e.g. customer="Hong Farms
        # (Curt & Chris Hong)" / farm_business="RSK INC" — customer wins there).
        if is_test_farm_business(r["farm_business_raw"]):
            code, resolution, score = TEST_OP_CODE, "manual", 100
        else:
            raw = r["customer_raw"] or r["farm_business_raw"]
            code, resolution, score = resolve_name(raw)
            if code is None:
                code, resolution, score = resolve_name(r["farm_business_raw"])
        if code is None:
            record_unresolved(raw or "(blank)", "samples.customer/farm_business", score)
            continue
        _add_variant(samples_customer_variants, code, r["customer_raw"])
        _add_variant(samples_farm_business_variants, code, r["farm_business_raw"])
        if code in rows:
            samples_regions.setdefault(code, set()).add(r.get("region"))

    farmer_table_names: dict[str, str] = {}
    for _, r in farmer_table.iterrows():
        code, resolution, score = resolve_name(r["farmer_table_name"])
        if code is None:
            record_unresolved(r["farmer_table_name"], "farmer_table", score)
            continue
        farmer_table_names[code] = r["farmer_table_name"]

    distributor_ids: dict[str, set[str]] = {}
    for _, r in enrollments.iterrows():
        code, resolution, score = resolve_name(r["entity_name"] or r["farmer_name"])
        if code is None:
            record_unresolved(r["entity_name"] or r["farmer_name"], "enrollments", score)
            continue
        _add_variant(distributor_ids, code, r["enrollment_id"])

    for code, row in rows.items():
        row["last_busin_variants"] = "|".join(sorted(last_busin_variants.get(code, [])))
        row["samples_customer_variants"] = "|".join(sorted(samples_customer_variants.get(code, [])))
        row["samples_farm_business_variants"] = "|".join(sorted(samples_farm_business_variants.get(code, [])))
        row["farmer_table_name"] = farmer_table_names.get(code, "")
        row["distributor_enrollment_ids"] = "|".join(sorted(distributor_ids.get(code, [])))
        row["region"] = _region_for(row["state"], samples_regions.get(code, set()))

    df = pd.DataFrame(rows.values())[CSV_COLUMNS]
    df = df.sort_values("op_code").reset_index(drop=True)
    return df, sorted(unresolved.values(), key=lambda u: -u["row_count"])


def load_or_build_crosswalk() -> pd.DataFrame:
    if CROSSWALK_PATH.exists():
        return pd.read_csv(CROSSWALK_PATH, dtype=str, keep_default_na=False).replace({"": pd.NA})
    df, unresolved = build_crosswalk()
    CROSSWALK_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CROSSWALK_PATH, index=False)
    if unresolved:
        pd.DataFrame(unresolved).to_csv(UNRESOLVED_PATH, index=False)
    return df


class Crosswalk:
    """Resolver built from the authoritative CSV. Use for every name join."""

    def __init__(self, df: pd.DataFrame | None = None):
        self.df = df if df is not None else load_or_build_crosswalk()
        # Two tiers: canonical identity columns (op_label/entity_name/
        # farmer_table_name) always win over noisier variant columns
        # (last_busin/samples), which can collide — e.g. real data has a
        # gpkg field row for op 24-15 with LAST_BUSIN="Schatzke Farms", which
        # is 24-14's actual name. Weak matches never override a strong one.
        self._strong_index: dict[str, str] = {}
        self._weak_index: dict[str, str] = {}
        for _, r in self.df.iterrows():
            code = r["op_code"]
            for n in (r["op_label"], r.get("entity_name"), r.get("farmer_table_name")):
                if pd.notna(n) and n:
                    self._strong_index[normalize_name(n)] = code
            for col in ("last_busin_variants", "samples_customer_variants", "samples_farm_business_variants"):
                v = r.get(col)
                if pd.notna(v) and v:
                    for n in v.split("|"):
                        if n:
                            self._weak_index.setdefault(normalize_name(n), code)

    @property
    def op_codes(self) -> set[str]:
        return set(self.df["op_code"])

    def resolve(self, raw: str | None) -> str | None:
        if not raw:
            return None
        norm = normalize_name(raw)
        if not norm:
            return None
        if norm in MANUAL_OVERRIDES:
            return MANUAL_OVERRIDES[norm]
        if norm in self._strong_index:
            return self._strong_index[norm]
        if norm in self._weak_index:
            return self._weak_index[norm]
        for index in (self._strong_index, self._weak_index):
            best_code, best_score = None, -1
            for cand_norm, code in index.items():
                score = fuzz.token_set_ratio(norm, cand_norm)
                if score > best_score:
                    best_score, best_code = score, code
            if best_score >= FUZZY_THRESHOLD:
                return best_code
        return None

    def resolve_field(self, op_code_raw: str | None, last_busin_raw: str | None) -> str | None:
        """gpkg `op_code` IS already the canonical op_code for ~2,691/2,801 rows
        — no fuzzy matching needed, just membership. Only the rows where it's
        null (2 stray "Brian Tofteland" rows in the real data) fall back to
        resolving LAST_BUSIN by name."""
        if op_code_raw and op_code_raw in self.op_codes:
            return op_code_raw
        return self.resolve(last_busin_raw)

    def resolve_sample(self, customer_raw: str | None, farm_business_raw: str | None, match_completeness: str | None) -> str:
        """Business rule (docs/IDENTITY_CROSSWALK.md): match_completeness=unmatched
        always wins (UNMATCHED, analyst QA only). "2023 Test Trials" rows
        resolve to TEST regardless of customer name (checked narrowly — real
        data has mismatched customer/farm_business rows elsewhere, e.g.
        customer="Hong Farms..." / farm_business="RSK INC", where customer
        must win, so this is NOT a general farm_business-first priority)."""
        if match_completeness == "unmatched":
            return UNMATCHED_OP_CODE
        if farm_business_raw and MANUAL_OVERRIDES.get(normalize_name(farm_business_raw)) == TEST_OP_CODE:
            return TEST_OP_CODE
        code = self.resolve(customer_raw)
        if code is None:
            code = self.resolve(farm_business_raw)
        return code or UNMATCHED_OP_CODE


if __name__ == "__main__":
    df, unresolved = build_crosswalk()
    print(f"Resolved {len(df)} operations.")
    print(f"{len(unresolved)} unresolved raw values (see _unresolved.csv preview below):")
    for u in unresolved[:20]:
        print(" ", u)
