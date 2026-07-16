import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ClusterBbox, Bounds } from "../types";

// Public glyphs source — needed for any symbol/text layer (the cluster-box
// field-count labels); raster-only basemaps don't ship their own.
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
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const DEFAULT_CENTER: [number, number] = [-97.9, 47.8];
const DEFAULT_ZOOM = 7;

const PERIOD_COLORS: Record<string, string> = {
  S24: "#C7B08A",
  F24: "#8A6612",
  S25: "#A67C17",
  F25: "#5B7B4C",
};

const STATUS_COLORS: Record<string, string> = {
  pre_submission: "#ECE1CD",
  submitted: "#D4A72C",
  validated: "#5B7B4C",
  credited: "#3E5C36",
};

const PERIODS_COVERED_COLORS: Record<string, string> = {
  "S25+F25": "#5B7B4C",
  S25_only: "#C7B08A",
};

function boundsToLngLat(b: Bounds): maplibregl.LngLatBoundsLike {
  return [
    [b.min_lon, b.min_lat],
    [b.max_lon, b.max_lat],
  ];
}

export interface MapInlayProps {
  fieldsGeoJson?: GeoJSON.FeatureCollection;
  fieldsFillOpacity?: number;
  clusterBboxes?: ClusterBbox[];
  opBounds?: Bounds | null;

  samplesGeoJson?: GeoJSON.FeatureCollection;
  samplesPeriodFilter?: string | null; // null = all
  onSampleClick?: (props: Record<string, unknown>) => void;

  statusGeoJson?: GeoJSON.FeatureCollection;
  statusColorBy?: "status_class" | "periods_covered";
  onStatusFieldClick?: (props: Record<string, unknown>) => void;

  height?: string;
}

export function MapInlay({
  fieldsGeoJson,
  fieldsFillOpacity = 0.25,
  clusterBboxes,
  opBounds,
  samplesGeoJson,
  samplesPeriodFilter,
  onSampleClick,
  statusGeoJson,
  statusColorBy = "status_class",
  onStatusFieldClick,
  height = "420px",
}: MapInlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<"satellite" | "streets">("satellite");

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      cooperativeGestures: true,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    map.on("load", () => setReady(true));
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemap === "satellite" ? SATELLITE_STYLE : STREETS_STYLE);
    map.once("styledata", () => {
      // layers are re-added by the effects below on next tick via ready toggle
      setReady(false);
      requestAnimationFrame(() => setReady(true));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // Fields layer + cluster boxes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fieldsGeoJson) return;

    if (map.getSource("fields")) {
      (map.getSource("fields") as maplibregl.GeoJSONSource).setData(fieldsGeoJson);
    } else {
      map.addSource("fields", { type: "geojson", data: fieldsGeoJson });
      map.addLayer({
        id: "fields-fill",
        type: "fill",
        source: "fields",
        paint: { "fill-color": "#A67C17", "fill-opacity": fieldsFillOpacity },
      });
      map.addLayer({
        id: "fields-line",
        type: "line",
        source: "fields",
        paint: { "line-color": "#A67C17", "line-width": 2 },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", "fields-fill", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const { field_name, acres } = f.properties as { field_name: string; acres: number };
        popup
          .setLngLat(e.lngLat)
          .setHTML(`<div class="p-2 text-xs"><div class="font-semibold">${field_name ?? "Field"}</div><div>${acres?.toFixed(1)} ac</div></div>`)
          .addTo(map);
      });
      map.on("mouseleave", "fields-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }

    if (opBounds && (opBounds.max_lon - opBounds.min_lon > 0 || opBounds.max_lat - opBounds.min_lat > 0)) {
      map.fitBounds(boundsToLngLat(opBounds), { padding: 40, animate: false });
    }

    // cluster meta-boxes
    const existingLayers = ["cluster-boxes-line", "cluster-boxes-label"];
    for (const id of existingLayers) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource("cluster-boxes")) map.removeSource("cluster-boxes");

    if (clusterBboxes && clusterBboxes.length > 1) {
      const features: GeoJSON.Feature[] = clusterBboxes.map((b) => ({
        type: "Feature",
        properties: { cluster_id: b.cluster_id, field_count: b.field_count, label: `${b.field_count} fields` },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [b.min_lon, b.min_lat],
              [b.max_lon, b.min_lat],
              [b.max_lon, b.max_lat],
              [b.min_lon, b.max_lat],
              [b.min_lon, b.min_lat],
            ],
          ],
        },
      }));
      map.addSource("cluster-boxes", { type: "geojson", data: { type: "FeatureCollection", features } });
      map.addLayer({
        id: "cluster-boxes-line",
        type: "line",
        source: "cluster-boxes",
        paint: { "line-color": "#A67C17", "line-width": 1, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "cluster-boxes-label",
        type: "symbol",
        source: "cluster-boxes",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-anchor": "top-left",
          "text-offset": [0.3, 0.3],
        },
        paint: { "text-color": "#46331F", "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });
      map.on("click", "cluster-boxes-line", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const clusterId = f.properties?.cluster_id;
        const box = clusterBboxes.find((b) => b.cluster_id === clusterId);
        if (box) map.fitBounds(boundsToLngLat(box), { padding: 40 });
      });
      map.on("mouseenter", "cluster-boxes-line", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "cluster-boxes-line", () => (map.getCanvas().style.cursor = ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fieldsGeoJson, clusterBboxes, opBounds, fieldsFillOpacity]);

  // Sample points layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !samplesGeoJson) return;

    if (map.getSource("samples")) {
      (map.getSource("samples") as maplibregl.GeoJSONSource).setData(samplesGeoJson);
    } else {
      map.addSource("samples", { type: "geojson", data: samplesGeoJson });
      map.addLayer({
        id: "samples-circle",
        type: "circle",
        source: "samples",
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "match",
            ["get", "period"],
            "S24", PERIOD_COLORS.S24,
            "F24", PERIOD_COLORS.F24,
            "S25", PERIOD_COLORS.S25,
            "F25", PERIOD_COLORS.F25,
            "#999999",
          ],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });
      map.on("click", "samples-circle", (e) => {
        const f = e.features?.[0];
        if (f && onSampleClick) onSampleClick(f.properties as Record<string, unknown>);
      });
      map.on("mouseenter", "samples-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "samples-circle", () => (map.getCanvas().style.cursor = ""));

      if (samplesGeoJson.features.length > 0) {
        const lons = samplesGeoJson.features.map((f) => (f.geometry as GeoJSON.Point).coordinates[0]);
        const lats = samplesGeoJson.features.map((f) => (f.geometry as GeoJSON.Point).coordinates[1]);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 60, animate: false },
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, samplesGeoJson, onSampleClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("samples-circle")) return;
    if (samplesPeriodFilter) {
      map.setFilter("samples-circle", ["==", ["get", "period"], samplesPeriodFilter]);
    } else {
      map.setFilter("samples-circle", null);
    }
  }, [ready, samplesPeriodFilter]);

  // Status choropleth layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !statusGeoJson) return;

    if (map.getSource("status")) {
      (map.getSource("status") as maplibregl.GeoJSONSource).setData(statusGeoJson);
    } else {
      map.addSource("status", { type: "geojson", data: statusGeoJson });
      map.addLayer({
        id: "status-fill",
        type: "fill",
        source: "status",
        paint: { "fill-color": "#ECE1CD", "fill-opacity": 0.55, "fill-outline-color": "#ECE1CD" },
      });
      map.on("click", "status-fill", (e) => {
        const f = e.features?.[0];
        if (f && onStatusFieldClick) onStatusFieldClick(f.properties as Record<string, unknown>);
      });
      map.on("mouseenter", "status-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "status-fill", () => (map.getCanvas().style.cursor = ""));

      if (statusGeoJson.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of statusGeoJson.features) {
          const geom = f.geometry;
          if (geom.type === "Polygon") geom.coordinates[0].forEach((c) => bounds.extend(c as [number, number]));
        }
        map.fitBounds(bounds, { padding: 20, animate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, statusGeoJson, onStatusFieldClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("status-fill")) return;
    const colorMap = statusColorBy === "status_class" ? STATUS_COLORS : PERIODS_COVERED_COLORS;
    const prop = statusColorBy;
    const expr: any[] = ["match", ["get", prop]];
    for (const [k, v] of Object.entries(colorMap)) expr.push(k, v);
    expr.push("#ECE1CD");
    map.setPaintProperty("status-fill", "fill-color", expr as any);
  }, [ready, statusColorBy]);

  function fitAll() {
    const map = mapRef.current;
    if (!map || !opBounds) return;
    map.fitBounds(boundsToLngLat(opBounds), { padding: 40 });
  }

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
      {clusterBboxes && clusterBboxes.length > 1 && (
        <button
          type="button"
          onClick={fitAll}
          className="absolute bottom-3 left-3 z-10 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-sand-700 shadow hover:bg-white"
        >
          Fit all
        </button>
      )}
    </div>
  );
}
