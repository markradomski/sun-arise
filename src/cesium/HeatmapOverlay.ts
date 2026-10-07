import {
  ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  type Viewer,
} from "cesium";
import type { Grid } from "../scene/grid";
import { colourForMinutes } from "../solar/exposureRamp";
import { featherAlpha } from "../scene/featherMask";
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

/** Output pixels per analytical sample, so the feather has room to ramp. */
const FEATHER_RESOLUTION = 8;

export class HeatmapOverlay {
  private layer: ImageryLayer | null = null;
  private canvas = document.createElement("canvas");
  /** Exposure colours at one pixel per sample, before the feather is applied. */
  private dataCanvas = document.createElement("canvas");
  /** Starts hidden: the layer is attached before the map is ever shown. */
  private visible = false;
  /** Milliseconds spent in the most recent update. */
  lastUpdateMs = 0;

  constructor(private viewer: Viewer) {}

  /**
   * Shows or hides the drawn layer by its alpha, never by `show`.
   *
   * Cesium routes `ImageryLayer.show` through the same path as adding a layer:
   * every loaded tile the layer covers is pushed back to LOADING and has its
   * imagery skeletons rebuilt. Alpha is applied when the tile is drawn, so it
   * changes nothing about the globe's tiles and costs a blend.
   */
  setVisible(visible: boolean) {
    this.visible = visible;
    if (this.layer) this.layer.alpha = visible ? OVERLAY_ALPHA : 0;
  }

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

    // Added before the old layer is removed so the ground is never uncovered.
    const next = new ImageryLayer(provider, {
      alpha: this.visible ? OVERLAY_ALPHA : 0,
    });
    this.viewer.imageryLayers.add(next);
    this.removeLayer();
    this.layer = next;

    this.lastUpdateMs = performance.now() - started;
  }

  private paint(grid: Grid, field: ExposureField) {
    const source = this.dataCanvas;
    source.width = grid.cols;
    source.height = grid.rows;

    const sourceContext = source.getContext("2d");
    if (!sourceContext) return;

    const image = sourceContext.createImageData(grid.cols, grid.rows);
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
    sourceContext.putImageData(image, 0, 0);

    // The feather needs more resolution than one pixel per sample, or its ramp
    // would be three texels wide and band visibly. The colours are enlarged
    // with the same bilinear smoothing the GPU would have applied, and the
    // mask is written over the enlarged image; the exposure data itself is
    // still only ever read at the sample positions above.
    const width = grid.cols * FEATHER_RESOLUTION;
    const height = grid.rows * FEATHER_RESOLUTION;
    this.canvas.width = width;
    this.canvas.height = height;

    const context = this.canvas.getContext("2d");
    if (!context) return;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);

    const masked = context.getImageData(0, 0, width, height);
    for (let y = 0; y < height; y += 1) {
      const v = (y + 0.5) / height;
      for (let x = 0; x < width; x += 1) {
        const u = (x + 0.5) / width;
        masked.data[(y * width + x) * 4 + 3] = Math.round(255 * featherAlpha(u, v));
      }
    }
    context.putImageData(masked, 0, 0);
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
