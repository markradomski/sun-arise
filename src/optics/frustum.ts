import { orientationVector } from "./camera";

/**
 * Field-of-view geometry in local east-north-up metres.
 *
 * Kept out of the renderer, and expressed in ENU rather than in a Cesium
 * heading/pitch/roll frame, because that frame is the trap here:
 * `Transforms.headingPitchRollToFixedFrame` builds on **east**-north-up, so
 * at zero heading its local +X axis points east, not along the view. Anything
 * treating that axis as "forward" is rotated 90° from the camera's bearing,
 * while tilt still looks right — which is exactly how the bug hid.
 *
 * Working in ENU removes the ambiguity: east, north and up mean one thing,
 * `orientationVector` already maps bearing and tilt into them, and the result
 * is testable without a Viewer.
 */

export interface EnuOffset {
  /** Metres east of the apex. */
  east: number;
  /** Metres north of the apex. */
  north: number;
  /** Metres above the apex. */
  up: number;
}

export interface FrustumAim {
  bearingDeg: number;
  /** Degrees below horizontal, positive down. */
  tiltDeg: number;
  horizontalFovDeg: number;
  verticalFovDeg: number;
}

export interface FrustumGeometry {
  /** Unit vector down the view axis. */
  axis: EnuOffset;
  /** Centre of the far face, relative to the apex. */
  centre: EnuOffset;
  /** Far-face corners relative to the apex: top-left, top-right, bottom-right, bottom-left. */
  corners: [EnuOffset, EnuOffset, EnuOffset, EnuOffset];
}

const DEG = Math.PI / 180;

/**
 * Right-hand direction in plan view, 90° clockwise of the bearing.
 *
 * Taken from the bearing rather than from a cross product with the vertical,
 * so it stays well defined when the camera looks straight down and the view
 * axis is parallel to up.
 */
function rightVector(bearingDeg: number): EnuOffset {
  const bearing = bearingDeg * DEG;
  return { east: Math.cos(bearing), north: -Math.sin(bearing), up: 0 };
}

function cross(a: EnuOffset, b: EnuOffset): EnuOffset {
  return {
    east: a.north * b.up - a.up * b.north,
    north: a.up * b.east - a.east * b.up,
    up: a.east * b.north - a.north * b.east,
  };
}

function combine(
  parts: { vector: EnuOffset; scale: number }[],
): EnuOffset {
  return parts.reduce<EnuOffset>(
    (sum, { vector, scale }) => ({
      east: sum.east + vector.east * scale,
      north: sum.north + vector.north * scale,
      up: sum.up + vector.up * scale,
    }),
    { east: 0, north: 0, up: 0 },
  );
}

/**
 * The view pyramid at a given draw range, as offsets from the lens.
 *
 * A symmetric lens gives corners symmetric about the axis, so the drawn shape
 * and the view it stands for point the same way at every bearing.
 */
export function frustumGeometry(
  aim: FrustumAim,
  rangeMeters: number,
): FrustumGeometry {
  const axis = orientationVector(aim.bearingDeg, aim.tiltDeg);
  const right = rightVector(aim.bearingDeg);
  // Completes a right-handed set, so it tilts with the camera rather than
  // staying vertical.
  const up = cross(right, axis);

  const spreadRight = Math.tan((aim.horizontalFovDeg / 2) * DEG) * rangeMeters;
  const spreadUp = Math.tan((aim.verticalFovDeg / 2) * DEG) * rangeMeters;

  const centre = combine([{ vector: axis, scale: rangeMeters }]);
  const corner = (horizontal: number, vertical: number) =>
    combine([
      { vector: axis, scale: rangeMeters },
      { vector: right, scale: horizontal * spreadRight },
      { vector: up, scale: vertical * spreadUp },
    ]);

  return {
    axis,
    centre,
    corners: [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)],
  };
}

/** Compass bearing of an ENU offset, for tests and diagnostics. */
export function bearingOf(offset: EnuOffset): number {
  const bearing = Math.atan2(offset.east, offset.north) / DEG;
  return (bearing + 360) % 360;
}

/** Degrees below horizontal of an ENU offset, positive downwards. */
export function tiltOf(offset: EnuOffset): number {
  const horizontal = Math.hypot(offset.east, offset.north);
  return Math.atan2(-offset.up, horizontal) / DEG;
}
