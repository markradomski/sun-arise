import {
  Cartesian3,
  Color,
  PointPrimitiveCollection,
  type Scene,
} from "cesium";
import type { Grid } from "../scene/grid";
import type { ExposureField } from "../solar/exposureField";

/**
 * Diagnostic point cloud for the ground exposure field.
 *
 * Deliberately a coarse three-step classification rather than a continuous
 * ramp: this exists to confirm the spatial field is correct, not to be the
 * final heatmap.
 *
 * Uses a PointPrimitiveCollection rather than entities because a default grid
 * is ~961 points and the entity layer is not built for that count.
 */
const SHADED = Color.fromCssColorString("#3f4a63");
const PARTIAL = Color.fromCssColorString("#9a8f6a");
const OPEN = Color.fromCssColorString("#ffd36a");

export class FieldOverlay {
  private points: PointPrimitiveCollection;

  constructor(private scene: Scene) {
    this.points = scene.primitives.add(new PointPrimitiveCollection());
  }

  update(grid: Grid | null, field: ExposureField | null) {
    this.points.removeAll();
    if (!grid || !field || field.pointCount === 0) return;

    const daylight = field.timeline.daylightMinutes;
    if (daylight <= 0) return;

    for (let i = 0; i < grid.points.length && i < field.pointCount; i += 1) {
      const point = grid.points[i];
      const fraction = field.minutes[i] / daylight;

      this.points.add({
        position: Cartesian3.fromDegrees(
          point.position.longitude,
          point.position.latitude,
          point.position.height + 0.15,
        ),
        pixelSize: 5,
        color: classify(fraction).withAlpha(0.85),
      });
    }
  }

  clear() {
    this.points.removeAll();
  }

  destroy() {
    this.scene.primitives.remove(this.points);
  }
}

function classify(fraction: number): Color {
  if (fraction < 0.34) return SHADED;
  if (fraction < 0.95) return PARTIAL;
  return OPEN;
}
