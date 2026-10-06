import {
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  type Viewer,
} from "cesium";
import type { SceneObject } from "../scene/types";
import { circlePoints, offsetByBearing } from "../scene/geo";
import { footprintRadius } from "../houses/catalog";

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
const OUTLINE_COLOR = Color.fromCssColorString("#05070a");
const MIN_RADIUS_METERS = 4;
/** Just enough clearance to read as a handle, not as a site boundary. */
const RADIUS_PADDING = 1.2;

export class SelectionOverlay {
  private ring;
  private spoke;
  private handle;
  private current: SceneObject | null = null;
  private radius = MIN_RADIUS_METERS;
  private latched = false;

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
        pixelSize: new CallbackProperty(() => (this.latched ? 14 : 10), false),
        color: RING_COLOR,
        outlineColor: new CallbackProperty(
          () => (this.latched ? RING_COLOR.withAlpha(0.45) : OUTLINE_COLOR),
          false,
        ) as any,
        outlineWidth: new CallbackProperty(() => (this.latched ? 6 : 2), false),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  update(object: SceneObject | null) {
    this.current = object;
    this.radius = object
      ? Math.max(
          MIN_RADIUS_METERS,
          footprintRadius(object.modelUrl, object.scale) * RADIUS_PADDING,
        )
      : MIN_RADIUS_METERS;

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

  /** World position of the heading handle, for screen-space hit testing. */
  handleWorldPosition(): Cartesian3 | undefined {
    return this.handlePosition();
  }

  centreWorldPosition(): Cartesian3 | undefined {
    const object = this.current;
    if (!object) return undefined;
    return Cartesian3.fromDegrees(
      object.position.longitude,
      object.position.latitude,
      object.position.height,
    );
  }

  setLatched(latched: boolean) {
    this.latched = latched;
  }

  /**
   * The handle is drawn clamped to terrain, so its position must carry the
   * ground height. Built at sea level it still renders in the right place but
   * projects to a screen point far from the drawn dot, which puts hit testing
   * somewhere the user cannot see.
   */
  private handlePosition(): Cartesian3 | undefined {
    const object = this.current;
    if (!object) return undefined;
    const edge = offsetByBearing(
      object.position,
      object.rotation.heading,
      this.radius,
    );
    const ground = this.viewer.scene.globe.getHeight(
      Cartographic.fromDegrees(edge.longitude, edge.latitude),
    );
    return Cartesian3.fromDegrees(
      edge.longitude,
      edge.latitude,
      ground ?? object.position.height,
    );
  }

  destroy() {
    this.viewer.entities.remove(this.ring);
    this.viewer.entities.remove(this.spoke);
    this.viewer.entities.remove(this.handle);
    this.current = null;
  }
}
