import type { GeoPosition } from "../scene/types";
import { occludes, type BoxOccluder, type ExposureState } from "./exposure";
import { solarPosition } from "./solarPosition";

/**
 * Direct sun at one instant, for every point of the ground grid.
 *
 * This is the same geometry the whole-day analysis uses, evaluated against a
 * single sun position instead of a day's timeline, so it costs one occlusion
 * test per point rather than one per point per timeline sample.
 *
 * It deliberately reports no irradiance. There is no validated sky or
 * atmosphere model here, so the only honest outputs are whether a point has a
 * clear line to the sun and how high the sun is.
 */

export interface InstantField {
  /** Relative direct-sun strength per point, 0 in shade, 0 to 1 in sun. */
  strength: Float32Array;
  pointCount: number;
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
  /** True when the sun is below the horizon and nothing is lit. */
  night: boolean;
  computeMs: number;
}

export interface InstantPoint {
  state: ExposureState;
  sunAltitudeDeg: number;
  night: boolean;
}

/**
 * Relative strength of direct sun on level ground at a given solar altitude.
 *
 * This is the geometric projection of a beam onto a horizontal surface, which
 * is why a low sun reads weaker than a high one. It is a ratio, not a measure
 * of energy: no atmospheric attenuation, no diffuse component, no units.
 */
export function relativeStrength(altitudeDeg: number): number {
  if (altitudeDeg <= 0) return 0;
  return Math.sin((altitudeDeg * Math.PI) / 180);
}

export function instantField(
  points: GeoPosition[],
  occluders: BoxOccluder[],
  location: { latitude: number; longitude: number },
  date: Date,
  options: { utcOffsetHours: number },
): InstantField {
  const started = performance.now();
  const sun = solarPosition(
    date,
    location.latitude,
    location.longitude,
    options.utcOffsetHours,
  );

  const strength = new Float32Array(points.length);
  const night = sun.altitudeDeg <= 0;
  const lit = relativeStrength(sun.altitudeDeg);

  if (!night) {
    for (let i = 0; i < points.length; i += 1) {
      let blocked = false;
      for (const occluder of occluders) {
        if (occludes(occluder, points[i], sun.azimuthDeg, sun.altitudeDeg)) {
          blocked = true;
          break;
        }
      }
      strength[i] = blocked ? 0 : lit;
    }
  }

  return {
    strength,
    pointCount: points.length,
    sunAltitudeDeg: sun.altitudeDeg,
    sunAzimuthDeg: sun.azimuthDeg,
    night,
    computeMs: performance.now() - started,
  };
}

/** The same evaluation for a single inspected point. */
export function instantPoint(
  point: GeoPosition,
  occluders: BoxOccluder[],
  location: { latitude: number; longitude: number },
  date: Date,
  options: { utcOffsetHours: number },
): InstantPoint {
  const sun = solarPosition(
    date,
    location.latitude,
    location.longitude,
    options.utcOffsetHours,
  );

  if (sun.altitudeDeg <= 0) {
    return { state: "BLOCKED", sunAltitudeDeg: sun.altitudeDeg, night: true };
  }

  const blocked = occluders.some((occluder) =>
    occludes(occluder, point, sun.azimuthDeg, sun.altitudeDeg),
  );

  return {
    state: blocked ? "BLOCKED" : "SUN",
    sunAltitudeDeg: sun.altitudeDeg,
    night: false,
  };
}
