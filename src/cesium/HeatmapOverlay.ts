import {
  ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  type Viewer,
} from "cesium";
import type { Grid } from "../scene/grid";
import { colourForMinutes } from "../solar/exposureRamp";
import type { ExposureField } from "../solar/exposureField";

/**
 * Exposure heatmap drawn as a draped imagery layer.
 *
 * Imagery follows terrain by construction, so the overlay stays on the ground
 * across slopes without ground-primitive z-fighting, and it sits under the
 * house model rather than over it. One layer is swapped per update rather than
 * any per-cell geometry being rebuilt.
 *
 * The canvas is the analytical grid at one pixel per sample; the smoothing that
 * makes it continuous is the GPU's texture filtering, so no interpolated value
 * ever enters the exposure data.
 */
const OVERLAY_ALPHA = 0.62;

export class HeatmapOverlay {
  private layer: ImageryLayer | null = null;
  private canvas = document.createElement("canvas");
  /** Milliseconds spent in the most recent update. */
  lastUpdateMs = 0;

  constructor(private viewer: Viewer) {}

  async update(grid: Grid | null, field: ExposureField | null) {
    const started = performance.now();

    if (!grid || !field || field.pointCount === 0) {
      this.clear();
      this.lastUpdateMs = performance.now() - started;
      return;
    }

    this.paint(grid, field);

    const rectangle = Rectangle.fromDegrees(
      ...boundsDegrees(grid),
    );
    const provider = await SingleTileImageryProvider.fromUrl(
      this.canvas.toDataURL(),
      { rectangle },
    );

    const next = new ImageryLayer(provider, { alpha: OVERLAY_ALPHA });
    this.viewer.imageryLayers.add(next);
    this.removeLayer();
    this.layer = next;

    this.lastUpdateMs = performance.now() - started;
  }

  private paint(grid: Grid, field: ExposureField) {
    this.canvas.width = grid.cols;
    this.canvas.height = grid.rows;

    const context = this.canvas.getContext("2d");
    if (!context) return;

    const image = context.createImageData(grid.cols, grid.rows);
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const sample = row * grid.cols + col;
        // Grid rows run south to north; image rows run north to south.
        const pixel = ((grid.rows - 1 - row) * grid.cols + col) * 4;
        const [r, g, b] = colourForMinutes(field.minutes[sample]);
        image.data[pixel] = r;
        image.data[pixel + 1] = g;
        image.data[pixel + 2] = b;
        image.data[pixel + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  private removeLayer() {
    if (!this.layer) return;
    this.viewer.imageryLayers.remove(this.layer, true);
    this.layer = null;
  }

  clear() {
    this.removeLayer();
  }

  destroy() {
    this.removeLayer();
  }
}

/** West, south, east, north in degrees, from the grid's own sample positions. */
function boundsDegrees(grid: Grid): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const point of grid.points) {
    const { latitude, longitude } = point.position;
    if (longitude < west) west = longitude;
    if (longitude > east) east = longitude;
    if (latitude < south) south = latitude;
    if (latitude > north) north = latitude;
  }

  // Samples mark cell centres; extend by half a cell so the drawn surface
  // covers the area the samples represent.
  const halfLon = (east - west) / (grid.cols - 1) / 2;
  const halfLat = (north - south) / (grid.rows - 1) / 2;
  return [west - halfLon, south - halfLat, east + halfLon, north + halfLat];
}
