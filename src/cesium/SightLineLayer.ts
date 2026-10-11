import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  Color,
  HeightReference,
  PolylineOutlineMaterialProperty,
  type Entity,
  type Viewer,
} from "cesium";
import type { GeoPosition } from "../scene/types";
import type { VisibilityClass } from "../optics/sightLine";

/**
 * The target marker and the camera-to-target sight line.
 *
 * The line is drawn with `ArcType.NONE` so it is the straight path through
 * space that the analysis tested, not a line draped over the ground. It is
 * *not* evidence of visibility: it is drawn identically whether terrain
 * clears it or cuts through it, and only its colour reports the verdict.
 *
 * Geometry is read through `CallbackProperty`, so dragging the target height
 * slider moves vertices rather than rebuilding entities every frame.
 */

export type SightLineStatus = VisibilityClass | "PENDING";

/** Dark outline on every stroke, or the line vanishes over bright imagery. */
const OUTLINE = Color.fromCssColorString("#05070a");

const STATUS_COLORS: Record<SightLineStatus, Color> = {
  PENDING: Color.fromCssColorString("#9fb0c4"),
  CLEAR: Color.fromCssColorString("#5fd38b"),
  OBSTRUCTED: Color.fromCssColorString("#ff6b6b"),
  INDETERMINATE: Color.fromCssColorString("#ffc14d"),
};

const TARGET_COLOR = Color.fromCssColorString("#66e0ff");

export interface SightLineView {
  /** Mount point plus mast: where the line starts. */
  cameraEye: GeoPosition;
  /** Target ground point; `height` is its sampled terrain elevation. */
  targetGround: GeoPosition;
  /** Metres above that terrain. */
  targetHeightMeters: number;
  status: SightLineStatus;
}

export class SightLineLayer {
  private view: SightLineView | null = null;
  private entities: Entity[] = [];
  private destroyed = false;

  constructor(private viewer: Viewer) {}

  update(view: SightLineView | null) {
    if (this.destroyed) return;
    this.view = view;
    if (!view) {
      this.setVisible(false);
      return;
    }
    if (this.entities.length === 0) this.build();
    this.setVisible(true);
  }

  private build() {
    // Camera to target, straight through space.
    this.entities.push(
      this.viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => this.linePositions(), false),
          width: 2.5,
          arcType: ArcType.NONE,
          material: new PolylineOutlineMaterialProperty({
            color: new CallbackProperty(() => this.statusColor(), false),
            outlineColor: OUTLINE,
            outlineWidth: 1.5,
          }),
        },
      }),
    );

    // The mast of the target: ground up to its height, when it has one.
    this.entities.push(
      this.viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => this.stemPositions(), false),
          width: 2,
          arcType: ArcType.NONE,
          material: new PolylineOutlineMaterialProperty({
            color: TARGET_COLOR,
            outlineColor: OUTLINE,
            outlineWidth: 1,
          }),
        },
      }),
    );

    this.entities.push(
      this.viewer.entities.add({
        position: new CallbackProperty(() => this.targetPoint(), false) as never,
        point: {
          pixelSize: 12,
          color: TARGET_COLOR,
          outlineColor: OUTLINE,
          outlineWidth: 2,
          // Always legible, even when the bay is behind a headland.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );

    // Where the target sits on the ground, so its height is readable.
    this.entities.push(
      this.viewer.entities.add({
        position: new CallbackProperty(() => this.groundPoint(), false) as never,
        point: {
          pixelSize: 6,
          color: TARGET_COLOR.withAlpha(0.7),
          outlineColor: OUTLINE,
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      }),
    );
  }

  private statusColor(): Color {
    return STATUS_COLORS[this.view?.status ?? "PENDING"];
  }

  private linePositions(): Cartesian3[] {
    const view = this.view;
    if (!view) return [];
    const eye = Cartesian3.fromDegrees(
      view.cameraEye.longitude,
      view.cameraEye.latitude,
      view.cameraEye.height,
    );
    const point = this.targetPoint();
    return point ? [eye, point] : [];
  }

  private stemPositions(): Cartesian3[] {
    const view = this.view;
    if (!view || view.targetHeightMeters <= 0) return [];
    return [this.groundPoint(), this.targetPoint()].filter(
      (position): position is Cartesian3 => position !== undefined,
    );
  }

  private targetPoint(): Cartesian3 | undefined {
    const view = this.view;
    if (!view) return undefined;
    return Cartesian3.fromDegrees(
      view.targetGround.longitude,
      view.targetGround.latitude,
      view.targetGround.height + view.targetHeightMeters,
    );
  }

  private groundPoint(): Cartesian3 | undefined {
    const view = this.view;
    if (!view) return undefined;
    return Cartesian3.fromDegrees(
      view.targetGround.longitude,
      view.targetGround.latitude,
      view.targetGround.height,
    );
  }

  private setVisible(visible: boolean) {
    for (const entity of this.entities) entity.show = visible;
  }

  destroy() {
    this.destroyed = true;
    for (const entity of this.entities) this.viewer.entities.remove(entity);
    this.entities = [];
    this.view = null;
  }
}
