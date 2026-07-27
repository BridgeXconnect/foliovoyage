/**
 * MapLibre `CustomLayerInterface` that renders hand-placed 3D landmark models with
 * Three.js, georeferenced onto the map's terrain (ST-MAP-POC / BRI-167, docs/11 §1/§4).
 *
 * Pattern follows MapLibre's official "Add a 3D model with terrain" example: each model
 * is positioned in Web-Mercator world units via `MercatorCoordinate.fromLngLat`, dropped
 * onto terrain elevation via `map.queryTerrainElevation`, and drawn each frame using the
 * `modelViewProjectionMatrix` MapLibre supplies (mercator-world → clip space).
 */
import * as THREE from "three";
// three ships this addon under both paths; "/addons/" is the current canonical one.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { TourLandmark } from "@/data/map-poc/bangkok-tour";

interface PlacedModel {
  group: THREE.Group;
  landmark: TourLandmark;
}

export function createLandmarkLayer(
  id: string,
  landmarks: TourLandmark[],
): CustomLayerInterface {
  let map: MapLibreMap;
  let renderer: THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const placed: PlacedModel[] = [];
  let elevationsApplied = false;

  /** Build the mercator placement matrix for one landmark at a given ground altitude (m). */
  function placementMatrix(lm: TourLandmark, altitudeMeters: number): THREE.Matrix4 {
    const merc = MercatorCoordinate.fromLngLat([lm.lng, lm.lat], altitudeMeters);
    const unit = merc.meterInMercatorCoordinateUnits();
    const scale = unit * lm.scale;
    const rotY = ((lm.rotationDeg ?? 0) * Math.PI) / 180;
    // Model is Y-up in metres; mercator is Z-up with Y pointing south → rotate +90° about
    // X and flip Y in the scale, exactly as MapLibre's three.js example does.
    return new THREE.Matrix4()
      .makeTranslation(merc.x, merc.y, merc.z)
      .multiply(new THREE.Matrix4().makeScale(scale, -scale, scale))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationY(rotY));
  }

  function applyPlacement(pm: PlacedModel, altitudeMeters: number) {
    pm.group.matrixAutoUpdate = false;
    pm.group.matrix.copy(placementMatrix(pm.landmark, altitudeMeters));
  }

  return {
    id,
    type: "custom",
    renderingMode: "3d",

    onAdd(m: MapLibreMap, gl: WebGL2RenderingContext | WebGLRenderingContext) {
      map = m;

      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
      sun.position.set(-70, -40, 120).normalize();
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xbcd4ff, 1.0);
      fill.position.set(80, 60, 40).normalize();
      scene.add(fill);

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;

      const loader = new GLTFLoader();
      for (const lm of landmarks) {
        const group = new THREE.Group();
        const pm: PlacedModel = { group, landmark: lm };
        applyPlacement(pm, lm.altitudeOffset ?? 0);
        scene.add(group);
        placed.push(pm);

        loader.load(
          lm.modelUrl,
          (gltf) => {
            gltf.scene.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (mesh.isMesh && mesh.geometry && !mesh.geometry.getAttribute("normal")) {
                mesh.geometry.computeVertexNormals();
              }
            });
            group.add(gltf.scene);
            map.triggerRepaint();
          },
          undefined,
          (err) => console.error(`[landmark-layer] failed to load ${lm.modelUrl}`, err),
        );
      }
    },

    render(_gl: WebGL2RenderingContext | WebGLRenderingContext, options: CustomRenderMethodInput) {
      // Once terrain is queryable, drop each model onto the real ground elevation.
      if (!elevationsApplied && map.getTerrain()) {
        let allResolved = true;
        for (const pm of placed) {
          const elev = map.queryTerrainElevation([pm.landmark.lng, pm.landmark.lat]);
          if (elev == null) {
            allResolved = false;
            continue;
          }
          applyPlacement(pm, elev + (pm.landmark.altitudeOffset ?? 0));
        }
        elevationsApplied = allResolved;
      }

      camera.projectionMatrix = new THREE.Matrix4().fromArray(
        Array.from(options.modelViewProjectionMatrix),
      );
      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },

    onRemove() {
      renderer?.dispose();
    },
  };
}
