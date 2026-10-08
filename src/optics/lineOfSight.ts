import type { LatLng } from "../scene/geo";
import { curvatureDropMeters, DEFAULT_REFRACTION_K } from "./geodesy";

/**
 * Interfaces for terrain line-of-sight, and the one piece of it that is pure
 * arithmetic.
 *
 * Sampling terrain is a renderer concern and is deliberately not here: a
 * profile arrives already sampled, and this module decides what it means. That
 * keeps the judgement testable without Cesium, in the same way the solar engine
 * is testable without it.
 *
 * Nothing in this file is a viewshed. The radial viewshed is the next phase.
 *
 * ## What a clear result does and does not mean
 *
 * Cesium World Terrain is a bare-earth elevation model. It does not contain
 * trees, fences, sheds or neighbouring houses. A profile that clears the
 * terrain therefore establishes *terrain clearance*, which is a necessary but
 * not sufficient condition for seeing anything. Callers must present it as
 * such, and the clearance margin is reported in metres precisely so that
 * "clear by 0.4 m" is not read as "visible".
 */

export interface ProfileSample {
  position: LatLng;
  /** Metres along the geodesic from the observer. */
  distanceMeters: number;
  /**
   * Terrain elevation in the same datum as the observer and target heights.
   * Cesium World Terrain is ellipsoidal; mean sea level is a different datum
   * and the two must not be mixed.
   */
  terrainElevationMeters: number | undefined;
}

export interface TerrainProfile {
  from: LatLng;
  to: LatLng;
  /** Ordered by increasing distance, starting at the observer. */
  samples: ProfileSample[];
  spacingMeters: number;
  /** Samples the terrain provider could not resolve. */
  unresolvedCount: number;
}

export interface LineOfSightOptions {
  /** Absolute elevation of the lens, same datum as the profile. */
  observerElevationMeters: number;
  /** Absolute elevation of the target, same datum as the profile. */
  targetElevationMeters: number;
  refractionK?: number;
}

export interface LineOfSightResult {
  clear: boolean;
  /** Smallest gap between the sight line and the terrain, in metres. */
  minimumClearanceMeters: number;
  /** Where that smallest gap occurs, metres from the observer. */
  minimumClearanceAtMeters: number;
  /** First distance at which terrain rises through the line, if any. */
  blockedAtMeters: number | null;
  /** True when samples were missing, so the verdict is incomplete. */
  incomplete: boolean;
}

/**
 * Clearance of a straight sight line over an already-sampled profile.
 *
 * Curvature and refraction are applied as a correction to the terrain, not to
 * the line: the surface falls away from the observer with distance, and
 * refraction reduces how far it appears to fall. Terrain relief is whatever
 * the samples say and is kept entirely separate from that correction.
 */
export function lineOfSight(
  profile: TerrainProfile,
  options: LineOfSightOptions,
): LineOfSightResult {
  const refractionK = options.refractionK ?? DEFAULT_REFRACTION_K;
  const samples = profile.samples;
  const total = samples.length > 0 ? samples[samples.length - 1].distanceMeters : 0;

  let minimumClearance = Number.POSITIVE_INFINITY;
  let minimumAt = 0;
  let blockedAt: number | null = null;
  let incomplete = profile.unresolvedCount > 0;

  // Only the ground *between* the ends can block the view. The observer and
  // the target lie on the sight line by definition, so including them would
  // pin the minimum clearance at zero for every profile and say nothing.
  for (let index = 1; index < samples.length - 1; index += 1) {
    const sample = samples[index];
    if (sample.terrainElevationMeters === undefined) {
      incomplete = true;
      continue;
    }
    if (total <= 0) continue;

    const fraction = sample.distanceMeters / total;
    const lineElevation =
      options.observerElevationMeters +
      (options.targetElevationMeters - options.observerElevationMeters) * fraction;

    const apparentTerrain =
      sample.terrainElevationMeters -
      curvatureDropMeters(sample.distanceMeters, refractionK);

    const clearance = lineElevation - apparentTerrain;
    if (clearance < minimumClearance) {
      minimumClearance = clearance;
      minimumAt = sample.distanceMeters;
    }
    if (clearance < 0 && blockedAt === null) blockedAt = sample.distanceMeters;
  }

  // Nothing between the ends was measurable, so there is no verdict to give.
  if (!Number.isFinite(minimumClearance)) {
    return {
      clear: false,
      minimumClearanceMeters: 0,
      minimumClearanceAtMeters: 0,
      blockedAtMeters: null,
      incomplete: true,
    };
  }

  return {
    clear: blockedAt === null,
    minimumClearanceMeters: minimumClearance,
    minimumClearanceAtMeters: minimumAt,
    blockedAtMeters: blockedAt,
    incomplete,
  };
}

/**
 * Contract the future Cesium-side profiler must satisfy.
 *
 * `signal` is required rather than optional: a profile at surf-cam range is
 * thousands of terrain samples, and a camera that has since been dragged must
 * be able to abandon the request rather than let a stale result land. The
 * existing `TerrainSampler` solves the same problem with a token; either is
 * acceptable, but the capability is not.
 */
export interface TerrainProfiler {
  profile(
    from: LatLng,
    to: LatLng,
    options: { spacingMeters: number; signal: AbortSignal },
  ): Promise<TerrainProfile>;
}
