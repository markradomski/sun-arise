import {
  CallbackProperty,
  Cartesian3,
  Color,
  HeightReference,
  type Viewer,
} from "cesium";
import type { SceneObject } from "../scene/types";
import { circlePoints, offsetByBearing } from "../scene/geo";

/**
 * Visual selection state: a ring on the ground beneath the selected object,
 * plus a spoke showing which way it faces.
 *
 * Cesium has no gizmo primitives, so this is hand-rolled from ground-clamped
 * polylines. Note that entity *outlines* are not supported on terrain — an
 * ellipse with `outline: true` silently renders nothing — hence the ring is a
 * clamped polyline rather than an ellipse outline.
 *
 * Geometry is fed through CallbackProperty so a drag updates the overlay
 * without churning entities.
 */

const RING_COLOR = Color.fromCssColorString("#f2efe7");
const MIN_RADIUS_METERS = 6;
const RADIUS_PADDING = 1.35;

export class SelectionOverlay {
  private ring;
  private spoke;
  private handle;
  private current: SceneObject | null = null;
  private radius = MIN_RADIUS_METERS;

  constructor(private viewer: Viewer) {
    this.ring = viewer.entities.add({
      show: false,
      polyline: {
        positions: new CallbackProperty(() => this.ringPositions(), false),
        width: 2,
        clampToGround: true,
        material: RING_COLOR.withAlpha(0.9),
      },
    });

    this.spoke = viewer.entities.add({
      show: false,
      polyline: {
        positions: new CallbackProperty(() => this.spokePositions(), false),
        width: 2,
        clampToGround: true,
        material: RING_COLOR.withAlpha(0.55),
      },
    });

    this.handle = viewer.entities.add({
      show: false,
      position: new CallbackProperty(() => this.handlePosition(), false) as any,
      point: {
        pixelSize: 10,
        color: RING_COLOR,
        outlineColor: Color.fromCssColorString("#05070a"),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  /**
   * @param radiusMeters Footprint radius of the selected model, when known.
   */
  update(object: SceneObject | null, radiusMeters?: number) {
    this.current = object;
    this.radius = Math.max(
      MIN_RADIUS_METERS,
      (radiusMeters ?? MIN_RADIUS_METERS) * RADIUS_PADDING,
    );

    const show = object !== null;
    this.ring.show = show;
    this.spoke.show = show;
    this.handle.show = show;
  }

  private ringPositions(): Cartesian3[] {
    const object = this.current;
    if (!object) return [];
    return circlePoints(object.position, this.radius).map((p) =>
      Cartesian3.fromDegrees(p.longitude, p.latitude),
    );
  }

  private spokePositions(): Cartesian3[] {
    const object = this.current;
    if (!object) return [];
    const edge = offsetByBearing(
      object.position,
      object.rotation.heading,
      this.radius,
    );
    return [
      Cartesian3.fromDegrees(object.position.longitude, object.position.latitude),
      Cartesian3.fromDegrees(edge.longitude, edge.latitude),
    ];
  }

  private handlePosition(): Cartesian3 | undefined {
    const object = this.current;
    if (!object) return undefined;
    const edge = offsetByBearing(
      object.position,
      object.rotation.heading,
      this.radius,
    );
    return Cartesian3.fromDegrees(edge.longitude, edge.latitude);
  }

  destroy() {
    this.viewer.entities.remove(this.ring);
    this.viewer.entities.remove(this.spoke);
    this.viewer.entities.remove(this.handle);
    this.current = null;
  }
}
