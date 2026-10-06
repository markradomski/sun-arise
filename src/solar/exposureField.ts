import type { GeoPosition } from "../scene/types";
import {
  directSunMinutes,
  type BoxOccluder,
  type SunTimeline,
} from "./exposure";

/**
 * Direct-sun exposure for a set of sample points sharing one sun timeline.
 *
 * Takes plain positions rather than a grid so the same batch serves roof,
 * facade or window sample sets later; the ground grid is just the first caller.
 *
 * Per-point minutes are held in a typed array rather than per-point objects,
 * and the timeline is referenced once rather than copied into every entry.
 * Intervals are deliberately not stored: recovering them for a single point of
 * interest is a cheap re-evaluation against the same timeline.
 */
export interface ExposureField {
  timeline: SunTimeline;
  /** Direct-sun minutes per sample point, in input order. */
  minutes: Float32Array;
  pointCount: number;
  minMinutes: number;
  maxMinutes: number;
  /** Wall-clock milliseconds spent evaluating the field. */
  computeMs: number;
}

/**
 * Ground area receiving at least `hours` of direct sun, in square metres.
 *
 * Counted from the analytical samples, each standing for one grid cell, rather
 * than measured off the rendered heatmap.
 */
export function areaAboveHours(
  field: ExposureField,
  cellAreaSquareMeters: number,
  hours: number,
): number {
  const threshold = hours * 60;
  let cells = 0;
  for (let i = 0; i < field.pointCount; i += 1) {
    if (field.minutes[i] >= threshold) cells += 1;
  }
  return cells * cellAreaSquareMeters;
}

/** Mean direct-sun minutes across the sampled points. */
export function meanMinutes(field: ExposureField): number {
  if (field.pointCount === 0) return 0;
  let total = 0;
  for (let i = 0; i < field.pointCount; i += 1) total += field.minutes[i];
  return total / field.pointCount;
}

export function exposureField(
  points: GeoPosition[],
  occluders: BoxOccluder[],
  timeline: SunTimeline,
): ExposureField {
  const started = performance.now();
  const minutes = new Float32Array(points.length);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < points.length; i += 1) {
    const value = directSunMinutes(points[i], occluders, timeline);
    minutes[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return {
    timeline,
    minutes,
    pointCount: points.length,
    minMinutes: points.length > 0 ? min : 0,
    maxMinutes: points.length > 0 ? max : 0,
    computeMs: performance.now() - started,
  };
}
