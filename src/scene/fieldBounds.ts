import { offsetByBearing, type LatLng } from "./geo";
import { footprintSamples } from "./footprint";
import { inverseGeodesic } from "../optics/geodesy";
import type { SceneObject } from "./types";

/**
 * Where the sunlight field should sit and how far it should reach.
 *
 * The field used to be a fixed 60 m square centred on the first house, so a
 * second house further than about 30 m away had neither itself nor its shadow
 * inside the analysed area. Coverage now follows the houses.
 *
 * Pure geometry: no Cesium, no store, no terrain. Heights are filled in later
 * by the terrain sampler, exactly as before.
 */

export interface FieldBounds {
  centre: LatLng;
  /** Full east-west span of the analysed area, in metres. */
  extentEastMeters: number;
  /** Full north-south span, in metres. */
  extentNorthMeters: number;
  /** True when the houses are spread wider than the sample budget allows. */
  clamped: boolean;
  /** Metres of the requested span that had to be dropped, per axis. */
  droppedEastMeters: number;
  droppedNorthMeters: number;
  sampleCount: number;
}

export interface FieldBoundsOptions {
  spacingMeters: number;
  /** Ground kept around the outermost footprints, for shadows and context. */
  marginMeters?: number;
  /** Smallest field, so a single house looks as it always has. */
  minimumExtentMeters?: number;
  /** Hard ceiling on analytical cost. Sampling density is never traded away. */
  maxSamples?: number;
}

const DEFAULT_MARGIN_METERS = 20;
const DEFAULT_MINIMUM_EXTENT_METERS = 60;

/**
 * Ceiling on the number of ground samples.
 *
 * 40,000 is a little over 40x the old 961-point field. Past this the field is
 * clipped rather than thinned: a coarser grid would quietly change what the
 * colours mean, and a field that silently became approximate would be worse
 * than one that visibly does not reach.
 */
export const MAX_FIELD_SAMPLES = 40_000;

interface LocalOffset {
  east: number;
  north: number;
}

/**
 * Metres east and north from `origin` to `point`.
 *
 * Uses the geodesic rather than `eastNorthOffset`, which is documented as
 * being for small separations: houses here may be hundreds of metres apart.
 */
function localOffset(origin: LatLng, point: LatLng): LocalOffset {
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(origin, point);
  const bearing = (initialBearingDeg * Math.PI) / 180;
  return {
    east: distanceMeters * Math.sin(bearing),
    north: distanceMeters * Math.cos(bearing),
  };
}

/**
 * Bounds covering every house's rotated footprint, plus any extra positions
 * the caller needs inside the same field — a saved baseline placement, so the
 * comparison measures both arrangements over identical ground.
 *
 * Returns null when there is nothing to analyse.
 */
export function fieldBounds(
  houses: SceneObject[],
  extraPositions: LatLng[],
  options: FieldBoundsOptions,
): FieldBounds | null {
  if (houses.length === 0) return null;

  const margin = options.marginMeters ?? DEFAULT_MARGIN_METERS;
  const minimum = options.minimumExtentMeters ?? DEFAULT_MINIMUM_EXTENT_METERS;
  const maxSamples = options.maxSamples ?? MAX_FIELD_SAMPLES;
  // The local frame is anchored to whichever house sorts first by id, not to
  // whichever happens to be first in the array. Every offset is measured from
  // that origin, so the field lands in exactly the same place however the
  // collection is ordered.
  const origin = [...houses].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
    .position;

  let minEast = Infinity;
  let maxEast = -Infinity;
  let minNorth = Infinity;
  let maxNorth = -Infinity;

  const include = (east: number, north: number) => {
    if (east < minEast) minEast = east;
    if (east > maxEast) maxEast = east;
    if (north < minNorth) minNorth = north;
    if (north > maxNorth) maxNorth = north;
  };

  for (const house of houses) {
    const centre = localOffset(origin, house.position);
    // The footprint corners already account for the house's heading, so a
    // rotated building widens the bounds the way it actually sits.
    for (const sample of footprintSamples(house)) {
      include(centre.east + sample.east, centre.north + sample.north);
    }
  }

  for (const position of extraPositions) {
    const offset = localOffset(origin, position);
    include(offset.east, offset.north);
  }

  const centreEast = (minEast + maxEast) / 2;
  const centreNorth = (minNorth + maxNorth) / 2;

  let extentEast = Math.max(minimum, maxEast - minEast + margin * 2);
  let extentNorth = Math.max(minimum, maxNorth - minNorth + margin * 2);

  const requestedEast = extentEast;
  const requestedNorth = extentNorth;

  const clamp = clampToBudget(
    extentEast,
    extentNorth,
    options.spacingMeters,
    maxSamples,
  );
  extentEast = clamp.east;
  extentNorth = clamp.north;

  const distance = Math.hypot(centreEast, centreNorth);
  const bearing = (Math.atan2(centreEast, centreNorth) * 180) / Math.PI;
  const centre =
    distance === 0
      ? { latitude: origin.latitude, longitude: origin.longitude }
      : offsetByBearing(origin, bearing, distance);

  return {
    centre,
    extentEastMeters: extentEast,
    extentNorthMeters: extentNorth,
    clamped: clamp.clamped,
    droppedEastMeters: Math.max(0, requestedEast - extentEast),
    droppedNorthMeters: Math.max(0, requestedNorth - extentNorth),
    sampleCount: cellCount(extentEast, options.spacingMeters) *
      cellCount(extentNorth, options.spacingMeters),
  };
}

function cellCount(extentMeters: number, spacingMeters: number): number {
  return Math.max(1, Math.round(extentMeters / spacingMeters)) + 1;
}

/**
 * Shrinks the field to fit the sample budget, keeping its shape.
 *
 * Both axes are scaled by the same factor so the analysed area stays centred
 * on the houses rather than favouring one direction.
 */
function clampToBudget(
  extentEast: number,
  extentNorth: number,
  spacingMeters: number,
  maxSamples: number,
): { east: number; north: number; clamped: boolean } {
  const wantedCols = cellCount(extentEast, spacingMeters);
  const wantedRows = cellCount(extentNorth, spacingMeters);
  if (wantedCols * wantedRows <= maxSamples) {
    return { east: extentEast, north: extentNorth, clamped: false };
  }

  // Scale both axes together, then trim the longer one a cell at a time. The
  // scale alone can land just over the budget, because each axis rounds to a
  // whole number of cells and carries a fencepost.
  const scale = Math.sqrt(maxSamples / (wantedCols * wantedRows));
  let cols = Math.max(2, Math.floor(wantedCols * scale));
  let rows = Math.max(2, Math.floor(wantedRows * scale));
  while (cols * rows > maxSamples && (cols > 2 || rows > 2)) {
    if (cols >= rows && cols > 2) cols -= 1;
    else if (rows > 2) rows -= 1;
    else cols -= 1;
  }

  return {
    east: (cols - 1) * spacingMeters,
    north: (rows - 1) * spacingMeters,
    clamped: true,
  };
}
