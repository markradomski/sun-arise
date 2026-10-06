import { eastNorthOffset } from "../scene/geo";
import type { GeoPosition } from "../scene/types";
import { solarPosition } from "./solarPosition";

/**
 * Direct-sun exposure for a single point.
 *
 * Works purely from geometry: a sample point, the sun's position over time and
 * a set of occluding solids. Nothing here reads Cesium's shadow map or any
 * rendered output — the renderer's shadows and this engine are independent
 * systems that should happen to agree.
 *
 * The point is an arbitrary geographic position with a height, so the same
 * engine serves ground samples now and roof, facade or window samples later.
 */

export type ExposureState = "SUN" | "BLOCKED";

/**
 * An occluding solid. Currently a box, which is what a house footprint plus
 * ridge height describes; `occludes()` is the only place that assumes a shape.
 */
export interface BoxOccluder {
  /** Footprint centre at its base elevation. */
  position: GeoPosition;
  /** Extent across the heading direction. */
  widthMeters: number;
  /** Extent along the heading direction. */
  depthMeters: number;
  /** Height above the base elevation. */
  heightMeters: number;
  headingDeg: number;
}

export interface ExposureInterval {
  start: Date;
  end: Date;
  state: ExposureState;
}

export interface PointExposure {
  date: Date;
  daylightMinutes: number;
  directSunMinutes: number;
  /** Share of daylight in direct sun, 0 when there is no daylight at all. */
  directSunFraction: number;
  intervals: ExposureInterval[];
  sampleIntervalMinutes: number;
}

export interface ExposureOptions {
  /**
   * Minutes between samples. Five keeps a day to 288 evaluations while holding
   * interval edges to within a few minutes, which is finer than the input
   * geometry justifies.
   */
  sampleIntervalMinutes?: number;
  utcOffsetHours: number;
}

export interface SunSample {
  at: Date;
  azimuthDeg: number;
  altitudeDeg: number;
}

/**
 * Daylight sun positions for one civil day, computed once and shared across
 * every sample point. Across a site-scale field the sun's position varies by
 * far less than the sampling interval resolves, so recomputing it per point
 * would be pure waste.
 */
export interface SunTimeline {
  date: Date;
  sampleIntervalMinutes: number;
  /** Daylight samples only; night is absent rather than marked. */
  samples: SunSample[];
  daylightMinutes: number;
}

export function sunTimeline(
  location: { latitude: number; longitude: number },
  date: Date,
  options: ExposureOptions,
): SunTimeline {
  const step = options.sampleIntervalMinutes ?? DEFAULT_SAMPLE_INTERVAL_MINUTES;
  const count = Math.round((24 * 60) / step);
  const dayStart = startOfLocalDay(date, options.utcOffsetHours);
  const samples: SunSample[] = [];

  for (let i = 0; i < count; i += 1) {
    const at = new Date(dayStart.getTime() + i * step * 60_000);
    const sun = solarPosition(
      at,
      location.latitude,
      location.longitude,
      options.utcOffsetHours,
    );
    if (sun.altitudeDeg <= 0) continue;
    samples.push({ at, azimuthDeg: sun.azimuthDeg, altitudeDeg: sun.altitudeDeg });
  }

  return {
    date: dayStart,
    sampleIntervalMinutes: step,
    samples,
    daylightMinutes: samples.length * step,
  };
}

/** Minutes of direct sun for one point against a prepared timeline. */
export function directSunMinutes(
  point: GeoPosition,
  occluders: BoxOccluder[],
  timeline: SunTimeline,
): number {
  let minutes = 0;
  for (const sample of timeline.samples) {
    let blocked = false;
    for (const occluder of occluders) {
      if (occludes(occluder, point, sample.azimuthDeg, sample.altitudeDeg)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) minutes += timeline.sampleIntervalMinutes;
  }
  return minutes;
}

/** Full per-point result, including the sun/shade intervals. */
export function exposureFor(
  point: GeoPosition,
  occluders: BoxOccluder[],
  timeline: SunTimeline,
): PointExposure {
  const step = timeline.sampleIntervalMinutes;
  const intervals: ExposureInterval[] = [];
  let sunMinutes = 0;

  for (const sample of timeline.samples) {
    const blocked = occluders.some((occluder) =>
      occludes(occluder, point, sample.azimuthDeg, sample.altitudeDeg),
    );
    if (!blocked) sunMinutes += step;

    const state: ExposureState = blocked ? "BLOCKED" : "SUN";
    const end = new Date(sample.at.getTime() + step * 60_000);
    const previous = intervals[intervals.length - 1];

    if (
      previous &&
      previous.state === state &&
      previous.end.getTime() === sample.at.getTime()
    ) {
      previous.end = end;
    } else {
      intervals.push({ start: sample.at, end, state });
    }
  }

  return {
    date: timeline.date,
    daylightMinutes: timeline.daylightMinutes,
    directSunMinutes: sunMinutes,
    directSunFraction:
      timeline.daylightMinutes > 0 ? sunMinutes / timeline.daylightMinutes : 0,
    intervals,
    sampleIntervalMinutes: step,
  };
}

const DEFAULT_SAMPLE_INTERVAL_MINUTES = 5;
const DEG = Math.PI / 180;

/** Convenience wrapper that builds a timeline for a single point. */
export function pointExposure(
  point: GeoPosition,
  occluders: BoxOccluder[],
  date: Date,
  options: ExposureOptions,
): PointExposure {
  return exposureFor(point, occluders, sunTimeline(point, date, options));
}

/**
 * Whether the straight path from `point` towards the sun enters the box.
 *
 * Solved as a ray/box intersection in the occluder's own frame: the local axes
 * are the heading direction and its perpendicular, so the rotated box becomes
 * axis-aligned and the standard slab test applies.
 */
export function occludes(
  occluder: BoxOccluder,
  point: GeoPosition,
  sunAzimuthDeg: number,
  sunAltitudeDeg: number,
): boolean {
  if (sunAltitudeDeg <= 0) return false;

  const offset = eastNorthOffset(point, occluder.position);
  const heading = occluder.headingDeg * DEG;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);

  // Point relative to the box centre, expressed in the box's own axes.
  const relEast = -offset.east;
  const relNorth = -offset.north;
  const originX = relEast * cos - relNorth * sin;
  const originY = relEast * sin + relNorth * cos;
  const originZ = point.height - occluder.position.height;

  const altitude = sunAltitudeDeg * DEG;
  const azimuth = sunAzimuthDeg * DEG;
  const horizontal = Math.cos(altitude);
  const dirEast = horizontal * Math.sin(azimuth);
  const dirNorth = horizontal * Math.cos(azimuth);
  const dirX = dirEast * cos - dirNorth * sin;
  const dirY = dirEast * sin + dirNorth * cos;
  const dirZ = Math.sin(altitude);

  const halfWidth = occluder.widthMeters / 2;
  const halfDepth = occluder.depthMeters / 2;

  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;

  const slabs: [number, number, number, number][] = [
    [originX, dirX, -halfWidth, halfWidth],
    [originY, dirY, -halfDepth, halfDepth],
    [originZ, dirZ, 0, occluder.heightMeters],
  ];

  for (const [origin, direction, low, high] of slabs) {
    if (Math.abs(direction) < 1e-12) {
      if (origin < low || origin > high) return false;
      continue;
    }
    const t1 = (low - origin) / direction;
    const t2 = (high - origin) / direction;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }

  // A hit only counts ahead of the point; a sample on the box surface itself
  // must not shade itself.
  return tMax > 1e-6;
}

/** Local midnight for the civil day containing `date`. */
function startOfLocalDay(date: Date, utcOffsetHours: number): Date {
  const shifted = new Date(date.getTime() + utcOffsetHours * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - utcOffsetHours * 3_600_000);
}
