/**
 * POC-only curated-tour data for the MapLibre 3D fly-through (ST-MAP-POC / BRI-167).
 *
 * Scope note: the shared `Experience` type carries no per-stop coordinates — only
 * `Destination` has a single city-level lat/lng. Rather than widen the shared schema
 * (deferred to the real map / PostGIS work, ST-19+), this POC hand-authors the handful
 * of stops + landmark placements for ONE destination (Bangkok, the Rattanakosin river
 * trio). Coordinates are well-known public landmark locations.
 *
 * Everything here is our own data: no backend, no Viator, no geocoding at runtime.
 */

export interface TourStop {
  /** 1-based order along the route. */
  order: number;
  name: string;
  /** WGS84 longitude. */
  lng: number;
  /** WGS84 latitude. */
  lat: number;
}

export interface TourLandmark {
  name: string;
  /** GLTF/GLB asset served from /public. Empty → the layer draws a procedural prang. */
  modelUrl: string;
  lng: number;
  lat: number;
  /** Metres of uniform model scale (the generated prang is ~1 unit tall). */
  scale: number;
  /** Clockwise rotation about the vertical axis, degrees. */
  rotationDeg?: number;
  /** Lift the model off the terrain surface, metres (0 = sits on ground). */
  altitudeOffset?: number;
}

export interface CameraKeyframe {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  /** Optional label surfaced in the UI while flying to this keyframe. */
  label?: string;
}

export interface CuratedTour {
  destinationSlug: string;
  title: string;
  stops: TourStop[];
  landmarks: TourLandmark[];
  camera: {
    /** Where the map opens before "Play the tour" is pressed. */
    start: CameraKeyframe;
    keyframes: CameraKeyframe[];
  };
}

/**
 * Bangkok — a short cinematic loop through the historic royal island along the
 * Chao Phraya: Grand Palace → Wat Pho → Wat Arun (across the river) → Golden Mount.
 */
export const bangkokTour: CuratedTour = {
  destinationSlug: "bangkok",
  title: "Rattanakosin river temples",
  stops: [
    { order: 1, name: "Grand Palace & Wat Phra Kaew", lng: 100.4915, lat: 13.75 },
    { order: 2, name: "Wat Pho (Reclining Buddha)", lng: 100.4931, lat: 13.7466 },
    { order: 3, name: "Wat Arun (Temple of Dawn)", lng: 100.4889, lat: 13.7437 },
    { order: 4, name: "Wat Saket (Golden Mount)", lng: 100.5065, lat: 13.7537 },
  ],
  landmarks: [
    {
      name: "Wat Arun central prang",
      modelUrl: "/models/landmark-prang.glb",
      lng: 100.4889,
      lat: 13.7437,
      scale: 90,
      rotationDeg: 0,
      altitudeOffset: 0,
    },
  ],
  camera: {
    start: {
      center: [100.4915, 13.75],
      zoom: 14.2,
      pitch: 45,
      bearing: -18,
      label: "Rattanakosin, Bangkok",
    },
    keyframes: [
      { center: [100.4915, 13.75], zoom: 16.2, pitch: 62, bearing: -20, label: "Grand Palace & Wat Phra Kaew" },
      { center: [100.4931, 13.7466], zoom: 16.4, pitch: 60, bearing: 25, label: "Wat Pho" },
      { center: [100.4889, 13.7437], zoom: 16.6, pitch: 66, bearing: 120, label: "Wat Arun" },
      { center: [100.5065, 13.7537], zoom: 16.0, pitch: 58, bearing: -40, label: "Wat Saket (Golden Mount)" },
    ],
  },
};
