import type { GeoPosition } from "../scene/types";
import { normaliseBearing } from "./geodesy";

/**
 * The virtual installation camera.
 *
 * This is the camera being *designed* — a device on a mast or a roof. It is
 * never the Cesium navigation camera, which belongs to the user and keeps
 * working independently.
 *
 * Conventions, fixed here so nothing downstream has to guess:
 *
 * - `bearingDeg` is clockwise from **true north**, 0 to 360.
 * - `tiltDeg` is **below horizontal and positive downwards**. 0 is level, 90
 *   is straight down. This is how an installer describes a mount, and it is
 *   the opposite sign to Cesium's pitch, which is negative downwards. The
 *   conversion lives in `cesiumPitchDeg` so the sign flip happens once.
 * - `mountHeightMeters` is **above the sampled terrain at the mount point**,
 *   not above the ellipsoid and not above mean sea level. The absolute height
 *   is derived, never stored, so it stays correct when terrain resamples.
 */

export interface InstallationCamera {
  id: string;
  label: string;
  /** Mount point on the ground. `height` is the sampled terrain elevation. */
  ground: GeoPosition;
  /** Metres above the terrain at `ground`. */
  mountHeightMeters: number;
  bearingDeg: number;
  /** Degrees below horizontal, positive down. */
  tiltDeg: number;
  horizontalFovDeg: number;
}

export interface LensPreset {
  id: string;
  label: string;
  horizontalFovDeg: number;
  /** Indicative 35mm-equivalent focal length, for recognisability only. */
  focalLength35mm: number;
}

export const MIN_MOUNT_HEIGHT_METERS = 0;
export const MAX_MOUNT_HEIGHT_METERS = 30;
export const MIN_TILT_DEG = 0;
export const MAX_TILT_DEG = 90;
export const MIN_HFOV_DEG = 5;
export const MAX_HFOV_DEG = 120;

/** 16:9, the usual sensor shape for a fixed surveillance or action camera. */
export const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * Illustrative only. Real products vary and these are not a specification;
 * they exist so the FOV slider has recognisable anchor points.
 */
export const LENS_PRESETS: LensPreset[] = [
  { id: "ultra-wide", label: "Ultra wide", horizontalFovDeg: 110, focalLength35mm: 14 },
  { id: "wide", label: "Wide", horizontalFovDeg: 84, focalLength35mm: 24 },
  { id: "standard", label: "Standard", horizontalFovDeg: 54, focalLength35mm: 35 },
  { id: "tele", label: "Tele", horizontalFovDeg: 23, focalLength35mm: 85 },
  { id: "super-tele", label: "Super tele", horizontalFovDeg: 10, focalLength35mm: 200 },
];

export const DEFAULT_CAMERA: Omit<InstallationCamera, "id" | "ground"> = {
  label: "Camera 1",
  mountHeightMeters: 6,
  bearingDeg: 0,
  tiltDeg: 10,
  horizontalFovDeg: 54,
};

/** Absolute height of the lens: sampled terrain plus the mast. */
export function cameraElevationMeters(camera: InstallationCamera): number {
  return camera.ground.height + camera.mountHeightMeters;
}

/**
 * Vertical field of view implied by a horizontal one at a given aspect ratio.
 *
 * Done through the tangents rather than by scaling the angle, because field of
 * view is not linear in angle and the small-angle shortcut is visibly wrong by
 * the time a lens is this wide.
 */
export function verticalFovDeg(
  horizontalFovDegrees: number,
  aspectRatio = DEFAULT_ASPECT_RATIO,
): number {
  const halfH = (horizontalFovDegrees / 2) * (Math.PI / 180);
  const halfV = Math.atan(Math.tan(halfH) / aspectRatio);
  return halfV * 2 * (180 / Math.PI);
}

export function horizontalFovDeg(
  verticalFovDegrees: number,
  aspectRatio = DEFAULT_ASPECT_RATIO,
): number {
  const halfV = (verticalFovDegrees / 2) * (Math.PI / 180);
  const halfH = Math.atan(Math.tan(halfV) * aspectRatio);
  return halfH * 2 * (180 / Math.PI);
}

/** Horizontal field of view for a focal length on a given sensor width. */
export function focalLengthToHorizontalFovDeg(
  focalLengthMm: number,
  sensorWidthMm: number,
): number {
  if (focalLengthMm <= 0 || sensorWidthMm <= 0) return 0;
  return 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm)) * (180 / Math.PI);
}

/** The nearest preset to a given field of view, for showing which is active. */
export function nearestLensPreset(horizontalFovDegrees: number): LensPreset {
  return LENS_PRESETS.reduce((best, preset) =>
    Math.abs(preset.horizontalFovDeg - horizontalFovDegrees) <
    Math.abs(best.horizontalFovDeg - horizontalFovDegrees)
      ? preset
      : best,
  );
}

export function lensPreset(id: string): LensPreset | undefined {
  return LENS_PRESETS.find((preset) => preset.id === id);
}

/**
 * Unit direction the camera points, in local east-north-up metres.
 * Tilt is positive downwards here, so `up` is negative when looking down.
 */
export function orientationVector(
  bearingDeg: number,
  tiltDeg: number,
): { east: number; north: number; up: number } {
  const bearing = normaliseBearing(bearingDeg) * (Math.PI / 180);
  const tilt = tiltDeg * (Math.PI / 180);
  const horizontal = Math.cos(tilt);
  return {
    east: horizontal * Math.sin(bearing),
    north: horizontal * Math.cos(bearing),
    up: -Math.sin(tilt),
  };
}

/**
 * Cesium's pitch is negative when looking down; this camera's tilt is positive
 * when looking down. One conversion, in one place.
 */
export function cesiumPitchDeg(tiltDeg: number): number {
  return -tiltDeg;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Brings any partial camera edit back inside the supported ranges. */
export function constrainCamera(camera: InstallationCamera): InstallationCamera {
  return {
    ...camera,
    mountHeightMeters: clamp(
      camera.mountHeightMeters,
      MIN_MOUNT_HEIGHT_METERS,
      MAX_MOUNT_HEIGHT_METERS,
    ),
    bearingDeg: normaliseBearing(camera.bearingDeg),
    tiltDeg: clamp(camera.tiltDeg, MIN_TILT_DEG, MAX_TILT_DEG),
    horizontalFovDeg: clamp(camera.horizontalFovDeg, MIN_HFOV_DEG, MAX_HFOV_DEG),
  };
}

export function createCamera(
  id: string,
  ground: GeoPosition,
  overrides: Partial<InstallationCamera> = {},
): InstallationCamera {
  return constrainCamera({ ...DEFAULT_CAMERA, ...overrides, id, ground });
}
