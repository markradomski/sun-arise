import { offsetByBearing, type LatLng } from "./geo";
import type { GeoPosition } from "./types";

export interface GridSpec {
  centre: LatLng;
  /** East-west span of the covered area, in metres. */
  extentMeters: number;
  /**
   * North-south span. Defaults to `extentMeters`, keeping the square the
   * single-house field has always used; a spread-out row of houses sets this
   * separately so the field does not pay for empty ground to the north.
   */
  extentNorthMeters?: number;
  spacingMeters: number;
}

export interface GridPoint {
  index: number;
  col: number;
  row: number;
  /** Metres east and north of the grid centre. */
  east: number;
  north: number;
  position: GeoPosition;
}

export interface Grid {
  cols: number;
  rows: number;
  spacingMeters: number;
  /** East-west span, in metres. */
  extentMeters: number;
  /** North-south span, in metres. */
  extentNorthMeters: number;
  centre: LatLng;
  points: GridPoint[];
}

export const DEFAULT_GRID: Pick<GridSpec, "extentMeters" | "spacingMeters"> = {
  extentMeters: 60,
  spacingMeters: 2,
};

/**
 * Square grid of ground positions centred on `centre`, ordered row-major from
 * the south-west corner. Heights start at zero and are filled in from terrain.
 */
export function groundGrid(spec: GridSpec): Grid {
  const extentNorth = spec.extentNorthMeters ?? spec.extentMeters;
  const cols =
    Math.max(1, Math.round(spec.extentMeters / spec.spacingMeters)) + 1;
  const rows = Math.max(1, Math.round(extentNorth / spec.spacingMeters)) + 1;
  const halfEast = spec.extentMeters / 2;
  const halfNorth = extentNorth / 2;
  const points: GridPoint[] = [];

  for (let row = 0; row < rows; row += 1) {
    const north = -halfNorth + row * spec.spacingMeters;
    for (let col = 0; col < cols; col += 1) {
      const east = -halfEast + col * spec.spacingMeters;
      const distance = Math.hypot(east, north);
      const bearing = (Math.atan2(east, north) * 180) / Math.PI;
      const at =
        distance === 0
          ? spec.centre
          : offsetByBearing(spec.centre, bearing, distance);

      points.push({
        index: points.length,
        col,
        row,
        east,
        north,
        position: { latitude: at.latitude, longitude: at.longitude, height: 0 },
      });
    }
  }

  return {
    cols,
    rows,
    spacingMeters: spec.spacingMeters,
    extentMeters: spec.extentMeters,
    extentNorthMeters: extentNorth,
    centre: spec.centre,
    points,
  };
}
