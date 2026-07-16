# SNOWFLAKE.md — Fast-follow data platform spec

Future state: Ward's geodata, enrollment, and sample databases land in Snowflake; the pipeline's `SnowflakeAdapter` reads **materialized views** shaped exactly like the canonical entities (`docs/FIELD_MAPPING.md`). The mapping layer moves from Python renames to view definitions — same contract, same names, one place.

## Principles

1. **Views own the mapping.** Raw landing tables keep whatever column names the sources emit (they are not stable); the `CANONICAL` schema views rename/normalize exactly as `source_schemas.py` does today. When a source drifts, fix the view, not the app.
2. **Geometry as GEOGRAPHY.** Store WGS84 `GEOGRAPHY`; export GeoJSON via `ST_ASGEOJSON`. Reprojection from EPSG:5070 happens at ingest (Python `to_4326`, or Snowflake `ST_TRANSFORM` if the account has it).
3. **Crosswalk is a table, not a view.** `CANONICAL.OPERATIONS_CROSSWALK` is loaded from the committed CSV and hand-maintained (or via a tiny admin UI later); all name-based joins go through it.

## Canonical DDL sketch

```sql
CREATE TABLE CANONICAL.OPERATION (
  OP_CODE STRING PRIMARY KEY, OP_LABEL STRING, ENTITY_NAME STRING,
  REGION STRING, STATE STRING, ENROLLMENT_YEAR INT, ENROLL_ORIGIN STRING,
  OWNERSHIP_STATUS STRING, GROWER_SINCE DATE
);
CREATE TABLE CANONICAL.FIELD (
  FIELD_ID INT PRIMARY KEY, OP_CODE STRING, PROJECT_ID STRING,
  FIELD_NAME STRING, BOUNDARY_ACRES FLOAT, GEOM_ACRES FLOAT,
  FARMABLE_ACRES FLOAT, NONFARMABLE_ACRES FLOAT, WATER_ACRES FLOAT,
  DOM_TEXTURE_CLASS STRING, ENROLL_ORIGIN STRING, BASELINE_SEASON STRING,
  MATCH_STATUS STRING, GEOMETRY GEOGRAPHY
);
CREATE TABLE CANONICAL.SOIL_COMPONENT (
  COMPONENT_ID INT PRIMARY KEY, FIELD_ID INT, OP_CODE STRING,
  MUKEY STRING, TEXTURE_CLASS STRING, SMF_CLUSTER STRING,
  AREA_ACRES FLOAT, PCT_OF_FIELD FLOAT, BULK_DENSITY_G_CM3 FLOAT,
  SAND_PCT FLOAT, SILT_PCT FLOAT, CLAY_PCT FLOAT,
  LAND_CLASS STRING, IS_FARMABLE BOOLEAN, IS_PRIMARY_ROW BOOLEAN,
  GEOMETRY GEOGRAPHY
);
CREATE TABLE CANONICAL.SAMPLE_POINT (
  POINT_ID STRING PRIMARY KEY, OP_CODE STRING, PROJECT_ID STRING,
  PERIOD STRING, SAMPLE_ROLE STRING, LAT FLOAT, LON FLOAT,
  TRS STRING, TEXTURE_CLASS STRING, REGION STRING, MATCH_COMPLETENESS STRING
);
CREATE TABLE CANONICAL.LAB_RESULT (
  LAB_RESULT_ID STRING PRIMARY KEY, POINT_ID STRING, SAMPLE_TYPE STRING,
  BD_VARIANT STRING, RECEIVED_DATE DATE, REPORTED_DATE DATE,
  TOC_PCT FLOAT, TC_PCT FLOAT, CCE_PCT FLOAT, INORGANIC_C_PCT FLOAT,
  OM_PCT FLOAT, BULK_DENSITY_G_CM3 FLOAT,
  OUTLIER_SPATIAL_TIER STRING, OUTLIER_TOC_TIER STRING, OUTLIER_BD_FLAG STRING
);
CREATE TABLE CANONICAL.ENROLLMENT (
  ENROLLMENT_ID STRING PRIMARY KEY, OP_CODE STRING, FARMER_NAME STRING,
  ENTITY_NAME STRING, DISTRIBUTOR STRING, TOTAL_ACREAGE FLOAT,
  BILLED_ACREAGE FLOAT, TOTE_COUNT INT, STATUS STRING, BILL_OF_SALE_AT DATE
);
-- STATUS_EVENT and CREDIT_LEDGER mirror docs/STATUS_MODEL.md / FIELD_MAPPING.md
```

## Materialized views (mirror pipeline stages 4–6)

| View | Grain | Mirrors |
|---|---|---|
| `MV_OP_SOIL_ROLLUP` | op × texture_class | Stage 4: acres, farmable/creditable split, n_fields |
| `MV_OP_SUMMARY` | op | index.json: acres, #fields, creditable, dominant texture, region, state |
| `MV_SAMPLE_LAB_MATCHED` | composite point × period | Stage 5: DC+BD paired, popup payload columns |
| `MV_STRATUM_STAT` | project × stratum × period-pair | Stage 5 stats: n, mean TOC, gain, lower-90, density t/ac-ft, n PLSS sections |
| `MV_OP_CREDITS` | op × project_year | Stage 6: measured_gain_t, credited_t, basis, status |
| `MV_ENROLLMENT_STATUS` | enrollment | admin grid incl. docs checklists |

Example:

```sql
CREATE MATERIALIZED VIEW CANONICAL.MV_OP_SOIL_ROLLUP AS
SELECT OP_CODE, TEXTURE_CLASS,
       SUM(AREA_ACRES) AS ACRES,
       SUM(IFF(IS_FARMABLE, AREA_ACRES, 0)) AS CREDITABLE_ACRES,
       COUNT(DISTINCT FIELD_ID) AS N_FIELDS
FROM CANONICAL.SOIL_COMPONENT
WHERE OP_CODE NOT IN ('TEST','UNMATCHED')
GROUP BY OP_CODE, TEXTURE_CLASS;
```

## Adapter cutover checklist

1. Land raw exports; write `CANONICAL` views implementing the FIELD_MAPPING tables (port `normalize_texture`/`normalize_land_class` as SQL `CASE`/`INITCAP` logic).
2. Load `OPERATIONS_CROSSWALK` from the committed CSV.
3. `SnowflakeAdapter` methods = `SELECT * FROM CANONICAL.<entity>` (snowflake-connector-python / snowpark).
4. Run `build.py --adapter snowflake`; the build report fixtures must match the file-adapter run.
5. Statuses may later move from Netlify Blobs into `STATUS_EVENT` with a thin sync function — out of demo scope.
