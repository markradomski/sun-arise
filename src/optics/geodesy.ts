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

export interface DirectGeodesicResult {
  position: LatLng;
  /** Degrees clockwise from true north, arriving at the end point. */
  finalBearingDeg: number;
}

/**
 * Vincenty's direct formula: where you arrive travelling `distanceMeters` from
 * `from` along `bearingDeg`.
 *
 * The inverse of `inverseGeodesic`, and the reason profile samples can be laid
 * out along the true geodesic rather than along a straight interpolation of
 * latitude and longitude, which bends away from the real path.
 */
export function directGeodesic(
  from: LatLng,
  bearingDeg: number,
  distanceMeters: number,
): DirectGeodesicResult {
  if (distanceMeters === 0) {
    return { position: { ...from }, finalBearingDeg: normaliseBearing(bearingDeg) };
  }

  const alpha1 = bearingDeg * DEG;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);

  const tanU1 = (1 - F) * Math.tan(from.latitude * DEG);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;

  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const Acoef = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bcoef = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distanceMeters / (B * Acoef);
  let sinSigma = 0;
  let cosSigma = 1;
  let cos2SigmaM = 1;
  let deltaSigma = 0;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    deltaSigma =
      Bcoef *
      sinSigma *
      (cos2SigmaM +
        (Bcoef / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (Bcoef / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));

    const previous = sigma;
    sigma = distanceMeters / (B * Acoef) + deltaSigma;
    if (Math.abs(sigma - previous) < 1e-12) break;
  }

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const phi2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - F) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp),
  );
  const lambda = Math.atan2(
    sinSigma * sinAlpha1,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1,
  );
  const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
  const L =
    lambda -
    (1 - C) *
      F *
      sinAlpha *
      (sigma +
        C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

  const alpha2 = Math.atan2(sinAlpha, -tmp);

  return {
    position: {
      latitude: phi2 * RAD,
      longitude: normaliseLongitude(from.longitude + L * RAD),
    },
    finalBearingDeg: normaliseBearing(alpha2 * RAD),
  };
}

/** Wraps a longitude into [-180, 180). */
export function normaliseLongitude(longitudeDeg: number): number {
  const wrapped = ((longitudeDeg + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

/**
 * Points at the given distances along the geodesic from `from` towards `to`.
 *
 * One inverse solution fixes the path, then each distance is walked out along
 * it. Distances beyond the path length are allowed — they simply continue past
 * the far end on the same great-circle-like track.
 */
export function geodesicPoints(
  from: LatLng,
  to: LatLng,
  distancesMeters: number[],
): LatLng[] {
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(from, to);
  if (distanceMeters === 0) return distancesMeters.map(() => ({ ...from }));

  return distancesMeters.map((distance) => {
    if (distance <= 0) return { ...from };
    // Re-deriving the far end from the formula would leave it metres off the
    // point the user actually clicked; use the exact one.
    if (distance >= distanceMeters) return { ...to };
    return directGeodesic(from, initialBearingDeg, distance).position;
  });
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
