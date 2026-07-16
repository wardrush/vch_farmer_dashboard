import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Core, Centroid } from "../lib/sampling";

const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: GLYPHS_URL,
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "esri", type: "raster", source: "esri" }],
};

const STREETS_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: GLYPHS_URL,
  sources: {
    osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Band accent colours (stroke), texture drives fill.
const BAND_STROKE: Record<string, string> = { low: "#2f6fb0", high: "#b3402a", all: "#ffffff" };

export type Selection = { kind: "core" | "centroid"; id: string } | null;

export interface SamplingMapProps {
  fieldsGeoJson: GeoJSON.FeatureCollection;
  textureColors: Record<string, string>;
  cores: Core[];
  centroids: Centroid[];
  selected: Selection;
  editMode: boolean;
  onSelect: (sel: Selection) => void;
  onMoveCore: (coreUuid: string, lon: number, lat: number) => void;
  onMoveCentroid: (centroidId: string, lon: number, lat: number) => void;
  height?: string;
}

function textureMatch(colors: Record<string, string>): any {
  const expr: any[] = ["match", ["get", "texture_class"]];
  for (const [k, v] of Object.entries(colors)) expr.push(k, v);
  expr.push("#999999");
  return expr;
}

function coresFC(cores: Core[], selected: Selection): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cores.map((c) => ({
      type: "Feature",
      properties: {
        core_uuid: c.core_uuid,
        texture_class: c.texture_class,
        elevation_band: c.elevation_band,
        band_stroke: BAND_STROKE[c.elevation_band] ?? "#ffffff",
        selected: selected?.kind === "core" && selected.id === c.core_uuid ? 1 : 0,
      },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}

function centroidsFC(centroids: Centroid[], selected: Selection): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: centroids.map((c) => ({
      type: "Feature",
      properties: {
        id: c.id,
        texture_class: c.texture_class,
        elevation_band: c.elevation_band,
        band_stroke: BAND_STROKE[c.elevation_band] ?? "#ffffff",
        selected: selected?.kind === "centroid" && selected.id === c.id ? 1 : 0,
      },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}

export function SamplingMap({
  fieldsGeoJson,
  textureColors,
  cores,
  centroids,
  selected,
  editMode,
  onSelect,
  onMoveCore,
  onMoveCentroid,
  height = "560px",
}: SamplingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<"satellite" | "streets">("satellite");
  const didFit = useRef(false);

  // Keep latest values available to imperative map handlers.
  const stateRef = useRef({ cores, centroids, editMode, onMoveCore, onMoveCentroid, onSelect });
  stateRef.current = { cores, centroids, editMode, onMoveCore, onMoveCentroid, onSelect };

  const coresData = useMemo(() => coresFC(cores, selected), [cores, selected]);
  const centroidsData = useMemo(() => centroidsFC(centroids, selected), [centroids, selected]);

  // init map
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [-97.9, 47.8],
      zoom: 7,
      cooperativeGestures: true,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    // Robust readiness: `load`/`idle`/`styledata` can stall or fire before
    // isStyleLoaded() is true when the basemap tiles are blocked (offline /
    // proxy). Poll so the vector layers always add once the inline style is
    // ready, with a fallback after ~4s.
    let tries = 0;
    const poll = window.setInterval(() => {
      if (map.isStyleLoaded() || ++tries > 40) {
        setReady(true);
        window.clearInterval(poll);
      }
    }, 100);
    map.on("load", () => setReady(true));
    return () => {
      window.clearInterval(poll);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // basemap switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemap === "satellite" ? SATELLITE_STYLE : STREETS_STYLE);
    map.once("styledata", () => {
      setReady(false);
      requestAnimationFrame(() => setReady(true));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // build layers once ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // fields
    if (!map.getSource("fields")) {
      map.addSource("fields", { type: "geojson", data: fieldsGeoJson });
      map.addLayer({
        id: "fields-fill",
        type: "fill",
        source: "fields",
        paint: { "fill-color": textureMatch(textureColors), "fill-opacity": 0.4 },
      });
      map.addLayer({
        id: "fields-line",
        type: "line",
        source: "fields",
        paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.5 },
      });
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", "fields-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { field_name?: string; texture_class?: string; acres?: number; relief_m?: number };
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="p-2 text-xs"><div class="font-semibold">${p.texture_class ?? "—"}</div><div>${p.field_name ?? ""} · ${(p.acres ?? 0).toFixed(0)} ac · relief ${(p.relief_m ?? 0).toFixed(0)} m</div></div>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "fields-fill", () => popup.remove());
    } else {
      (map.getSource("fields") as maplibregl.GeoJSONSource).setData(fieldsGeoJson);
      map.setPaintProperty("fields-fill", "fill-color", textureMatch(textureColors));
    }

    // cores
    if (!map.getSource("cores")) {
      map.addSource("cores", { type: "geojson", data: coresData });
      map.addLayer({
        id: "cores-circle",
        type: "circle",
        source: "cores",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 7, 4],
          "circle-color": textureMatch(textureColors),
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#A67C17", ["get", "band_stroke"]],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 1.2],
        },
      });
    } else {
      (map.getSource("cores") as maplibregl.GeoJSONSource).setData(coresData);
      map.setPaintProperty("cores-circle", "circle-color", textureMatch(textureColors));
    }

    // centroids
    if (!map.getSource("centroids")) {
      map.addSource("centroids", { type: "geojson", data: centroidsData });
      map.addLayer({
        id: "centroids-circle",
        type: "circle",
        source: "centroids",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 11, 8],
          "circle-color": textureMatch(textureColors),
          "circle-opacity": 0.35,
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#A67C17", ["get", "band_stroke"]],
          "circle-stroke-width": 2.5,
        },
      });
    } else {
      (map.getSource("centroids") as maplibregl.GeoJSONSource).setData(centroidsData);
      map.setPaintProperty("centroids-circle", "circle-color", textureMatch(textureColors));
    }

    // fit once
    if (!didFit.current && fieldsGeoJson.features.length > 0) {
      const b = new maplibregl.LngLatBounds();
      for (const f of fieldsGeoJson.features) {
        const g = f.geometry;
        if (g.type === "Polygon") g.coordinates[0].forEach((c) => b.extend(c as [number, number]));
        else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly[0].forEach((c) => b.extend(c as [number, number])));
      }
      if (!b.isEmpty()) {
        map.fitBounds(b, { padding: 40, animate: false });
        didFit.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fieldsGeoJson, coresData, centroidsData, textureColors]);

  // interaction: select + drag
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    let drag: { kind: "core" | "centroid"; id: string; startCoreOffsets?: Map<string, [number, number]>; centroidStart?: [number, number] } | null = null;

    const onDown = (kind: "core" | "centroid") => (e: maplibregl.MapLayerMouseEvent) => {
      const st = stateRef.current;
      const f = e.features?.[0];
      if (!f) return;
      const id = kind === "core" ? (f.properties?.core_uuid as string) : (f.properties?.id as string);
      st.onSelect({ kind, id });
      if (!st.editMode) return;
      e.preventDefault();
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      if (kind === "centroid") {
        const c = st.centroids.find((x) => x.id === id);
        const offsets = new Map<string, [number, number]>();
        if (c) {
          for (const core of st.cores.filter((x) => x.centroid_id === id)) {
            offsets.set(core.core_uuid, [core.lon - c.lon, core.lat - c.lat]);
          }
        }
        drag = { kind, id, startCoreOffsets: offsets, centroidStart: c ? [c.lon, c.lat] : undefined };
      } else {
        drag = { kind, id };
      }
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (!drag) return;
      const { lng, lat } = e.lngLat;
      const map2 = mapRef.current!;
      if (drag.kind === "core") {
        const src = map2.getSource("cores") as maplibregl.GeoJSONSource;
        const data = coresFC(stateRef.current.cores, { kind: "core", id: drag.id });
        for (const feat of data.features) {
          if ((feat.properties as any).core_uuid === drag.id) (feat.geometry as GeoJSON.Point).coordinates = [lng, lat];
        }
        src.setData(data);
      } else {
        // move centroid + its cores
        const csrc = map2.getSource("centroids") as maplibregl.GeoJSONSource;
        const cdata = centroidsFC(stateRef.current.centroids, { kind: "centroid", id: drag.id });
        for (const feat of cdata.features) {
          if ((feat.properties as any).id === drag.id) (feat.geometry as GeoJSON.Point).coordinates = [lng, lat];
        }
        csrc.setData(cdata);
        const osrc = map2.getSource("cores") as maplibregl.GeoJSONSource;
        const odata = coresFC(stateRef.current.cores, { kind: "centroid", id: "" });
        for (const feat of odata.features) {
          const off = drag.startCoreOffsets?.get((feat.properties as any).core_uuid);
          if (off) (feat.geometry as GeoJSON.Point).coordinates = [lng + off[0], lat + off[1]];
        }
        osrc.setData(odata);
      }
    };

    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (!drag) return;
      const st = stateRef.current;
      const { lng, lat } = e.lngLat;
      if (drag.kind === "core") st.onMoveCore(drag.id, +lng.toFixed(6), +lat.toFixed(6));
      else st.onMoveCentroid(drag.id, +lng.toFixed(6), +lat.toFixed(6));
      drag = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    };

    const coreDown = onDown("core");
    const centDown = onDown("centroid");
    const enter = () => (map.getCanvas().style.cursor = stateRef.current.editMode ? "grab" : "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");

    map.on("mousedown", "cores-circle", coreDown);
    map.on("mousedown", "centroids-circle", centDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    map.on("mouseenter", "cores-circle", enter);
    map.on("mouseleave", "cores-circle", leave);
    map.on("mouseenter", "centroids-circle", enter);
    map.on("mouseleave", "centroids-circle", leave);

    return () => {
      map.off("mousedown", "cores-circle", coreDown);
      map.off("mousedown", "centroids-circle", centDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      map.off("mouseenter", "cores-circle", enter);
      map.off("mouseleave", "cores-circle", leave);
      map.off("mouseenter", "centroids-circle", enter);
      map.off("mouseleave", "centroids-circle", leave);
    };
  }, [ready]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-sand-300" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-full bg-white/90 p-1 text-xs shadow">
        <button
          type="button"
          className={`rounded-full px-3 py-1 font-semibold ${basemap === "satellite" ? "bg-gold-700 text-white" : "text-sand-700"}`}
          onClick={() => setBasemap("satellite")}
        >
          Satellite
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-1 font-semibold ${basemap === "streets" ? "bg-gold-700 text-white" : "text-sand-700"}`}
          onClick={() => setBasemap("streets")}
        >
          Streets
        </button>
      </div>
      {editMode && (
        <div className="absolute bottom-3 left-3 z-10 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-sand-700 shadow">
          Edit mode · drag a core or centroid to relocate; click to select then delete
        </div>
      )}
    </div>
  );
}
