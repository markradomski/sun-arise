import {
  Cartesian3,
  Color,
  ConstantProperty,
  EllipsoidTerrainProvider,
  Entity,
  Ion,
  JulianDate,
  ScreenSpaceEventType,
  Cartographic,
  Math as CesiumMath,
  Model,
  ShadowMode,
  Transforms,
  Viewer,
  HeadingPitchRoll,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

export interface ShadowSegment {
  start: { latitude: number; longitude: number; height: number };
  end: { latitude: number; longitude: number; height: number };
}

export class CesiumScene {
  readonly viewer: Viewer;
  private house?: Model;
  private liveShadow?: Entity;
  private shadowTrail: Entity[] = [];
  private placementVersion = 0;
  private destroyed = false;
  private location = Cartesian3.fromDegrees(151.2093, -33.8688, 0);
  private headingDeg = 0;
  private scale = 1;
  private onLocationPicked?: (location: { latitude: number; longitude: number; height: number }) => void;

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
      terrainProvider: new EllipsoidTerrainProvider(),
      shadows: true,
      terrainShadows: ShadowMode.RECEIVE_ONLY,
      scene3DOnly: true,
    });

    this.viewer.scene.globe.enableLighting = true;
    this.viewer.scene.globe.dynamicAtmosphereLighting = true;
    this.viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    this.viewer.scene.globe.shadows = ShadowMode.RECEIVE_ONLY;
    this.viewer.scene.backgroundColor = Color.fromCssColorString("#05070a");

    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(151.2093, -33.8688, 2_000_000),
    });

    // Click/touch the globe to choose a new house location.
    this.viewer.screenSpaceEventHandler.setInputAction((movement: any) => {
      const scene = this.viewer.scene;
      const cartesian =
        scene.pickPositionSupported && scene.pickPosition(movement.position)
          ? scene.pickPosition(movement.position)
          : scene.camera.pickEllipsoid(movement.position, scene.globe.ellipsoid);

      if (!cartesian) return;

      const cartographic = Cartographic.fromCartesian(cartesian);
      const location = {
        latitude: CesiumMath.toDegrees(cartographic.latitude),
        longitude: CesiumMath.toDegrees(cartographic.longitude),
        height: Math.max(0, cartographic.height),
      };

      this.location = Cartesian3.fromDegrees(
        location.longitude,
        location.latitude,
        location.height
      );
      this.onLocationPicked?.(location);
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  onLocationPick(callback: (location: { latitude: number; longitude: number; height: number }) => void) {
    this.onLocationPicked = callback;
  }

  async placeHouse(url: string, longitude: number, latitude: number, height = 0) {
    const placementVersion = ++this.placementVersion;
    const scene = this.viewer.scene;
    this.location = Cartesian3.fromDegrees(longitude, latitude, height);
    if (this.house) {
      scene.primitives.remove(this.house);
      this.house = undefined;
    }

    const isBungalow = url.includes("bungalow");
    const modelMatrix = isBungalow ? this.makeBungalowModelMatrix() : this.makeModelMatrix();
    const modelScale = isBungalow ? 0.05 : this.scale;

    const model = await Model.fromGltfAsync({
      url,
      modelMatrix,
      shadows: ShadowMode.ENABLED,
      scale: modelScale,
      scene,
    });

    // React Strict Mode and quick location changes can supersede a pending load.
    if (this.destroyed || placementVersion !== this.placementVersion) {
      model.destroy();
      return;
    }

    this.house = model;
    scene.primitives.add(model);
  }

  setHouseTransform(headingDeg: number, scale = this.scale) {
    this.headingDeg = headingDeg;
    this.scale = scale;
    if (this.house) this.house.modelMatrix = this.makeModelMatrix();
  }

  setHouseLocation(longitude: number, latitude: number, height = 0) {
    this.location = Cartesian3.fromDegrees(longitude, latitude, height);
    if (this.house) this.house.modelMatrix = this.makeModelMatrix();
  }

  getHouseLocation() {
    return this.location;
  }

  private makeModelMatrix() {
    const hpr = new HeadingPitchRoll(
      CesiumMath.toRadians(this.headingDeg),
      0,
      0
    );
    return Transforms.headingPitchRollToFixedFrame(this.location, hpr);
  }

  private makeBungalowModelMatrix() {
    const hpr = new HeadingPitchRoll(
      CesiumMath.toRadians(this.headingDeg),
      0,
      0
    );
    return Transforms.headingPitchRollToFixedFrame(this.location, hpr);
  }

  setDate(date: Date) {
    this.viewer.clock.currentTime = this.toJulianDate(date);
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
      })
    );
  }

  tiltTo3D() {
    this.viewer.camera.setView({
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-60),
        roll: 0,
      },
    });
  }

  tiltTo2D() {
    this.viewer.camera.setView({
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
    });
  }

  private toJulianDate(date: Date) {
    return JulianDate.fromDate(date);
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
    this.placementVersion += 1;
    for (const entity of this.shadowTrail) this.viewer.entities.remove(entity);
    this.viewer.destroy();
  }
}

function requireCesium() {
  // eslint-free local bridge for the static import tree.
  return { JulianDate: (globalThis as any).__CESIUM_JULIAN_DATE };
}
