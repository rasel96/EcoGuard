"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  Check,
  Eraser,
  GlobeHemisphereEast,
  Polygon as PolygonIcon,
  Stack,
} from "@phosphor-icons/react";
import type { GeoJsonPolygon } from "@/lib/types";

interface SatelliteMapProps {
  center?: [number, number];
  boundingBox?: number[] | null;
  ndviTileUrl?: string | null;
  landcoverTileUrl?: string | null;
  hansenTileUrl?: string | null;
  activePolygon: GeoJsonPolygon | null;
  onPolygonChange: (polygon: GeoJsonPolygon | null) => void;
}

type OverlayMode = "none" | "ndvi" | "landcover" | "hansen";
type BaseMapMode = "satellite" | "dark";

export default function SatelliteMap({
  center = [23.685, 90.356],
  boundingBox,
  ndviTileUrl,
  landcoverTileUrl,
  hansenTileUrl,
  activePolygon,
  onPolygonChange,
}: SatelliteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayerRef = useRef<L.TileLayer | null>(null);
  const aoiLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);

  const [baseMap, setBaseMap] = useState<BaseMapMode>("satellite");
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("ndvi");
  const [opacity, setOpacity] = useState<number>(0.75);
  const [drawing, setDrawing] = useState<boolean>(false);
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);

  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom: 7,
      zoomControl: true,
    });

    aoiLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current) return;
      setDraftPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch Base Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }

    const url =
      baseMap === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

    const attribution =
      baseMap === "satellite"
        ? "Imagery &copy; Esri"
        : "&copy; OpenStreetMap &copy; CARTO";

    baseLayerRef.current = L.tileLayer(url, { attribution, maxZoom: 18 }).addTo(
      map
    );
  }, [baseMap]);

  // Switch Earth Engine Overlay Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (overlayLayerRef.current) {
      map.removeLayer(overlayLayerRef.current);
      overlayLayerRef.current = null;
    }

    const tileMap: Record<OverlayMode, string | null | undefined> = {
      none: null,
      ndvi: ndviTileUrl,
      landcover: landcoverTileUrl,
      hansen: hansenTileUrl,
    };

    const selectedUrl = tileMap[overlayMode];
    if (selectedUrl) {
      overlayLayerRef.current = L.tileLayer(selectedUrl, {
        opacity,
        maxZoom: 18,
      }).addTo(map);
    }
  }, [overlayMode, ndviTileUrl, landcoverTileUrl, hansenTileUrl, opacity]);

  // Render AOI bounding box or committed polygon
  useEffect(() => {
    const map = mapRef.current;
    const layer = aoiLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    if (activePolygon && activePolygon.coordinates[0]?.length >= 4) {
      const latLngs = activePolygon.coordinates[0].map(
        ([lon, lat]) => [lat, lon] as [number, number]
      );
      const poly = L.polygon(latLngs, {
        color: "#10b981",
        weight: 2,
        fillColor: "#10b981",
        fillOpacity: 0.14,
      }).addTo(layer);
      map.fitBounds(poly.getBounds(), { padding: [36, 36] });
    } else if (boundingBox && boundingBox.length === 4) {
      const [south, north, west, east] = boundingBox;
      const bounds: L.LatLngBoundsExpression = [
        [south, west],
        [north, east],
      ];
      L.rectangle(bounds, {
        color: "#10b981",
        weight: 2,
        dashArray: "6 4",
        fillColor: "#10b981",
        fillOpacity: 0.08,
      }).addTo(layer);
      map.fitBounds(bounds, { padding: [36, 36] });
    }
  }, [activePolygon, boundingBox]);

  // Render draft polygon points while user is clicking
  useEffect(() => {
    const layer = drawLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (draftPoints.length === 0) return;

    draftPoints.forEach((pt, idx) => {
      L.circleMarker(pt, {
        radius: 5,
        color: "#10b981",
        fillColor: idx === 0 ? "#f59e0b" : "#34d399",
        fillOpacity: 1,
        weight: 2,
      }).addTo(layer);
    });

    if (draftPoints.length >= 2) {
      L.polyline(draftPoints, {
        color: "#34d399",
        weight: 2,
        dashArray: "4 4",
      }).addTo(layer);
    }

    if (draftPoints.length >= 3) {
      L.polygon(draftPoints, {
        color: "#34d399",
        weight: 1.5,
        fillColor: "#10b981",
        fillOpacity: 0.18,
      }).addTo(layer);
    }
  }, [draftPoints]);

  const finishPolygon = () => {
    if (draftPoints.length < 3) return;
    const ring = draftPoints.map(([lat, lon]) => [
      Number(lon.toFixed(6)),
      Number(lat.toFixed(6)),
    ]);
    ring.push(ring[0]);
    onPolygonChange({
      type: "Polygon",
      coordinates: [ring],
    });
    setDrawing(false);
    setDraftPoints([]);
  };

  const clearPolygon = () => {
    setDrawing(false);
    setDraftPoints([]);
    onPolygonChange(null);
  };

  const hasAnyTile = Boolean(ndviTileUrl || landcoverTileUrl || hansenTileUrl);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/[0.1] bg-[#0d1411]">
      {/* Map Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-white/[0.08] bg-[#111714]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setDrawing((v) => !v);
              setDraftPoints([]);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors active:scale-[0.98] ${
              drawing
                ? "bg-emerald-500 text-zinc-950"
                : "bg-white/[0.05] text-zinc-200 hover:bg-white/[0.1]"
            }`}
          >
            <PolygonIcon size={15} />
            <span>{drawing ? "Click map vertices..." : "Draw Custom Polygon"}</span>
          </button>

          {drawing && draftPoints.length >= 3 && (
            <button
              type="button"
              onClick={finishPolygon}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
            >
              <Check size={14} />
              <span>Apply ({draftPoints.length} pts)</span>
            </button>
          )}

          {(activePolygon || draftPoints.length > 0) && (
            <button
              type="button"
              onClick={clearPolygon}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-100 bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <Eraser size={14} />
              <span>Clear AOI</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0a0e0c] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setBaseMap("satellite")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 ${
                baseMap === "satellite"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <GlobeHemisphereEast size={13} />
              <span>Imagery</span>
            </button>
            <button
              type="button"
              onClick={() => setBaseMap("dark")}
              className={`px-2 py-1 rounded-md ${
                baseMap === "dark"
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Dark Base
            </button>
          </div>
        </div>
      </div>

      {/* Leaflet Canvas */}
      <div
        ref={containerRef}
        className={`w-full h-[430px] sm:h-[490px] ${drawing ? "cursor-crosshair" : ""}`}
      />

      {/* Satellite Overlay Switcher Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 border-t border-white/[0.08] bg-[#111714] text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-zinc-400 mr-1 font-mono text-[11px]">
            <Stack size={14} />
            GEE LAYER:
          </span>
          {(
            [
              { id: "ndvi", label: "Sentinel-2 NDVI", available: Boolean(ndviTileUrl) },
              { id: "landcover", label: "ESA WorldCover", available: Boolean(landcoverTileUrl) },
              { id: "hansen", label: "Hansen Loss", available: Boolean(hansenTileUrl) },
              { id: "none", label: "Off", available: true },
            ] as const
          ).map((layer) => (
            <button
              key={layer.id}
              type="button"
              disabled={!layer.available}
              onClick={() => setOverlayMode(layer.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                overlayMode === layer.id && layer.available
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35"
                  : layer.available
                  ? "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                  : "bg-white/[0.02] text-zinc-600 cursor-not-allowed"
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>

        {hasAnyTile && overlayMode !== "none" && (
          <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
            <span>OPACITY</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-20 accent-emerald-500"
            />
            <span className="tabular-nums w-8 text-right">
              {Math.round(opacity * 100)}%
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
