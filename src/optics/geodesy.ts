import type { LatLng } from "../scene/geo";

/**
 * Long-range geodesy for the camera tools.
 *
 * `scene/geo.ts` has `eastNorthOffset`, which is an equirectangular
 * approximation documented as being for small separations. It is correct for a
 * house footprint and wrong for a camera looking kilometres out to sea, so
 * distances at that range come from here instead.
 *
 * Vincenty's inverse formula on the WGS84 ellipsoid, which is accurate to well
 * under a metre over the tens of kilometres this feature cares about.
 */

const A = 6_378_137.0; // WGS84 semi-major axis, metres
const F = 1 / 298.257223563; // flattening
const B = (1 - F) * A; // semi-minor axis
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Mean Earth radius, for curvature corrections where ellipsoidal detail is noise. */
export const MEAN_EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * Standard atmospheric refraction coefficient. Light bends towards the Earth,
 * so the apparent horizon is further away than geometry alone gives. 0.13 is
 * the usual survey value for a standard atmosphere; it is configurable because
 * it varies with temperature gradient, and over water it can vary a great deal.
 */
export const DEFAULT_REFRACTION_K = 0.13;

export interface GeodesicResult {
  distanceMeters: number;
  /** Degrees clockwise from true north, at the start point. */
  initialBearingDeg: number;
  /** Degrees clockwise from true north, arriving at the end point. */
  finalBearingDeg: number;
}

export function inverseGeodesic(from: LatLng, to: LatLng): GeodesicResult {
  const phi1 = from.latitude * DEG;
  const phi2 = to.latitude * DEG;
  const deltaLambda = (to.longitude - from.longitude) * DEG;

  const U1 = Math.atan((1 - F) * Math.tan(phi1));
  const U2 = Math.atan((1 - F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = deltaLambda;
  let sinLambda = 0;
  let cosLambda = 1;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cos2SigmaM = 1;
  let cosSqAlpha = 1;

  // Converges in a handful of iterations except for near-antipodal pairs,
  // which this feature never produces; the cap stops it hanging regardless.
  for (let iteration = 0; iteration < 200; iteration += 1) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);

    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) {
      // Coincident points.
      return { distanceMeters: 0, initialBearingDeg: 0, finalBearingDeg: 0 };
    }

    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);

    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    // Equatorial lines leave cos²α at zero; the series term drops out.
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;

    const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    const previous = lambda;
    lambda =
      deltaLambda +
      (1 - C) *
        F *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

    if (Math.abs(lambda - previous) < 1e-12) break;
  }

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const Acoef = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bcoef = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    Bcoef *
    sinSigma *
    (cos2SigmaM +
      (Bcoef / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (Bcoef / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  const distanceMeters = B * Acoef * (sigma - deltaSigma);

  const initial = Math.atan2(
    cosU2 * sinLambda,
    cosU1 * sinU2 - sinU1 * cosU2 * cosLambda,
  );
  const final = Math.atan2(
    cosU1 * sinLambda,
    -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda,
  );

  return {
    distanceMeters,
    initialBearingDeg: normaliseBearing(initial * RAD),
    finalBearingDeg: normaliseBearing(final * RAD),
  };
}

/** Wraps any bearing into [0, 360). */
export function normaliseBearing(bearingDeg: number): number {
  const wrapped = bearingDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * How far below the straight line of sight the curved surface falls at a given
 * distance, with refraction easing the drop.
 *
 * This is a *curvature* correction only. It says nothing about the terrain,
 * which varies independently and must be sampled; the two are kept separate so
 * neither is mistaken for the other.
 */
export function curvatureDropMeters(
  distanceMeters: number,
  refractionK = DEFAULT_REFRACTION_K,
): number {
  return (distanceMeters * distanceMeters * (1 - refractionK)) /
    (2 * MEAN_EARTH_RADIUS_METERS);
}

/**
 * Distance to the visible horizon for an eye at `heightMeters` above the
 * surface. Sea-level horizon only: it assumes the surface stays at the same
 * level, which is true over water and not over land.
 */
export function horizonDistanceMeters(
  heightMeters: number,
  refractionK = DEFAULT_REFRACTION_K,
): number {
  if (heightMeters <= 0) return 0;
  const effectiveRadius = MEAN_EARTH_RADIUS_METERS / (1 - refractionK);
  return Math.sqrt(2 * effectiveRadius * heightMeters + heightMeters * heightMeters);
}
