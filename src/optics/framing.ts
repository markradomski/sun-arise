import type { GeoPosition } from "../scene/types";
import {
  cameraElevationMeters,
  LENS_PRESETS,
  type InstallationCamera,
} from "./camera";
import {
  curvatureDropMeters,
  DEFAULT_REFRACTION_K,
  inverseGeodesic,
} from "./geodesy";
import type { EnuOffset } from "./frustum";
import {
  frameWidthMeters,
  metersPerPixel,
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
  distanceMeters: number;
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
 * The vertical carries the same curvature and refraction correction the
 * terrain sight line uses, so the camera is aimed along the path light
 * actually takes rather than along a straight line through the Earth.
 */
export function targetOffset(
  camera: InstallationCamera,
  target: { ground: GeoPosition; heightMeters: number },
  refractionK = DEFAULT_REFRACTION_K,
): { offset: EnuOffset; distanceMeters: number; bearingDeg: number } {
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(
    camera.ground,
    target.ground,
  );
  const rad = (initialBearingDeg * Math.PI) / 180;
  const rise =
    target.ground.height +
    target.heightMeters -
    curvatureDropMeters(distanceMeters, refractionK) -
    cameraElevationMeters(camera);

  return {
    offset: {
      east: distanceMeters * Math.sin(rad),
      north: distanceMeters * Math.cos(rad),
      up: rise,
    },
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

  return {
    distanceMeters,
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
  /** Ground width the frame spans at the target. */
  frameWidthMeters: number;
  /** Pixel width of the reference object at this lens. */
  objectWidthPixels: number;
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
  const { distanceMeters } = targetOffset(camera, target);

  return LENS_PRESETS.map((preset) => {
    const framing = frameTarget(
      camera,
      target,
      resolutionId,
      reference,
      preset.horizontalFovDeg,
    );
    return {
      presetId: preset.id,
      label: preset.label,
      horizontalFovDeg: preset.horizontalFovDeg,
      verticalFovDeg: framing.verticalFovDeg,
      frameWidthMeters: frameWidthMeters(preset.horizontalFovDeg, distanceMeters),
      objectWidthPixels: framing.size.widthPixels,
      metersPerPixel: metersPerPixel(
        imagingSetup(camera, resolutionId, preset.horizontalFovDeg),
        distanceMeters,
      ),
      inFrame: framing.image.inFrame,
      active: Math.abs(preset.horizontalFovDeg - camera.horizontalFovDeg) < 0.5,
    };
  });
}
