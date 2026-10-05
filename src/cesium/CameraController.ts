import {
  Cartesian3,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  type Viewer,
} from "cesium";
import type { SceneObject } from "../scene/types";

/**
 * Named camera states.
 *
 * Phase 1 step 6 will add transitions between these; for now SITE is the one
 * that matters — it is where the app opens.
 */

export const SITE_VIEW = {
  /** Metres from the target. */
  range: 80,
  /** Degrees below horizontal. Must stay off -90: an exactly vertical camera
   *  makes Cesium's pick ray degenerate ("normalized result is not a number"),
   *  which breaks object selection and dragging. */
  pitchDeg: -50,
  /** Degrees. Looks at the house from the south-south-west, which keeps the
   *  southern-hemisphere midday shadow in the foreground rather than behind
   *  the model. */
  headingDeg: 20,
} as const;

export class CameraController {
  constructor(private viewer: Viewer) {}

  /**
   * Frame an object at close, oblique range.
   *
   * Sets the view directly — no fly-from-space animation, so the house is
   * visible the moment the app is usable.
   */
  frameSite(object: SceneObject, options?: Partial<typeof SITE_VIEW>) {
    const { range, pitchDeg, headingDeg } = { ...SITE_VIEW, ...options };

    const target = Cartesian3.fromDegrees(
      object.position.longitude,
      object.position.latitude,
      object.position.height,
    );

    this.viewer.camera.lookAt(
      target,
      new HeadingPitchRange(
        CesiumMath.toRadians(headingDeg),
        CesiumMath.toRadians(pitchDeg),
        range,
      ),
    );

    // lookAt locks the camera to the target's reference frame. Release it, or
    // the user's own pan/zoom fights the lock.
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }
}
