import {
  ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  type Viewer,
} from "cesium";
import type { Grid } from "../scene/grid";
import { featherAlpha } from "../scene/featherMask";

/**
 * One colour per grid sample. The overlay draws whatever it is handed and
 * knows nothing about hours, strength or which ramp produced the colour.
 */
export interface OverlaySource {
  pointCount: number;
  colourAt(index: number): [number, number, number];
}

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

/**
 * Frames to wait for a prepared layer before swapping regardless. Only a
 * backstop: if the globe never settles, because the camera is moving or a tile
 * request is slow, the overlay must still advance rather than freeze.
 */
const MAX_SWAP_FRAMES = 30;

export class HeatmapOverlay {
  /** The layer currently on screen. */
  private layer: ImageryLayer | null = null;
  /** Attached and loading at alpha 0, not yet shown. */
  private pending: ImageryLayer | null = null;
  private canvas = document.createElement("canvas");
  /** Exposure colours at one pixel per sample, before the feather is applied. */
  private dataCanvas = document.createElement("canvas");
  /** Starts hidden: the layer is attached before the map is ever shown. */
  private visible = false;
  /** Milliseconds spent in the most recent update. */
  lastUpdateMs = 0;
  /**
   * Updates are asynchronous and NOW mode issues them while the clock runs, so
   * a later one must be able to overtake an earlier one. Anything that finishes
   * after a newer update has started is dropped rather than swapped in, which
   * keeps the collection at one overlay layer and the newest image on screen.
   */
  private updateToken = 0;

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

  async update(grid: Grid | null, source: OverlaySource | null) {
    const started = performance.now();
    const token = (this.updateToken += 1);

    if (!grid || !source || source.pointCount === 0) {
      this.clear();
      this.lastUpdateMs = performance.now() - started;
      return;
    }

    this.paint(grid, source);

    const rectangle = Rectangle.fromDegrees(
      ...boundsDegrees(grid),
    );
    const provider = await SingleTileImageryProvider.fromUrl(
      this.canvas.toDataURL(),
      { rectangle },
    );

    if (token !== this.updateToken) return;

    // Double buffered. Removing a layer frees its imagery from every tile it
    // covers immediately, while the replacement's imagery is still loading
    // into them, so swapping in one step leaves frames with bare terrain. The
    // new layer is therefore attached transparent, left to load while the
    // current one keeps drawing, and only then promoted.
    const next = new ImageryLayer(provider, { alpha: 0 });
    this.viewer.imageryLayers.add(next);
    this.discardPending();
    this.pending = next;

    await this.whenDrawable();
    // A newer update has already discarded this layer and owns the swap.
    if (token !== this.updateToken) return;

    const previous = this.layer;
    next.alpha = this.visible ? OVERLAY_ALPHA : 0;
    this.layer = next;
    this.pending = null;
    if (previous) this.viewer.imageryLayers.remove(previous, true);

    this.lastUpdateMs = performance.now() - started;
  }

  /**
   * Resolves once the globe has had a chance to draw the newly attached layer.
   * `tilesLoaded` covers the imagery actually reaching the tiles; the frame
   * count makes sure at least one render has happened since the layer was
   * added, and bounds the wait if the globe never settles.
   */
  private whenDrawable(): Promise<void> {
    const scene = this.viewer.scene;
    return new Promise((resolve) => {
      let frames = 0;
      const stop = scene.postRender.addEventListener(() => {
        frames += 1;
        if ((frames >= 2 && scene.globe.tilesLoaded) || frames >= MAX_SWAP_FRAMES) {
          stop();
          resolve();
        }
      });
    });
  }

  /** Drops a prepared layer that a newer update has superseded. */
  private discardPending() {
    if (!this.pending) return;
    this.viewer.imageryLayers.remove(this.pending, true);
    this.pending = null;
  }

  private paint(grid: Grid, source: OverlaySource) {
    const samples = this.dataCanvas;
    samples.width = grid.cols;
    samples.height = grid.rows;

    const sourceContext = samples.getContext("2d");
    if (!sourceContext) return;

    const image = sourceContext.createImageData(grid.cols, grid.rows);
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const sample = row * grid.cols + col;
        // Grid rows run south to north; image rows run north to south.
        const pixel = ((grid.rows - 1 - row) * grid.cols + col) * 4;
        const [r, g, b] = source.colourAt(sample);
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
    context.drawImage(samples, 0, 0, width, height);

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
    this.discardPending();
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
