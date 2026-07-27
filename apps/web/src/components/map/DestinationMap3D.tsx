"use client";

/**
 * Client-only MapLibre 3D scene for one curated tour (ST-MAP-POC / BRI-167).
 *
 * Built entirely on MapLibre GL JS + OpenFreeMap + a free raster-dem + Three.js —
 * no Google, no API key, no billing (docs/11 §1/§6). This module is heavy
 * (maplibre-gl + three) and is loaded on interaction by `View3DButton`, so it never
 * ships in the indexable page's initial JS (docs/11 §3).
 *
 * ⚠️ Pinned to maplibre-gl v5. MapLibre GL JS **v6.0.0** fails to load the OpenFreeMap
 * vector source — its `load` event never fires, so nothing renders past the background.
 * Stay on v5 until v6 + OpenFreeMap is verified working.
 */
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  FillExtrusionLayerSpecification,
  LineLayerSpecification,
} from "maplibre-gl";
import { createLandmarkLayer } from "./three-landmark-layer";
import type { CuratedTour } from "@/data/map-poc/bangkok-tour";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
// Mapterhorn DEM — the keyless raster-dem used by MapLibre's own current 3D-terrain
// example and named in docs/11 §1. Its TileJSON self-declares the tile `encoding`, so we
// must NOT hard-code one (a DEM lacking an encoding field makes MapLibre default to "mapbox",
// mis-decode the terrarium tiles, and blank the basemap). Validate host uptime before prod.
const DEM_TERRAIN = "https://tiles.mapterhorn.com/tilejson.json";

export default function DestinationMap3D({
  tour,
  onClose,
}: {
  tour: CuratedTour;
  onClose?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const playingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPENFREEMAP_STYLE,
      center: tour.camera.start.center,
      zoom: tour.camera.start.zoom,
      pitch: tour.camera.start.pitch,
      bearing: tour.camera.start.bearing,
      attributionControl: { compact: true },
      maxPitch: 80,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    map.on("error", (e) => {
      const err = (e as { error?: { message?: string } })?.error;
      const message = err?.message ?? (e as { message?: string }).message;
      console.error("[map3d] map error", message ?? e);
      if (message) setMapError(message);
    });

    // Enable "Play the tour" once the map is usable. It must NOT depend on the custom
    // layers below, so we also arm `idle` + a timeout as belt-and-braces.
    const markReady = () => setReady(true);
    map.once("idle", markReady);
    const readyTimeout = setTimeout(markReady, 5000);

    map.on("load", () => {
      clearTimeout(readyTimeout);
      try {
        // Force the correct initial view + a first paint (guards against a mis-sized container
        // or a stalled render loop showing a blank frame until the user interacts).
        map.resize();
        map.jumpTo({
          center: tour.camera.start.center,
          zoom: tour.camera.start.zoom,
          pitch: tour.camera.start.pitch,
          bearing: tour.camera.start.bearing,
        });

        // --- Extruded building massing over OpenFreeMap's building layer ---
        const buildings: FillExtrusionLayerSpecification = {
          id: "poc-3d-buildings",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 13,
          paint: {
            "fill-extrusion-color": "#d8cfbf",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "render_height"],
              ["get", "height"],
              6,
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              ["get", "min_height"],
              0,
            ],
            "fill-extrusion-opacity": 0.85,
          },
        };
        map.addLayer(buildings);

        // --- Route line through the stops ---
        const ordered = [...tour.stops].sort((a, b) => a.order - b.order);
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: ordered.map((s) => [s.lng, s.lat]),
            },
          },
        });
        const routeLine: LineLayerSpecification = {
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#c2410c",
            "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 6],
            "line-opacity": 0.9,
          },
        };
        map.addLayer(routeLine);

        // --- Numbered stop markers ---
        for (const stop of ordered) {
          const el = document.createElement("div");
          el.textContent = String(stop.order);
          el.setAttribute("aria-label", `Stop ${stop.order}: ${stop.name}`);
          Object.assign(el.style, {
            width: "26px",
            height: "26px",
            borderRadius: "50%",
            background: "#c2410c",
            color: "#fff",
            fontSize: "13px",
            fontWeight: "700",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #fff",
            boxShadow: "0 1px 4px rgba(0,0,0,.4)",
            cursor: "default",
          });
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([stop.lng, stop.lat])
            .setPopup(new maplibregl.Popup({ offset: 18 }).setText(stop.name))
            .addTo(map);
          markersRef.current.push(marker);
        }

        // The basemap scene is up — enable "Play the tour" NOW, before the optional
        // landmark/terrain layers, so a failure in either can never disable the tour.
        setReady(true);
        setActiveLabel(tour.camera.start.label ?? null);

        // --- Hand-placed Three.js GLTF landmark (isolated + non-fatal) ---
        try {
          map.addLayer(createLandmarkLayer("landmarks", tour.landmarks));
        } catch (landmarkErr) {
          console.error("[map3d] landmark layer failed, continuing without it", landmarkErr);
        }

        // --- Terrain + hillshade, gated on the DEM source actually loading so a slow/failed
        //     DEM can never blank the basemap already rendered above. ---
        try {
          if (!map.getSource("dem")) {
            map.addSource("dem", { type: "raster-dem", url: DEM_TERRAIN });
          }
          map.addLayer({
            id: "hillshade",
            type: "hillshade",
            source: "dem",
            paint: { "hillshade-exaggeration": 0.3 },
          });
          const enableTerrain = (e: {
            sourceId?: string;
            isSourceLoaded?: boolean;
          }) => {
            if (e.sourceId !== "dem" || !e.isSourceLoaded) return;
            map.off("sourcedata", enableTerrain);
            try {
              map.setTerrain({ source: "dem", exaggeration: 1.0 });
            } catch (setErr) {
              console.error("[map3d] setTerrain failed, staying flat", setErr);
            }
          };
          map.on("sourcedata", enableTerrain);
        } catch (terrainErr) {
          console.error("[map3d] terrain unavailable, continuing without it", terrainErr);
        }
      } catch (err) {
        console.error("[map3d] failed to build 3D scene", err);
        setMapError("The 3D map failed to initialise. See console for details.");
      }
    });

    return () => {
      clearTimeout(readyTimeout);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [tour]);

  async function playTour() {
    const map = mapRef.current;
    if (!map || playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    try {
      for (const kf of tour.camera.keyframes) {
        setActiveLabel(kf.label ?? null);
        await new Promise<void>((resolve) => {
          map.once("moveend", () => resolve());
          map.flyTo({
            center: kf.center,
            zoom: kf.zoom,
            pitch: kf.pitch,
            bearing: kf.bearing,
            duration: 3200,
            essential: true,
          });
        });
      }
    } finally {
      playingRef.current = false;
      setPlaying(false);
    }
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-black/10 shadow-sm">
      <div ref={containerRef} className="h-[70vh] min-h-[420px] w-full" />

      {/* Controls overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={playTour}
            disabled={!ready || playing}
            className="rounded-full bg-orange-700 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
          >
            {playing ? "Playing…" : "▶ Play the tour"}
          </button>
          {activeLabel && (
            <span className="pointer-events-none rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-gray-800 shadow">
              {activeLabel}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close 3D map"
            className="pointer-events-auto rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-gray-800 shadow"
          >
            ✕
          </button>
        )}
      </div>

      {/* Error toast — turns a silent blank map into an explained failure */}
      {mapError && (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-0 bottom-10 mx-auto w-fit max-w-[90%] rounded-lg bg-red-900/90 px-4 py-2 text-center text-xs font-medium text-white shadow-lg"
        >
          Map error: {mapError}
        </div>
      )}
    </div>
  );
}
