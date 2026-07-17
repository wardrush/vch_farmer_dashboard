/**
 * Client-side stratified soil-sampling engine.
 *
 * Turns baked SSURGO texture strata + fabricated elevation (web/public/data/
 * sampling/*) into a concrete sampling plan: stratum sample sizes, low/high
 * elevation centroids, and ~10 cores per centroid (each a unique lab number +
 * barcode) — following the BCarbon Soil Protocol v3.0 / Verra VM0042 approach
 * the user described.
 *
 * The statistics are demo-grade but coherent: sample sizes fall out of a
 * target confidence-interval half-width on the stratum's carbon-gain estimate,
 * given the within-stratum variance (measured from prior samples where they
 * exist, otherwise fabricated). Sliders (density, clustering, acreage-vs-cost)
 * and the naive/prior-informed toggle all feed this one function so the map,
 * table, cost, and warnings stay in sync.
 *
 * Everything the engine emits carries demo_fabricated: true.
 */

// ----------------------------------------------------------------------------
// Baked-input types (match pipeline/sampling_artifacts.py)
// ----------------------------------------------------------------------------

export interface StratumInput {
  texture_class: string;
  acres: number;
  acres_share_pct: number;
  n_fields: number;
  stratum_relief_m: number;
  stratum_elev_min_m: number | null;
  stratum_elev_max_m: number | null;
  elevation_split_eligible: boolean;
  avg_bulk_density_g_cm3: number | null;
  sand_pct: number | null;
  silt_pct: number | null;
  clay_pct: number | null;
  prior_n_baseline: number | null;
  prior_n_monitoring: number | null;
  prior_oc_gain_ppts: number | null;
  prior_oc_gain_lower90_ppts: number | null;
  prior_creditable: boolean | null;
  toc_sd_pct: number | null;
  toc_sd_source: "measured" | "fabricated";
}

export interface StrataFile {
  op_code: string;
  op_label: string;
  region: string | null;
  state: string | null;
  total_acres: number;
  n_fields: number;
  n_textures: number;
  relief_threshold_m: number;
  has_prior_samples: boolean;
  strata: StratumInput[];
}

export interface FieldStratProps {
  field_id: number;
  field_name: string | null;
  acres: number;
  texture_class: string | null;
  farmable_acres: number;
  elev_min_m: number | null;
  elev_max_m: number | null;
  elev_mean_m: number | null;
  relief_m: number | null;
  low_pt: [number, number] | null;
  high_pt: [number, number] | null;
}

export interface SamplingIndexRow {
  op_code: string;
  op_label: string;
  region: string | null;
  state: string | null;
  n_fields: number;
  acres: number;
  n_textures: number;
  has_prior_samples: boolean;
  has_elevation_split: boolean;
}

// ----------------------------------------------------------------------------
// Engine parameters
// ----------------------------------------------------------------------------

export interface EngineParams {
  useElevation: boolean;
  reliefThresholdM: number;
  mode: "naive" | "prior";
  /** Multiplies computed sample sizes: 0.5 (fewer) .. 2.0 (more). */
  densityMultiplier: number;
  /** 0 = maximum spread (representative) .. 1 = tight clusters (min driving). */
  clustering: number;
  /** Strata smaller than either threshold are demoted (see smallStratumMode). */
  minStratumAcres: number;
  minSharePct: number;
  smallStratumMode: "tracking" | "exclude";
  coresPerCentroid: number;
  coreRadiusMinM: number;
  coreRadiusMaxM: number;
  /** Target 90% CI half-width on stratum OC-gain estimate (percentage points). */
  targetCiHalfWidthPpts: number;
  costPerCoreUsd: number;
  seed: number;
}

export const DEFAULT_PARAMS: EngineParams = {
  useElevation: true,
  reliefThresholdM: 6,
  mode: "naive",
  densityMultiplier: 1,
  clustering: 0.2,
  minStratumAcres: 40,
  minSharePct: 1.5,
  smallStratumMode: "tracking",
  coresPerCentroid: 10,
  coreRadiusMinM: 10,
  coreRadiusMaxM: 50,
  targetCiHalfWidthPpts: 0.25,
  costPerCoreUsd: 32,
  seed: 1,
};

const Z90 = 1.645; // one-sided 90% normal quantile (matches lower-90 convention)

// ----------------------------------------------------------------------------
// Plan output types
// ----------------------------------------------------------------------------

export type StratumStatus = "sampled" | "tracking" | "excluded";
export type ElevationBand = "low" | "high" | "all";

export interface PlannedStratum {
  stratum_id: string;
  texture_class: string;
  acres: number;
  acres_share_pct: number;
  n_fields: number;
  status: StratumStatus;
  reason: string | null;
  elevation_split: boolean;
  n_centroids: number;
  n_cores: number;
  gain_sd_ppts: number;
  sd_source: "measured" | "fabricated";
  ci_half_width_ppts: number;
  prior_ci_half_width_ppts: number | null;
  power_ok: boolean;
  prior_n_monitoring: number | null;
  prior_oc_gain_ppts: number | null;
  prior_creditable: boolean | null;
}

export interface Centroid {
  id: string;
  stratum_id: string;
  texture_class: string;
  elevation_band: ElevationBand;
  field_id: number | null;
  lat: number;
  lon: number;
}

export interface Core {
  core_uuid: string;
  barcode: string;
  lab_no: string;
  centroid_id: string;
  stratum_id: string;
  texture_class: string;
  elevation_band: ElevationBand;
  op_code: string;
  farmer: string;
  lat: number;
  lon: number;
  demo_fabricated: true;
}

export interface PlanTotals {
  n_strata: number;
  n_sampled: number;
  n_tracking: number;
  n_excluded: number;
  n_centroids: number;
  n_cores: number;
  cost_usd: number;
  driving_index_km: number;
  n_underpowered: number;
}

export interface SamplingPlan {
  op_code: string;
  op_label: string;
  region: string | null;
  generated_at: string;
  params: EngineParams;
  strata: PlannedStratum[];
  centroids: Centroid[];
  cores: Core[];
  totals: PlanTotals;
}

// ----------------------------------------------------------------------------
// Deterministic RNG (mulberry32)
// ----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shortId(rng: () => number, len = 10): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * 16)];
  return s;
}

// ----------------------------------------------------------------------------
// Geometry helpers
// ----------------------------------------------------------------------------

type Ring = number[][];

function ringsOf(geom: GeoJSON.Geometry): Ring[] {
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p) => p[0]);
  return [];
}

function bboxOfRings(rings: Ring[]): [number, number, number, number] {
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    }
  return [minx, miny, maxx, maxy];
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInAnyRing(lon: number, lat: number, rings: Ring[]): boolean {
  return rings.some((r) => pointInRing(lon, lat, r));
}

function centroidOfRings(rings: Ring[]): [number, number] {
  let sx = 0,
    sy = 0,
    n = 0;
  for (const r of rings)
    for (const [x, y] of r) {
      sx += x;
      sy += y;
      n++;
    }
  return n ? [sx / n, sy / n] : [0, 0];
}

/** Random interior point via rejection sampling; falls back to centroid. */
function randomInterior(rings: Ring[], rng: () => number): [number, number] {
  const [minx, miny, maxx, maxy] = bboxOfRings(rings);
  for (let i = 0; i < 40; i++) {
    const x = minx + rng() * (maxx - minx);
    const y = miny + rng() * (maxy - miny);
    if (pointInAnyRing(x, y, rings)) return [x, y];
  }
  return centroidOfRings(rings);
}

function metersToDeg(dxM: number, dyM: number, lat: number): [number, number] {
  const dLat = dyM / 111320;
  const dLon = dxM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [dLon, dLat];
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180,
    la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Nearest-neighbour tour length as a cheap driving-distance proxy. */
function drivingIndexKm(points: [number, number][]): number {
  if (points.length < 2) return 0;
  const used = new Array(points.length).fill(false);
  let cur = 0;
  used[0] = true;
  let total = 0;
  for (let step = 1; step < points.length; step++) {
    let best = -1,
      bestD = Infinity;
    for (let j = 0; j < points.length; j++) {
      if (used[j]) continue;
      const d = haversineKm(points[cur], points[j]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) break;
    used[best] = true;
    total += bestD;
    cur = best;
  }
  return total;
}

// ----------------------------------------------------------------------------
// Sample-size model
// ----------------------------------------------------------------------------

/** Fallback within-stratum SD of OC gain (%pts) when no samples exist. Coarse
 * texture -> more spatial variability. Fabricated demo value. */
function fabricatedSd(texture: string): number {
  const t = texture.toLowerCase();
  if (t.includes("sand")) return 0.75;
  if (t.includes("clay")) return 0.45;
  if (t.includes("muck") || t.includes("organic")) return 0.9;
  return 0.55; // loams, silts
}

/** n locations needed for a target 90% CI half-width given SD. */
function nForCi(sd: number, halfWidth: number): number {
  if (halfWidth <= 0) return 8;
  return Math.max(1, Math.ceil(((Z90 * sd) / halfWidth) ** 2));
}

function ciHalfWidth(sd: number, n: number): number {
  if (n <= 0) return Infinity;
  return (Z90 * sd) / Math.sqrt(n);
}

interface StratumPlanCalc {
  status: StratumStatus;
  reason: string | null;
  elevationSplit: boolean;
  nCentroids: number;
  sd: number;
  sdSource: "measured" | "fabricated";
  ciHalf: number;
  priorCiHalf: number | null;
  powerOk: boolean;
}

function planStratum(s: StratumInput, p: EngineParams): StratumPlanCalc {
  const sd = s.toc_sd_pct != null ? s.toc_sd_pct : fabricatedSd(s.texture_class);
  const sdSource = s.toc_sd_pct != null ? s.toc_sd_source : "fabricated";

  // small-stratum rule (acreage vs cost)
  if (s.acres < p.minStratumAcres || s.acres_share_pct < p.minSharePct) {
    if (p.smallStratumMode === "exclude") {
      return {
        status: "excluded",
        reason: `< ${p.minStratumAcres} ac or < ${p.minSharePct}% of project`,
        elevationSplit: false,
        nCentroids: 0,
        sd,
        sdSource,
        ciHalf: Infinity,
        priorCiHalf: null,
        powerOk: true,
      };
    }
    return {
      status: "tracking",
      reason: `small stratum — 1 tracking sample`,
      elevationSplit: false,
      nCentroids: 1,
      sd,
      sdSource,
      ciHalf: ciHalfWidth(sd, 1),
      priorCiHalf: null,
      powerOk: true,
    };
  }

  const elevationSplit = p.useElevation && s.elevation_split_eligible && s.stratum_relief_m >= p.reliefThresholdM;
  const base = elevationSplit ? 2 : 1;

  // statistical requirement from the CI target
  let nStat = nForCi(sd, p.targetCiHalfWidthPpts);

  // prior-informed: if a prior gain exists but its CI is wide, add points to
  // close it toward the target (optimise crediting).
  let priorCiHalf: number | null = null;
  if (
    p.mode === "prior" &&
    s.prior_oc_gain_ppts != null &&
    s.prior_oc_gain_lower90_ppts != null &&
    s.prior_n_monitoring != null &&
    s.prior_n_monitoring > 0
  ) {
    priorCiHalf = Math.max(0, s.prior_oc_gain_ppts - s.prior_oc_gain_lower90_ppts);
    const priorLocations = Math.max(1, Math.round(s.prior_n_monitoring / p.coresPerCentroid));
    if (priorCiHalf > p.targetCiHalfWidthPpts && s.prior_oc_gain_ppts > 0) {
      // n scales with (observedHalf / target)^2
      const needed = Math.ceil(priorLocations * (priorCiHalf / p.targetCiHalfWidthPpts) ** 2);
      nStat = Math.max(nStat, needed);
      // extra weight for a real-but-uncredited gain (CI straddles zero)
      if (s.prior_creditable === false && s.prior_oc_gain_ppts > 0) nStat += 2;
    } else {
      // already tight — a maintenance level is enough
      nStat = Math.max(base, Math.min(nStat, priorLocations));
    }
  }

  // acreage cap so a modest stratum never demands a huge crew
  const areaCap = Math.max(base, Math.min(14, Math.ceil(s.acres / 500) + base));

  let n = Math.min(Math.max(base, nStat), areaCap);
  n = Math.round(n * p.densityMultiplier);
  n = Math.max(elevationSplit ? 2 : 1, Math.min(n, 20));

  const ciHalf = ciHalfWidth(sd, n);
  const powerOk = ciHalf <= p.targetCiHalfWidthPpts * 1.5 && n >= (elevationSplit ? 2 : 1);

  return {
    status: "sampled",
    reason: null,
    elevationSplit,
    nCentroids: n,
    sd,
    sdSource,
    ciHalf,
    priorCiHalf,
    powerOk,
  };
}

// ----------------------------------------------------------------------------
// Point placement
// ----------------------------------------------------------------------------

interface FieldGeom {
  props: FieldStratProps;
  rings: Ring[];
  center: [number, number];
}

function placeCentroidsForStratum(
  stratumId: string,
  s: StratumInput,
  calc: StratumPlanCalc,
  fields: FieldGeom[],
  p: EngineParams,
  rng: () => number,
): Centroid[] {
  if (calc.nCentroids <= 0 || fields.length === 0) return [];

  // hub = stratum centroid, used by the clustering pull
  const hub: [number, number] = [
    fields.reduce((a, f) => a + f.center[0], 0) / fields.length,
    fields.reduce((a, f) => a + f.center[1], 0) / fields.length,
  ];

  const out: Centroid[] = [];
  const bands: ElevationBand[] = [];
  if (calc.elevationSplit) {
    bands.push("low", "high");
    while (bands.length < calc.nCentroids) bands.push("all");
  } else {
    for (let i = 0; i < calc.nCentroids; i++) bands.push("all");
  }

  // fields sorted by elevation for the low/high picks
  const byLow = [...fields].sort((a, b) => (a.props.elev_min_m ?? 0) - (b.props.elev_min_m ?? 0));
  const byHigh = [...fields].sort((a, b) => (b.props.elev_max_m ?? 0) - (a.props.elev_max_m ?? 0));

  bands.forEach((band, i) => {
    let lon: number, lat: number, fieldId: number | null;
    if (band === "low" && byLow[0]?.props.low_pt) {
      [lon, lat] = byLow[0].props.low_pt;
      fieldId = byLow[0].props.field_id;
    } else if (band === "high" && byHigh[0]?.props.high_pt) {
      [lon, lat] = byHigh[0].props.high_pt;
      fieldId = byHigh[0].props.field_id;
    } else {
      // area-weighted-ish: cycle through fields, random interior point
      const f = fields[i % fields.length];
      [lon, lat] = randomInterior(f.rings, rng);
      fieldId = f.props.field_id;
    }

    // clustering pull toward the hub (reduces driving, keeps stratum coverage)
    if (p.clustering > 0) {
      lon = lon + (hub[0] - lon) * p.clustering * 0.6;
      lat = lat + (hub[1] - lat) * p.clustering * 0.6;
    }

    out.push({
      id: `${stratumId}-c${i}-${shortId(rng, 4)}`,
      stratum_id: stratumId,
      texture_class: s.texture_class,
      elevation_band: band,
      field_id: fieldId,
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
    });
  });

  return out;
}

function placeCores(
  centroid: Centroid,
  opCode: string,
  farmer: string,
  p: EngineParams,
  rng: () => number,
  labCounter: { n: number },
): Core[] {
  const cores: Core[] = [];
  for (let i = 0; i < p.coresPerCentroid; i++) {
    const bearing = rng() * 2 * Math.PI;
    const radius = p.coreRadiusMinM + rng() * (p.coreRadiusMaxM - p.coreRadiusMinM);
    const dxM = Math.cos(bearing) * radius;
    const dyM = Math.sin(bearing) * radius;
    const [dLon, dLat] = metersToDeg(dxM, dyM, centroid.lat);
    labCounter.n += 1;
    const seq = labCounter.n;
    cores.push({
      core_uuid: shortId(rng, 12),
      barcode: `VCH-${opCode}-${String(seq).padStart(4, "0")}`,
      lab_no: `L${100000 + seq}`,
      centroid_id: centroid.id,
      stratum_id: centroid.stratum_id,
      texture_class: centroid.texture_class,
      elevation_band: centroid.elevation_band,
      op_code: opCode,
      farmer,
      lat: +(centroid.lat + dLat).toFixed(6),
      lon: +(centroid.lon + dLon).toFixed(6),
      demo_fabricated: true,
    });
  }
  return cores;
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------

export function generatePlan(
  strata: StrataFile,
  fieldFeatures: GeoJSON.Feature[],
  params: EngineParams,
): SamplingPlan {
  const seed = (params.seed >>> 0) ^ hashStr(strata.op_code);
  const rng = mulberry32(seed);

  // index field geometry by texture
  const byTexture = new Map<string, FieldGeom[]>();
  for (const f of fieldFeatures) {
    const props = f.properties as unknown as FieldStratProps;
    if (!props.texture_class) continue;
    const rings = ringsOf(f.geometry);
    if (rings.length === 0) continue;
    const fg: FieldGeom = { props, rings, center: centroidOfRings(rings) };
    const arr = byTexture.get(props.texture_class) ?? [];
    arr.push(fg);
    byTexture.set(props.texture_class, arr);
  }

  const plannedStrata: PlannedStratum[] = [];
  const centroids: Centroid[] = [];
  const cores: Core[] = [];
  const labCounter = { n: 0 };

  for (const s of strata.strata) {
    const stratumId = `${strata.op_code}:${s.texture_class.replace(/\s+/g, "_")}`;
    const calc = planStratum(s, params);
    const fields = byTexture.get(s.texture_class) ?? [];

    const stratumCentroids = placeCentroidsForStratum(stratumId, s, calc, fields, params, rng);
    centroids.push(...stratumCentroids);
    for (const c of stratumCentroids) {
      cores.push(...placeCores(c, strata.op_code, strata.op_label, params, rng, labCounter));
    }

    plannedStrata.push({
      stratum_id: stratumId,
      texture_class: s.texture_class,
      acres: s.acres,
      acres_share_pct: s.acres_share_pct,
      n_fields: s.n_fields,
      status: calc.status,
      reason: calc.reason,
      elevation_split: calc.elevationSplit,
      n_centroids: stratumCentroids.length,
      n_cores: stratumCentroids.length * params.coresPerCentroid,
      gain_sd_ppts: +calc.sd.toFixed(3),
      sd_source: calc.sdSource,
      ci_half_width_ppts: calc.ciHalf === Infinity ? Infinity : +calc.ciHalf.toFixed(3),
      prior_ci_half_width_ppts: calc.priorCiHalf != null ? +calc.priorCiHalf.toFixed(3) : null,
      power_ok: calc.powerOk,
      prior_n_monitoring: s.prior_n_monitoring,
      prior_oc_gain_ppts: s.prior_oc_gain_ppts,
      prior_creditable: s.prior_creditable,
    });
  }

  return {
    op_code: strata.op_code,
    op_label: strata.op_label,
    region: strata.region,
    generated_at: new Date().toISOString(),
    params,
    strata: plannedStrata,
    centroids,
    cores,
    totals: computeTotals(plannedStrata, centroids, cores, params),
  };
}

/** Recompute per-stratum counts, CI, power flags and totals after manual
 * point edits (drag/delete/add), without re-placing anything. */
export function recalcAfterEdit(plan: SamplingPlan): SamplingPlan {
  const centByStratum = new Map<string, number>();
  const coreByStratum = new Map<string, number>();
  for (const c of plan.centroids) centByStratum.set(c.stratum_id, (centByStratum.get(c.stratum_id) ?? 0) + 1);
  for (const c of plan.cores) coreByStratum.set(c.stratum_id, (coreByStratum.get(c.stratum_id) ?? 0) + 1);

  const strata = plan.strata.map((s) => {
    const n = centByStratum.get(s.stratum_id) ?? 0;
    const ci = n > 0 ? +((Z90 * s.gain_sd_ppts) / Math.sqrt(n)).toFixed(3) : Infinity;
    let status: StratumStatus = s.status;
    if (s.status !== "excluded" && n === 0) status = "excluded";
    const powerOk = status === "excluded" ? true : ci <= plan.params.targetCiHalfWidthPpts * 1.5 && n >= (s.elevation_split ? 2 : 1);
    return { ...s, n_centroids: n, n_cores: coreByStratum.get(s.stratum_id) ?? 0, ci_half_width_ppts: ci, power_ok: powerOk, status };
  });

  return { ...plan, strata, totals: computeTotals(strata, plan.centroids, plan.cores, plan.params) };
}

export function computeTotals(
  strata: PlannedStratum[],
  centroids: Centroid[],
  cores: Core[],
  params: EngineParams,
): PlanTotals {
  return {
    n_strata: strata.length,
    n_sampled: strata.filter((s) => s.status === "sampled").length,
    n_tracking: strata.filter((s) => s.status === "tracking").length,
    n_excluded: strata.filter((s) => s.status === "excluded").length,
    n_centroids: centroids.length,
    n_cores: cores.length,
    cost_usd: cores.length * params.costPerCoreUsd,
    driving_index_km: +drivingIndexKm(centroids.map((c) => [c.lon, c.lat] as [number, number])).toFixed(1),
    n_underpowered: strata.filter((s) => s.status === "sampled" && !s.power_ok).length,
  };
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

export function coresToCsv(plan: SamplingPlan): string {
  const cols = [
    "core_uuid",
    "barcode",
    "lab_no",
    "op_code",
    "farmer",
    "stratum_id",
    "texture_class",
    "elevation_band",
    "centroid_id",
    "lat",
    "lon",
    "demo_fabricated",
  ];
  const rows = plan.cores.map((c) =>
    [
      c.core_uuid,
      c.barcode,
      c.lab_no,
      c.op_code,
      csvCell(c.farmer),
      c.stratum_id,
      csvCell(c.texture_class),
      c.elevation_band,
      c.centroid_id,
      c.lat,
      c.lon,
      "true",
    ].join(","),
  );
  return [cols.join(","), ...rows].join("\n");
}

export function coresToGeoJson(plan: SamplingPlan): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: plan.cores.map((c) => ({
      type: "Feature",
      properties: {
        core_uuid: c.core_uuid,
        barcode: c.barcode,
        lab_no: c.lab_no,
        op_code: c.op_code,
        farmer: c.farmer,
        texture_class: c.texture_class,
        elevation_band: c.elevation_band,
        stratum_id: c.stratum_id,
        centroid_id: c.centroid_id,
        demo_fabricated: true,
      },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}

function csvCell(v: string): string {
  if (v == null) return "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
