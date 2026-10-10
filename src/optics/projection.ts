import { cameraBasis, dot, type EnuOffset } from "./frustum";
import { clamp, MAX_TILT_DEG, MIN_TILT_DEG, verticalFovDeg } from "./camera";
import {
  curvatureDropMeters,
  DEFAULT_REFRACTION_K,
  inverseGeodesic,
} from "./geodesy";
import type { LatLng } from "../scene/geo";

/**
 * What the planned camera would put on its sensor.
 *
 * An **ideal pinhole, rectilinear projection**: straight lines stay straight,
 * every pixel subtends the same area on a flat image plane, and nothing is
 * lost on the way in. Real optics are not this. There is no lens distortion
 * here, no diffraction, no defocus, no atmospheric haze or turbulence, no
 * motion blur, no sensor noise and no video compression.
 *
 * Everything below is therefore an answer to "how many pixels does this
 * subtend", which is a geometry question, and never to "would you be able to
 * tell what it is", which is not. A feature a handful of pixels wide is at
 * the limit of the geometry before any of the real losses are counted.
 */

const DEG = Math.PI / 180;

/** Output format of the planned camera. Generic, not a product specification. */
export interface OutputResolution {
  id: string;
  label: string;
  widthPixels: number;
  heightPixels: number;
}

/**
 * Common fixed-camera output formats, all 16:9. Named by raster size rather
 * than by any manufacturer's marketing, because that is all that is being
 * assumed: a pixel count, not a lens, sensor or encoder.
 */
export const OUTPUT_RESOLUTIONS: OutputResolution[] = [
  { id: "1080p", label: "1080p", widthPixels: 1920, heightPixels: 1080 },
  { id: "4k", label: "4K UHD · 8MP", widthPixels: 3840, heightPixels: 2160 },
];

export const DEFAULT_RESOLUTION_ID = "4k";

export function outputResolution(id: string): OutputResolution {
  return OUTPUT_RESOLUTIONS.find((r) => r.id === id) ?? OUTPUT_RESOLUTIONS[0];
}

/** Illustrative object sizes, so pixel estimates have something to bite on. */
export interface TargetSizePreset {
  id: string;
  label: string;
  widthMeters: number;
  heightMeters: number;
}

export const TARGET_SIZES: TargetSizePreset[] = [
  { id: "detail", label: "1 m · wave detail", widthMeters: 1, heightMeters: 1 },
  { id: "person", label: "2 m · person", widthMeters: 2, heightMeters: 2 },
  { id: "section", label: "5 m · wave section", widthMeters: 5, heightMeters: 3 },
  { id: "feature", label: "10 m · surf feature", widthMeters: 10, heightMeters: 4 },
];

export const DEFAULT_TARGET_SIZE_ID = "person";

export function targetSize(id: string): TargetSizePreset | undefined {
  return TARGET_SIZES.find((t) => t.id === id);
}

export interface CaptureFormat {
  widthPixels: number;
  heightPixels: number;
}

/** Sensor aspect implied by the output raster, e.g. 1.777… for 16:9. */
export function sensorAspect(format: CaptureFormat): number {
  return format.widthPixels / format.heightPixels;
}

/**
 * Vertical field of view from the horizontal one.
 *
 * Through the tangents, because field of view is not linear in angle: at 110°
 * the naive `hFov / aspect` is wrong by tens of degrees. `camera.verticalFovDeg`
 * is the same calculation and is reused rather than repeated.
 */
export function verticalFovForFormat(
  horizontalFovDeg: number,
  format: CaptureFormat,
): number {
  return verticalFovDeg(horizontalFovDeg, sensorAspect(format));
}

export interface ImagingSetup {
  bearingDeg: number;
  /** Degrees below horizontal, positive down. */
  tiltDeg: number;
  horizontalFovDeg: number;
  format: CaptureFormat;
}

export interface ProjectedPoint {
  /** True when the point falls inside the frame and in front of the lens. */
  inFrame: boolean;
  /** Behind the camera, where a rectilinear projection has no meaning. */
  behind: boolean;
  /** Frame coordinates, -1 to 1, origin at the optical centre, y upwards. */
  x: number;
  y: number;
  /** Pixel coordinates from the top-left of the output image, y downwards. */
  pixelX: number;
  pixelY: number;
  /** Angle between the optical axis and the point, in degrees. */
  angularOffsetDeg: number;
}

/**
 * Projects a direction through the lens.
 *
 * Full perspective division, not a degrees-to-pixels approximation: towards
 * the edge of a wide frame the two disagree substantially, because equal
 * angles do not occupy equal distances on a flat sensor.
 */
export function projectDirection(
  setup: ImagingSetup,
  offset: EnuOffset,
): ProjectedPoint {
  const basis = cameraBasis(setup.bearingDeg, setup.tiltDeg);
  const forward = dot(offset, basis.forward);
  const right = dot(offset, basis.right);
  const up = dot(offset, basis.up);

  const length = Math.hypot(offset.east, offset.north, offset.up);
  const angularOffsetDeg =
    length > 0 ? Math.acos(clampUnit(forward / length)) / DEG : 0;

  const halfWidth = Math.tan((setup.horizontalFovDeg / 2) * DEG);
  const halfHeight = Math.tan(
    (verticalFovForFormat(setup.horizontalFovDeg, setup.format) / 2) * DEG,
  );

  // Behind the lens there is no image position; report the offset angle and
  // stop rather than returning a mirrored point that looks plausible.
  if (forward <= 0 || length === 0) {
    return {
      inFrame: false,
      behind: true,
      x: 0,
      y: 0,
      pixelX: 0,
      pixelY: 0,
      angularOffsetDeg,
    };
  }

  const x = right / forward / halfWidth;
  const y = up / forward / halfHeight;

  return {
    inFrame: Math.abs(x) <= 1 && Math.abs(y) <= 1,
    behind: false,
    x,
    y,
    pixelX: ((x + 1) / 2) * setup.format.widthPixels,
    pixelY: ((1 - y) / 2) * setup.format.heightPixels,
    angularOffsetDeg,
  };
}

export interface ProjectedSize {
  widthPixels: number;
  heightPixels: number;
  /** Ground distance one pixel spans at the target, across the line of sight. */
  metersPerPixel: number;
}

/**
 * Pixel footprint of an object standing at `offset`, facing the camera.
 *
 * The object's edges are projected individually rather than scaled from an
 * on-axis angle, so an object out towards the edge of a wide frame gets the
 * stretching that a flat sensor actually applies to it.
 *
 * The object is treated as a flat billboard parallel to the sensor. A wave
 * face is not, so for a steeply oblique target this reads high by roughly the
 * cosine of the angle between the face and the sensor plane — which is not
 * modelled, because nothing here knows which way a wave is turned.
 */
export function projectObjectSize(
  setup: ImagingSetup,
  offset: EnuOffset,
  widthMeters: number,
  heightMeters: number,
): ProjectedSize {
  const basis = cameraBasis(setup.bearingDeg, setup.tiltDeg);
  const distance = Math.hypot(offset.east, offset.north, offset.up);

  const shift = (vector: EnuOffset, metres: number): EnuOffset => ({
    east: offset.east + vector.east * metres,
    north: offset.north + vector.north * metres,
    up: offset.up + vector.up * metres,
  });

  const left = projectDirection(setup, shift(basis.right, -widthMeters / 2));
  const right = projectDirection(setup, shift(basis.right, widthMeters / 2));
  const bottom = projectDirection(setup, shift(basis.up, -heightMeters / 2));
  const top = projectDirection(setup, shift(basis.up, heightMeters / 2));

  const usable = !left.behind && !right.behind && !top.behind && !bottom.behind;

  return {
    widthPixels: usable ? Math.abs(right.pixelX - left.pixelX) : 0,
    heightPixels: usable ? Math.abs(bottom.pixelY - top.pixelY) : 0,
    metersPerPixel: metersPerPixel(setup, distance),
  };
}

/**
 * Ground sampling distance across the line of sight, on the optical axis.
 *
 * The width of one pixel's footprint at that range. It is a sampling figure,
 * not a resolving figure: two features one pixel apart are not two features
 * you can tell apart.
 */
export function metersPerPixel(setup: ImagingSetup, distanceMeters: number): number {
  if (distanceMeters <= 0) return 0;
  const focalPixels =
    setup.format.widthPixels / 2 / Math.tan((setup.horizontalFovDeg / 2) * DEG);
  return distanceMeters / focalPixels;
}

/**
 * Ground width the frame spans at a given range, across the line of sight.
 *
 * How much of the bay a lens takes in at the target: the figure that says
 * whether a framing holds the whole break or a slice of it.
 */
export function frameWidthMeters(
  horizontalFovDeg: number,
  distanceMeters: number,
): number {
  if (distanceMeters <= 0) return 0;
  return 2 * distanceMeters * Math.tan((horizontalFovDeg / 2) * DEG);
}

export interface AimAtTarget {
  bearingDeg: number;
  tiltDeg: number;
  /** The tilt the geometry asked for, before the mount's limits were applied. */
  requestedTiltDeg: number;
  /** True when the mount cannot physically reach the required tilt. */
  clamped: boolean;
}

export interface AimEndpoint {
  position: LatLng;
  /** Absolute elevation, same datum at both ends. */
  elevationMeters: number;
}

/**
 * Where to point the camera to put a target on the optical axis.
 *
 * The elevation angle carries the same curvature and refraction correction as
 * the terrain sight line, because both answer the same physical question:
 * light from the target arrives along the refracted path, so that is the
 * direction the lens must face. The two differ only in what they are for —
 * this aims the camera, the sight line decides whether the ground is in the
 * way — and both are geometry over a bare-earth model, not a promise of a view.
 */
export function aimAtTarget(
  camera: AimEndpoint,
  target: AimEndpoint,
  options: { refractionK?: number; currentBearingDeg?: number } = {},
): AimAtTarget {
  const refractionK = options.refractionK ?? DEFAULT_REFRACTION_K;
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(
    camera.position,
    target.position,
  );

  const rise =
    target.elevationMeters -
    curvatureDropMeters(distanceMeters, refractionK) -
    camera.elevationMeters;

  // Directly above or below: the bearing is undefined, so the camera keeps
  // the one it has and only the tilt moves.
  const bearingDeg =
    distanceMeters > 0 ? initialBearingDeg : (options.currentBearingDeg ?? 0);

  const requestedTiltDeg =
    distanceMeters > 0
      ? Math.atan2(-rise, distanceMeters) / DEG
      : rise < 0
        ? MAX_TILT_DEG
        : MIN_TILT_DEG;

  const tiltDeg = clamp(requestedTiltDeg, MIN_TILT_DEG, MAX_TILT_DEG);

  return {
    bearingDeg,
    tiltDeg,
    requestedTiltDeg,
    clamped: Math.abs(tiltDeg - requestedTiltDeg) > 1e-9,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
