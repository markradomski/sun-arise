import type { LatLng } from "../scene/geo";
import {
  curvatureDropMeters,
  DEFAULT_REFRACTION_K,
  inverseGeodesic,
} from "./geodesy";
import { lineOfSight, type LineOfSightResult, type TerrainProfile } from "./lineOfSight";
import { MIN_PATH_METERS } from "./profilePlan";

/**
 * The single sight-line verdict.
 *
 * Everything the user is shown — the classification, the numbers and the
 * profile chart — comes out of one call to `analyseSightLine`. Nothing
 * downstream recomputes geometry, so the chart cannot disagree with the
 * verdict printed next to it.
 *
 * ## What the classification means
 *
 * It is a statement about **sampled bare-earth terrain** and nothing else.
 * Cesium World Terrain carries no vegetation, buildings, fences, masts or
 * vehicles, and this models no wave height, haze, lens resolution or sea
 * state. A clear result says the ground does not get in the way; it does not
 * say anything is visible.
 */

export type VisibilityClass = "CLEAR" | "OBSTRUCTED" | "INDETERMINATE";

export type IndeterminateReason =
  | "NO_PROFILE"
  | "PATH_TOO_SHORT"
  | "INSUFFICIENT_SAMPLES"
  | "MISSING_TERRAIN";

/**
 * Clearance below which terrain sampling resolution could plausibly flip the
 * answer. Cesium World Terrain is roughly 10 m posted at best, interpolated
 * between posts, so a metre of headroom is not a margin worth trusting.
 */
export const MARGINAL_CLEARANCE_METERS = 2;

/** Interior samples below which a verdict is not worth stating. */
const MIN_MEASURED_SAMPLES = 3;

/**
 * Share of the path, measured back from the target, within which a low
 * clearance is attributed to the approach rather than to an obstruction.
 */
const GRAZE_FRACTION = 0.1;

export interface SightLineEndpoint {
  position: LatLng;
  /** Sampled terrain elevation, ellipsoidal, same datum throughout. */
  terrainElevationMeters: number;
  /** Metres above that terrain: the mast for a camera, the wave for a target. */
  heightMeters: number;
}

export interface SightLineAnalysis {
  classification: VisibilityClass;
  /** Set only when the classification is INDETERMINATE. */
  reason?: IndeterminateReason;
  /** Geodesic surface distance, camera to target. */
  distanceMeters: number;
  /** Degrees clockwise from true north, leaving the camera. */
  initialBearingDeg: number;
  /**
   * Degrees from horizontal at the camera eye to the target, curvature
   * corrected. Negative looking down, matching the sign of nothing else in
   * the camera model — `tiltDeg` is positive downwards, so a target at −3°
   * corresponds to a tilt of 3°.
   */
  targetElevationAngleDeg: number;
  /** Absolute elevation of the lens. */
  observerElevationMeters: number;
  /** Absolute elevation of the target point. */
  targetElevationMeters: number;
  /**
   * True when terrain came closer to the line than
   * `MARGINAL_CLEARANCE_METERS` somewhere it could plausibly have blocked it,
   * so the result should not be read as certain. A grazing approach does not
   * count; see `grazingApproach`.
   */
  marginal: boolean;
  /**
   * True when the smallest clearance is simply the line arriving at a target
   * that sits on the surface.
   *
   * A target at zero height is a point on the ground, so the sight line
   * descends to meet the ground and the last stretch always reads near zero.
   * That is the geometry of looking at the surface, not an obstruction, and
   * reporting it as a near miss would fire on every sea-level target. The
   * clearance figure is still reported as measured; this only says how to
   * read it.
   */
  grazingApproach: boolean;
  refractionK: number;
  lineOfSight: LineOfSightResult;
  profile: TerrainProfile;
}

export interface SightLineOptions {
  refractionK?: number;
}

/**
 * Classifies an already-sampled profile between a camera and a target.
 *
 * Asymmetric about missing data, deliberately. A profile with gaps that still
 * found terrain through the line is reported OBSTRUCTED: the obstruction was
 * measured and the gaps cannot unfind it. A profile with gaps that found
 * nothing is INDETERMINATE rather than clear, because the gap is exactly where
 * an obstruction would hide. Unavailable terrain is never treated as flat.
 */
export function analyseSightLine(
  profile: TerrainProfile,
  camera: SightLineEndpoint,
  target: SightLineEndpoint,
  options: SightLineOptions = {},
): SightLineAnalysis {
  const refractionK = options.refractionK ?? DEFAULT_REFRACTION_K;
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(
    camera.position,
    target.position,
  );

  const observerElevationMeters = camera.terrainElevationMeters + camera.heightMeters;
  const targetElevationMeters = target.terrainElevationMeters + target.heightMeters;

  const result = lineOfSight(profile, {
    observerElevationMeters,
    targetElevationMeters,
    refractionK,
  });

  // The target falls away with the curve just as terrain does, so the angle
  // the camera must be aimed at is measured against the apparent target.
  const apparentTarget =
    targetElevationMeters - curvatureDropMeters(distanceMeters, refractionK);
  const targetElevationAngleDeg =
    distanceMeters > 0
      ? Math.atan2(apparentTarget - observerElevationMeters, distanceMeters) *
        (180 / Math.PI)
      : 0;

  const base = {
    distanceMeters,
    initialBearingDeg,
    targetElevationAngleDeg,
    observerElevationMeters,
    targetElevationMeters,
    refractionK,
    lineOfSight: result,
    profile,
  };

  const reason = indeterminateReason(profile, result, distanceMeters);
  if (reason && !(reason === "MISSING_TERRAIN" && result.blockedAtMeters !== null)) {
    return {
      ...base,
      classification: "INDETERMINATE",
      reason,
      marginal: false,
      grazingApproach: false,
    };
  }

  // The line closes on the surface at the end whenever the target lies on it,
  // whichever side of the line the last samples happen to fall.
  const grazingApproach =
    target.heightMeters < MARGINAL_CLEARANCE_METERS &&
    distanceMeters > 0 &&
    result.minimumClearanceAtMeters > distanceMeters * (1 - GRAZE_FRACTION);

  const blocked = result.blockedAtMeters !== null;

  // Sub-resolution either way. A clear grazing approach is the one case that
  // is explained rather than uncertain; an obstruction measured at a tenth of
  // a metre is not, however it arose.
  const marginal =
    Math.abs(result.minimumClearanceMeters) < MARGINAL_CLEARANCE_METERS &&
    !(!blocked && grazingApproach);

  return {
    ...base,
    classification: blocked ? "OBSTRUCTED" : "CLEAR",
    grazingApproach,
    marginal,
  };
}

function indeterminateReason(
  profile: TerrainProfile,
  result: LineOfSightResult,
  distanceMeters: number,
): IndeterminateReason | undefined {
  if (profile.samples.length === 0) return "NO_PROFILE";
  if (distanceMeters < MIN_PATH_METERS) return "PATH_TOO_SHORT";
  if (result.measuredCount < MIN_MEASURED_SAMPLES) return "INSUFFICIENT_SAMPLES";
  if (result.incomplete) return "MISSING_TERRAIN";
  return undefined;
}

export function classificationLabel(analysis: SightLineAnalysis): string {
  switch (analysis.classification) {
    case "CLEAR":
      return "Sampled terrain clear";
    case "OBSTRUCTED":
      return "Terrain obstructed";
    case "INDETERMINATE":
      return "Indeterminate";
  }
}

export function indeterminateExplanation(reason: IndeterminateReason): string {
  switch (reason) {
    case "NO_PROFILE":
      return "No terrain was sampled along this path.";
    case "PATH_TOO_SHORT":
      return `The target is closer than ${MIN_PATH_METERS} m, which is within terrain sampling resolution of the camera.`;
    case "INSUFFICIENT_SAMPLES":
      return "Too few points between the camera and the target carried an elevation.";
    case "MISSING_TERRAIN":
      return "Terrain was missing at some points, and an obstruction could be hiding in the gap.";
  }
}
