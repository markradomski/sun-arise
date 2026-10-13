import type { GeoPosition } from "../scene/types";
import {
  cameraElevationMeters,
  LENS_PRESETS,
  type InstallationCamera,
} from "./camera";
import {
  curvatureDropMeters,
  GEOMETRIC_REFRACTION_K,
  geodeticEnuOffset,
  inverseGeodesic,
} from "./geodesy";
import type { EnuOffset } from "./frustum";
import {
  frameHeightMeters,
  frameWidthMeters,
  outputResolution,
  projectDirection,
  projectObjectSize,
  verticalFovForFormat,
  type ImagingSetup,
  type ProjectedPoint,
  type ProjectedSize,
} from "./projection";

/**
 * One framing answer for a camera and a target, shared by everything that
 * shows it.
 *
 * The panel readout, the viewfinder overlay and the lens comparison all read
 * this, so the number beside the preview is the number the preview was built
 * from. Nothing downstream repeats the geometry.
 */

export interface Framing {
  /** Geodesic distance over the ground, camera mount to target. */
  distanceMeters: number;
  /**
   * Straight-line distance from the lens to the target.
   *
   * This, not the ground distance, is what the optics see: frame coverage and
   * ground sampling are measured across the line of sight. At a surf camera's
   * geometry the two differ by a fraction of a percent, but they are different
   * quantities and mixing them put two different numbers under one label.
   */
  slantRangeMeters: number;
  bearingDeg: number;
  /** Angle between the optical axis and the target. */
  angularOffsetDeg: number;
  horizontalFovDeg: number;
  verticalFovDeg: number;
  /** Where the target lands on the sensor. */
  image: ProjectedPoint;
  /** Pixel footprint of the reference object at the target. */
  size: ProjectedSize;
  widthPixels: number;
  heightPixels: number;
}

export interface ReferenceObject {
  widthMeters: number;
  heightMeters: number;
}

/**
 * Offset from the lens to the target, in local east-north-up metres.
 *
 * Default is the **geometric** ECEF chord — the same straight line the
 * renderer draws — so the viewfinder marker lands on the rendered target.
 * Terrain line-of-sight analysis applies curvature and refraction separately
 * (`DEFAULT_REFRACTION_K` in `sightLine`); do not feed that coefficient in
 * here unless you are deliberately comparing the two models.
 */
export function targetOffset(
  camera: InstallationCamera,
  target: { ground: GeoPosition; heightMeters: number },
  refractionK = GEOMETRIC_REFRACTION_K,
): { offset: EnuOffset; distanceMeters: number; bearingDeg: number } {
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(
    camera.ground,
    target.ground,
  );
  const offset = geodeticEnuOffset(
    {
      latitude: camera.ground.latitude,
      longitude: camera.ground.longitude,
      heightMeters: cameraElevationMeters(camera),
    },
    {
      latitude: target.ground.latitude,
      longitude: target.ground.longitude,
      heightMeters: target.ground.height + target.heightMeters,
    },
  );
  if (refractionK !== GEOMETRIC_REFRACTION_K) {
    offset.up +=
      curvatureDropMeters(distanceMeters, GEOMETRIC_REFRACTION_K) -
      curvatureDropMeters(distanceMeters, refractionK);
  }

  return {
    offset,
    distanceMeters,
    bearingDeg: initialBearingDeg,
  };
}

export function imagingSetup(
  camera: InstallationCamera,
  resolutionId: string,
  horizontalFovDeg = camera.horizontalFovDeg,
): ImagingSetup {
  const format = outputResolution(resolutionId);
  return {
    bearingDeg: camera.bearingDeg,
    tiltDeg: camera.tiltDeg,
    horizontalFovDeg,
    format,
  };
}

export function frameTarget(
  camera: InstallationCamera,
  target: { ground: GeoPosition; heightMeters: number },
  resolutionId: string,
  reference: ReferenceObject,
  horizontalFovDeg = camera.horizontalFovDeg,
): Framing {
  const setup = imagingSetup(camera, resolutionId, horizontalFovDeg);
  const { offset, distanceMeters, bearingDeg } = targetOffset(camera, target);
  const image = projectDirection(setup, offset);
  const slantRangeMeters = Math.hypot(offset.east, offset.north, offset.up);

  return {
    distanceMeters,
    slantRangeMeters,
    bearingDeg,
    angularOffsetDeg: image.angularOffsetDeg,
    horizontalFovDeg,
    verticalFovDeg: verticalFovForFormat(horizontalFovDeg, setup.format),
    image,
    size: projectObjectSize(
      setup,
      offset,
      reference.widthMeters,
      reference.heightMeters,
    ),
    widthPixels: setup.format.widthPixels,
    heightPixels: setup.format.heightPixels,
  };
}

export interface LensComparisonRow {
  presetId: string;
  label: string;
  horizontalFovDeg: number;
  verticalFovDeg: number;
  /** Width the frame spans across the line of sight at the target. */
  frameWidthMeters: number;
  /** Height the frame spans at the target. */
  frameHeightMeters: number;
  /** Pixel width of the reference object at this lens. */
  objectWidthPixels: number;
  /**
   * Pixel height of the reference object. For an upright reference such as a
   * person this is the dimension that matters, and it is not the width.
   */
  objectHeightPixels: number;
  metersPerPixel: number;
  /**
   * Whether the target falls inside this framing. Geometry only: terrain can
   * still stand in the way, and that verdict is the same for every lens.
   */
  inFrame: boolean;
  /** True when this row matches the camera's current field of view. */
  active: boolean;
}

/**
 * The same framing calculation run across every preset, so the trade between
 * a wide view and a usable number of pixels is visible in one place.
 */
export function compareLenses(
  camera: InstallationCamera,
  target: { ground: GeoPosition; heightMeters: number },
  resolutionId: string,
  reference: ReferenceObject,
): LensComparisonRow[] {
  return LENS_PRESETS.map((preset) => {
    const framing = frameTarget(
      camera,
      target,
      resolutionId,
      reference,
      preset.horizontalFovDeg,
    );
    // Coverage and sampling are measured along the line of sight, and come
    // from the same framing the pixel figures do, so one row cannot carry two
    // distances or two sampling numbers.
    const range = framing.slantRangeMeters;
    return {
      presetId: preset.id,
      label: preset.label,
      horizontalFovDeg: preset.horizontalFovDeg,
      verticalFovDeg: framing.verticalFovDeg,
      frameWidthMeters: frameWidthMeters(preset.horizontalFovDeg, range),
      frameHeightMeters: frameHeightMeters(framing.verticalFovDeg, range),
      objectWidthPixels: framing.size.widthPixels,
      objectHeightPixels: framing.size.heightPixels,
      metersPerPixel: framing.size.metersPerPixel,
      inFrame: framing.image.inFrame,
      active: Math.abs(preset.horizontalFovDeg - camera.horizontalFovDeg) < 0.5,
    };
  });
}
