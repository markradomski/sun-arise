/**
 * Spherical geometry helpers.
 *
 * Renderer-agnostic by design — these work on plain lat/lng degrees so both the
 * solar engine and the Cesium layer can share them.
 */

const EARTH_RADIUS_METERS = 6_371_000;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle offset from a point along a bearing (degrees clockwise from north). */
export function offsetByBearing(
  origin: LatLng,
  bearingDeg: number,
  distanceMeters: number,
): LatLng {
  const angular = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = bearingDeg * DEG;
  const lat = origin.latitude * DEG;
  const lng = origin.longitude * DEG;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinAngular = Math.sin(angular);
  const cosAngular = Math.cos(angular);

  const endLat = Math.asin(
    sinLat * cosAngular + cosLat * sinAngular * Math.cos(bearing),
  );
  const endLng =
    lng +
    Math.atan2(
      Math.sin(bearing) * sinAngular * cosLat,
      cosAngular - sinLat * Math.sin(endLat),
    );

  return { latitude: endLat * RAD, longitude: endLng * RAD };
}

/** Metres east and north from `from` to `to`, for small separations. */
export function eastNorthOffset(
  from: LatLng,
  to: LatLng,
): { east: number; north: number } {
  const meanLat = ((from.latitude + to.latitude) / 2) * DEG;
  return {
    east: (to.longitude - from.longitude) * DEG * EARTH_RADIUS_METERS * Math.cos(meanLat),
    north: (to.latitude - from.latitude) * DEG * EARTH_RADIUS_METERS,
  };
}

/** Evenly spaced points on a circle of `radiusMeters` around `origin`. */
export function circlePoints(
  origin: LatLng,
  radiusMeters: number,
  segments = 64,
): LatLng[] {
  return Array.from({ length: segments + 1 }, (_, index) =>
    offsetByBearing(origin, (index / segments) * 360, radiusMeters),
  );
}
