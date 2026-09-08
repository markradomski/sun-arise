import {
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  Entity,
  Ion,
  JulianDate,
  Math as CesiumMath,
  ScreenSpaceEventType,
  ShadowMode,
  Viewer,
  type TerrainProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createTerrain } from "./terrain";

export interface ShadowSegment {
  start: { latitude: number; longitude: number; height: number };
  end: { latitude: number; longitude: number; height: number };
}

export interface PickedLocation {
  latitude: number;
  longitude: number;
  height: number;
}

/**
 * Owns the Cesium viewer, terrain and globe-level rendering concerns.
 *
 * Scene *contents* live in ObjectLayer, driven by the store. This class knows
 * nothing about houses.
 */
export class CesiumScene {
  readonly viewer: Viewer;
  private liveShadow?: Entity;
  private shadowTrail: Entity[] = [];
  private destroyed = false;
  private terrainProvider?: TerrainProvider;
  private onLocationPicked?: (location: PickedLocation) => void;

  constructor(container: HTMLElement) {
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
    if (token) Ion.defaultAccessToken = token;

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

    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(151.2093, -33.8688, 2_000_000),
    });

    this.viewer.screenSpaceEventHandler.setInputAction((movement: any) => {
      const location = this.pickLocation(movement.position);
      if (location) this.onLocationPicked?.(location);
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * Terrain loads asynchronously, so it is applied after construction. The
   * viewer renders on the ellipsoid until this resolves.
   */
  async initTerrain(): Promise<boolean> {
    const { provider, hasWorldTerrain } = await createTerrain();
    if (this.destroyed) return false;

    this.terrainProvider = provider;
    this.viewer.terrainProvider = provider;
    return hasWorldTerrain;
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

  onLocationPick(callback: (location: PickedLocation) => void) {
    this.onLocationPicked = callback;
  }

  /** Screen point → geographic location, terrain-aware where supported. */
  pickLocation(windowPosition: any): PickedLocation | undefined {
    const { scene } = this.viewer;
    const cartesian = scene.pickPositionSupported
      ? scene.pickPosition(windowPosition)
      : undefined;
    const fallback =
      cartesian ?? scene.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
    if (!fallback) return undefined;

    const carto = Cartographic.fromCartesian(fallback);
    return {
      latitude: CesiumMath.toDegrees(carto.latitude),
      longitude: CesiumMath.toDegrees(carto.longitude),
      height: Math.max(0, carto.height),
    };
  }

  setDate(date: Date) {
    this.viewer.clock.currentTime = JulianDate.fromDate(date);
  }

  setLiveShadow(segment?: ShadowSegment) {
    if (!segment) {
      if (this.liveShadow) this.liveShadow.show = false;
      return;
    }

    const positions = this.shadowPositions(segment);
    if (!this.liveShadow) {
      this.liveShadow = this.viewer.entities.add({
        polyline: {
          positions,
          width: 4,
          material: Color.fromCssColorString("#ffd36a"),
        },
      });
      return;
    }

    this.liveShadow.show = true;
    const polyline = this.liveShadow.polyline;
    if (polyline) polyline.positions = new ConstantProperty(positions);
  }

  setShadowTrail(segments: ShadowSegment[]) {
    for (const entity of this.shadowTrail) this.viewer.entities.remove(entity);
    this.shadowTrail = segments.map((segment) =>
      this.viewer.entities.add({
        polyline: {
          positions: this.shadowPositions(segment),
          width: 2,
          material: Color.fromAlpha(Color.fromCssColorString("#f6c55e"), 0.35),
        },
      }),
    );
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

  private shadowPositions(segment: ShadowSegment) {
    return Cartesian3.fromDegreesArrayHeights([
      segment.start.longitude,
      segment.start.latitude,
      segment.start.height,
      segment.end.longitude,
      segment.end.latitude,
      segment.end.height,
    ]);
  }

  destroy() {
    this.destroyed = true;
    for (const entity of this.shadowTrail) this.viewer.entities.remove(entity);
    this.shadowTrail = [];
    this.viewer.destroy();
  }
}
