import {
  BoundingSphere,
  Cartesian3,
  EasingFunction,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  type Viewer,
} from "cesium";
import type { CameraMode, GeoPosition } from "../scene/types";

/**
 * Named camera states.
 *
 * Every interactive state keeps its pitch well clear of -90. An exactly
 * vertical camera makes Cesium's pick ray degenerate ("normalized result is
 * not a number"), which silently breaks selection, dragging and ground
 * placement — so no state here may be straight down.
 */
interface ModeSpec {
  /** Metres from the target for object-framing modes. */
  range: number;
  /** Degrees below horizontal. Never -90. */
  pitchDeg: number;
  /** Degrees clockwise from north, as an offset around the target. */
  headingDeg: number;
  /** Framing modes orbit a target; altitude modes sit above a coordinate. */
  kind: "frame" | "altitude";
}

export const CAMERA_MODES: Record<CameraMode, ModeSpec> = {
  /** Whole-Earth view, used for choosing a location. */
  ORBIT: { range: 14_000_000, pitchDeg: -89, headingDeg: 0, kind: "altitude" },
  /** State/region scale. */
  REGION: { range: 420_000, pitchDeg: -80, headingDeg: 0, kind: "altitude" },
  /**
   * The app's default. Close and oblique: the house is clearly visible with
   * enough surrounding land to read its cast shadow.
   */
  SITE: { range: 80, pitchDeg: -50, headingDeg: 20, kind: "frame" },
  /** Closer still, for manipulating the object. */
  HOUSE: { range: 38, pitchDeg: -32, headingDeg: 35, kind: "frame" },
  /**
   * Higher and steeper than SITE so the house and its full cast shadow can be
   * compared in one view across the day.
   */
  SOLAR: { range: 110, pitchDeg: -56, headingDeg: 0, kind: "frame" },
};

export const DEFAULT_CAMERA_MODE: CameraMode = "SITE";

const FLY_DURATION_SECONDS = 1.8;

export type { CameraMode };

export class CameraController {
  constructor(private viewer: Viewer) {}

  /** Jump straight to a state, no animation. Used for the initial view. */
  setTo(mode: CameraMode, target: GeoPosition, overrides?: Partial<ModeSpec>) {
    this.apply(mode, target, false, overrides);
  }

  /** Animate to a state. */
  flyTo(mode: CameraMode, target: GeoPosition, overrides?: Partial<ModeSpec>) {
    this.apply(mode, target, true, overrides);
  }

  private apply(
    mode: CameraMode,
    target: GeoPosition,
    animate: boolean,
    overrides?: Partial<ModeSpec>,
  ) {
    const spec = { ...CAMERA_MODES[mode], ...overrides };
    const { camera } = this.viewer;

    if (spec.kind === "altitude") {
      const destination = Cartesian3.fromDegrees(
        target.longitude,
        target.latitude,
        spec.range,
      );
      const orientation = {
        heading: CesiumMath.toRadians(spec.headingDeg),
        pitch: CesiumMath.toRadians(spec.pitchDeg),
        roll: 0,
      };
      if (animate) {
        camera.flyTo({
          destination,
          orientation,
          duration: FLY_DURATION_SECONDS,
          easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        });
      } else {
        camera.setView({ destination, orientation });
      }
      return;
    }

    const centre = Cartesian3.fromDegrees(
      target.longitude,
      target.latitude,
      target.height,
    );
    const offset = new HeadingPitchRange(
      CesiumMath.toRadians(spec.headingDeg),
      CesiumMath.toRadians(spec.pitchDeg),
      spec.range,
    );

    if (animate) {
      // flyToBoundingSphere animates to the same framing as lookAt and leaves
      // the camera in the world frame when it lands, so it needs no release.
      camera.flyToBoundingSphere(new BoundingSphere(centre, 1), {
        offset,
        duration: FLY_DURATION_SECONDS,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
      });
      return;
    }

    camera.lookAt(centre, offset);
    // lookAt locks the camera to the target's reference frame. Release it or
    // the user's own pan and zoom fight the lock.
    camera.lookAtTransform(Matrix4.IDENTITY);
  }
}
