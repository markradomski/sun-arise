import { describe, expect, it } from "vitest";
import {
  bearingOf,
  frustumGeometry,
  tiltOf,
  type EnuOffset,
  type FrustumAim,
} from "./frustum";
import { verticalFovDeg } from "./camera";

const RANGE = 400;

function aim(bearingDeg: number, tiltDeg = 0, horizontalFovDeg = 54): FrustumAim {
  return {
    bearingDeg,
    tiltDeg,
    horizontalFovDeg,
    verticalFovDeg: verticalFovDeg(horizontalFovDeg),
  };
}

function length(offset: EnuOffset): number {
  return Math.hypot(offset.east, offset.north, offset.up);
}

/** Angle between two offsets, in degrees. */
function angleBetween(a: EnuOffset, b: EnuOffset): number {
  const dot = a.east * b.east + a.north * b.north + a.up * b.up;
  const cosine = Math.min(1, Math.max(-1, dot / (length(a) * length(b))));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * `acos` is ill-conditioned near 1, so two genuinely parallel vectors come
 * back a millionth of a degree apart. That is noise, not misalignment.
 */
function expectParallel(a: EnuOffset, b: EnuOffset) {
  expect(angleBetween(a, b)).toBeLessThan(1e-4);
}

function midpoint(a: EnuOffset, b: EnuOffset): EnuOffset {
  return {
    east: (a.east + b.east) / 2,
    north: (a.north + b.north) / 2,
    up: (a.up + b.up) / 2,
  };
}

/**
 * Field of view is the angle across the middle of a face, not corner to
 * corner: the diagonal of a rectangular pyramid is wider horizontally and
 * narrower vertically than the edges it spans.
 */
function faceAngles(geometry: ReturnType<typeof frustumGeometry>) {
  const [topLeft, topRight, bottomRight, bottomLeft] = geometry.corners;
  return {
    horizontal: angleBetween(
      midpoint(topLeft, bottomLeft),
      midpoint(topRight, bottomRight),
    ),
    vertical: angleBetween(
      midpoint(topLeft, topRight),
      midpoint(bottomLeft, bottomRight),
    ),
  };
}

describe("frustum axis", () => {
  it("points north at bearing 0, not east", () => {
    // The shipped bug: the drawn frustum sat 90° clockwise of the camera's
    // bearing, because Cesium's heading/pitch/roll frame is built on
    // east-north-up and its local +X axis is east at zero heading.
    const { axis } = frustumGeometry(aim(0), RANGE);
    expect(axis.north).toBeCloseTo(1, 9);
    expect(axis.east).toBeCloseTo(0, 9);
    expect(bearingOf(axis)).toBeCloseTo(0, 6);
  });

  it("follows the bearing at every cardinal and intermediate heading", () => {
    for (const bearing of [0, 30, 45, 90, 135, 180, 225, 270, 315, 359]) {
      expect(bearingOf(frustumGeometry(aim(bearing), RANGE).axis)).toBeCloseTo(
        bearing,
        6,
      );
    }
  });

  it("carries the tilt downwards without disturbing the bearing", () => {
    for (const tilt of [0, 6, 20, 45, 80]) {
      const { axis } = frustumGeometry(aim(137, tilt), RANGE);
      expect(tiltOf(axis)).toBeCloseTo(tilt, 6);
      expect(bearingOf(axis)).toBeCloseTo(137, 6);
    }
  });

  it("looks straight down at 90 degrees of tilt", () => {
    const { axis } = frustumGeometry(aim(0, 90), RANGE);
    expect(axis.up).toBeCloseTo(-1, 9);
    expect(Math.hypot(axis.east, axis.north)).toBeCloseTo(0, 9);
  });

  it("puts the far-face centre down the axis at the draw range", () => {
    const { centre, axis } = frustumGeometry(aim(212, 11), RANGE);
    expect(length(centre)).toBeCloseTo(RANGE, 6);
    expectParallel(centre, axis);
  });
});

describe("frustum corners", () => {
  it("are symmetric about the axis for a symmetric lens", () => {
    const { corners, axis } = frustumGeometry(aim(0, 6), RANGE);
    const angles = corners.map((corner) => angleBetween(corner, axis));
    for (const angle of angles) expect(angle).toBeCloseTo(angles[0], 9);

    // Opposite corners average back onto the axis.
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    expectParallel(midpoint(topLeft, bottomRight), axis);
    expectParallel(midpoint(topRight, bottomLeft), axis);
  });

  it("spans the horizontal field of view", () => {
    for (const horizontalFovDeg of [10, 54, 84, 110]) {
      const geometry = frustumGeometry(aim(0, 0, horizontalFovDeg), RANGE);
      expect(faceAngles(geometry).horizontal).toBeCloseTo(horizontalFovDeg, 6);
    }
  });

  it("spans the vertical field of view implied by the lens at 16:9", () => {
    for (const horizontalFovDeg of [10, 54, 84, 110]) {
      const geometry = frustumGeometry(aim(0, 0, horizontalFovDeg), RANGE);
      expect(faceAngles(geometry).vertical).toBeCloseTo(
        verticalFovDeg(horizontalFovDeg),
        6,
      );
    }
  });

  it("keeps the field of view intact when the camera is tilted and turned", () => {
    const geometry = frustumGeometry(aim(214, 37, 84), RANGE);
    const angles = faceAngles(geometry);
    expect(angles.horizontal).toBeCloseTo(84, 6);
    expect(angles.vertical).toBeCloseTo(verticalFovDeg(84), 6);
  });

  it("widens with the lens and narrows with it", () => {
    const narrow = faceAngles(frustumGeometry(aim(0, 0, 10), RANGE));
    const wide = faceAngles(frustumGeometry(aim(0, 0, 110), RANGE));
    expect(wide.horizontal).toBeGreaterThan(narrow.horizontal);
    expect(narrow.horizontal).toBeCloseTo(10, 6);
    expect(wide.horizontal).toBeCloseTo(110, 6);
  });

  it("rotates rigidly with bearing, keeping its shape", () => {
    const base = frustumGeometry(aim(0, 6), RANGE);
    const turned = frustumGeometry(aim(90, 6), RANGE);
    for (let i = 0; i < 4; i += 1) {
      expect(length(turned.corners[i])).toBeCloseTo(length(base.corners[i]), 6);
      expect(angleBetween(turned.corners[i], turned.axis)).toBeCloseTo(
        angleBetween(base.corners[i], base.axis),
        6,
      );
    }
  });

  it("keeps the top above the bottom when the camera is tilted down", () => {
    const { corners } = frustumGeometry(aim(0, 30), RANGE);
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    expect(topLeft.up).toBeGreaterThan(bottomLeft.up);
    expect(topRight.up).toBeGreaterThan(bottomRight.up);
  });

  it("puts the right-hand corners east when looking north", () => {
    // Right of the view, not left: the mirror would be invisible on a
    // symmetric lens but wrong the moment anything asymmetric is drawn.
    const { corners } = frustumGeometry(aim(0, 0), RANGE);
    const [topLeft, topRight] = corners;
    expect(topRight.east).toBeGreaterThan(0);
    expect(topLeft.east).toBeLessThan(0);
  });

  it("puts the right-hand corners south when looking east", () => {
    const { corners } = frustumGeometry(aim(90, 0), RANGE);
    const [topLeft, topRight] = corners;
    expect(topRight.north).toBeLessThan(0);
    expect(topLeft.north).toBeGreaterThan(0);
  });
});

describe("frustum against the viewfinder", () => {
  it("agrees with the aim the look-through view is given", () => {
    // Look-through hands Cesium's camera the bearing as heading and the tilt
    // as a negated pitch. The drawn frustum must resolve to the same aim.
    for (const bearing of [0, 90, 180, 270, 37]) {
      for (const tilt of [0, 6, 25]) {
        const { axis } = frustumGeometry(aim(bearing, tilt), RANGE);
        expect(bearingOf(axis)).toBeCloseTo(bearing, 6);
        expect(-tiltOf(axis)).toBeCloseTo(-tilt, 6);
      }
    }
  });
});
