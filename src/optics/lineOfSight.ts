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
  /**
   * Finest spacing used, which is near the observer. Spacing widens with
   * distance, so this is the resolution limit of the verdict rather than a
   * uniform step.
   */
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

/**
 * One sample with everything the verdict was based on.
 *
 * The profile chart plots these directly rather than recomputing the sight
 * line, so what is drawn and what is reported cannot drift apart.
 */
export interface AnalysedSample {
  position: LatLng;
  distanceMeters: number;
  /** As sampled, before any curvature correction. */
  terrainElevationMeters: number | undefined;
  /**
   * Terrain lowered by the curvature drop at this distance: how far below a
   * straight sight line the surface has fallen away. This is the series the
   * clearance is measured against.
   */
  apparentTerrainMeters: number | undefined;
  /** Straight line from observer to target, at this distance. */
  lineElevationMeters: number;
  /** Line minus apparent terrain. Negative where terrain blocks the view. */
  clearanceMeters: number | undefined;
  /** False at the two endpoints, which are excluded from the verdict. */
  interior: boolean;
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
  /** How many interior samples actually carried an elevation. */
  measuredCount: number;
  /** Every sample, in order, with its computed line and clearance. */
  samples: AnalysedSample[];
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
  let measuredCount = 0;

  const analysed: AnalysedSample[] = samples.map((sample, index) => {
    // Only the ground *between* the ends can block the view. The observer and
    // the target lie on the sight line by definition, so including them would
    // pin the minimum clearance at zero for every profile and say nothing.
    const interior = index > 0 && index < samples.length - 1;

    const fraction = total > 0 ? sample.distanceMeters / total : 0;
    const lineElevation =
      options.observerElevationMeters +
      (options.targetElevationMeters - options.observerElevationMeters) * fraction;

    if (sample.terrainElevationMeters === undefined) {
      if (interior) incomplete = true;
      return {
        position: sample.position,
        distanceMeters: sample.distanceMeters,
        terrainElevationMeters: undefined,
        apparentTerrainMeters: undefined,
        lineElevationMeters: lineElevation,
        clearanceMeters: undefined,
        interior,
      };
    }

    const apparentTerrain =
      sample.terrainElevationMeters -
      curvatureDropMeters(sample.distanceMeters, refractionK);
    const clearance = lineElevation - apparentTerrain;

    if (interior && total > 0) {
      measuredCount += 1;
      if (clearance < minimumClearance) {
        minimumClearance = clearance;
        minimumAt = sample.distanceMeters;
      }
      if (clearance < 0 && blockedAt === null) blockedAt = sample.distanceMeters;
    }

    return {
      position: sample.position,
      distanceMeters: sample.distanceMeters,
      terrainElevationMeters: sample.terrainElevationMeters,
      apparentTerrainMeters: apparentTerrain,
      lineElevationMeters: lineElevation,
      clearanceMeters: clearance,
      interior,
    };
  });

  // Nothing between the ends was measurable, so there is no verdict to give.
  if (!Number.isFinite(minimumClearance)) {
    return {
      clear: false,
      minimumClearanceMeters: 0,
      minimumClearanceAtMeters: 0,
      blockedAtMeters: null,
      incomplete: true,
      measuredCount: 0,
      samples: analysed,
    };
  }

  return {
    clear: blockedAt === null,
    minimumClearanceMeters: minimumClearance,
    minimumClearanceAtMeters: minimumAt,
    blockedAtMeters: blockedAt,
    incomplete,
    measuredCount,
    samples: analysed,
  };
}

/**
 * Contract the Cesium-side profiler satisfies.
 *
 * Sample positions are the profiler's business, not the caller's: spacing
 * varies along the path (see `profilePlan`), so a caller can cap the budget
 * but cannot name one spacing. `maxSamples` bounds the cost of a single
 * request; rejecting superseded results is the profiler's own concern, as it
 * already is for `TerrainSampler`.
 */
export interface TerrainProfiler {
  profile(
    from: LatLng,
    to: LatLng,
    options?: { maxSamples?: number },
  ): Promise<TerrainProfile>;
}
