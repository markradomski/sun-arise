import {
  Cartesian3,
  Color,
  JulianDate,
  Math as CesiumMath,
  ShadowMode,
  Viewer,
  type TerrainProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createTerrain, type TerrainSetup } from "./terrain";
import { DEFAULT_SITE } from "../scene/site";

/**
 * Owns the Cesium viewer, terrain and globe-level rendering concerns.
 *
 * Scene *contents* live in ObjectLayer, driven by the store. This class knows
 * nothing about houses.
 */
export class CesiumScene {
  readonly viewer: Viewer;
  private destroyed = false;
  private terrainProvider?: TerrainProvider;

  constructor(container: HTMLElement) {
    this.viewer = new Viewer(container, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      shadows: true,
      terrainShadows: ShadowMode.RECEIVE_ONLY,
      scene3DOnly: true,
    });

    const { scene } = this.viewer;
    scene.globe.enableLighting = true;
    scene.globe.dynamicAtmosphereLighting = true;
    scene.globe.dynamicAtmosphereLightingFromSun = true;
    scene.globe.shadows = ShadowMode.RECEIVE_ONLY;
    scene.backgroundColor = Color.fromCssColorString("#05070a");

    // Required for pickPosition to return points ON the terrain rather than
    // through it. Without this, dragging places objects underground.
    scene.globe.depthTestAgainstTerrain = true;

    // Cesium's shadow map defaults to a 5 km range. Across a 15 m house that
    // leaves so little depth precision that the building self-shadows and
    // renders almost black — which looks exactly like a broken model. Tightening
    // the range to site scale is what makes the cast shadow usable.
    this.viewer.shadowMap.maximumDistance = 600;
    this.viewer.shadowMap.size = 2048;
    this.viewer.shadowMap.softShadows = true;
    this.viewer.shadowMap.darkness = 0.38;
    this.viewer.shadowMap.normalOffset = true;

    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        DEFAULT_SITE.longitude,
        DEFAULT_SITE.latitude,
        2_000_000,
      ),
    });

    // No input handling here by design — DragController owns all pointer
    // interaction so that picking an object and picking the ground stay in
    // one place.
  }

  /**
   * Terrain loads asynchronously, so it is applied after construction. The
   * viewer renders on the ellipsoid until this resolves.
   */
  async initTerrain(): Promise<TerrainSetup> {
    const setup = await createTerrain();
    if (this.destroyed) return setup;

    this.terrainProvider = setup.provider;
    this.viewer.terrainProvider = setup.provider;
    return setup;
  }

  getTerrainProvider(): TerrainProvider | undefined {
    return this.terrainProvider;
  }

  get scene() {
    return this.viewer.scene;
  }

  get globe() {
    return this.viewer.scene.globe;
  }

  setDate(date: Date) {
    this.viewer.clock.currentTime = JulianDate.fromDate(date);
  }

  tiltTo3D() {
    this.viewer.camera.setView({
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-60), roll: 0 },
    });
  }

  tiltTo2D() {
    this.viewer.camera.setView({
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
    });
  }

  destroy() {
    this.destroyed = true;
    this.viewer.destroy();
  }
}
