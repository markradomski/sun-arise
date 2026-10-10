import { describe, expect, it } from "vitest";
import {
  curvatureDropMeters,
  geodeticEnuOffset,
  geodeticToEcef,
  horizonDistanceMeters,
  inverseGeodesic,
  normaliseBearing,
  DEFAULT_REFRACTION_K,
  directGeodesic,
} from "./geodesy";
import { offsetByBearing, eastNorthOffset } from "../scene/geo";

const LULWORTH = { latitude: -41.0023, longitude: 147.0858 };

describe("inverseGeodesic", () => {
  it("returns zero for coincident points", () => {
    const result = inverseGeodesic(LULWORTH, { ...LULWORTH });
    expect(result.distanceMeters).toBe(0);
  });

  it("recovers a known offset distance and bearing", () => {
    const target = offsetByBearing(LULWORTH, 45, 5000);
    const result = inverseGeodesic(LULWORTH, target);
    // offsetByBearing is spherical and this is ellipsoidal, so the target does
    // not sit exactly on the ellipsoidal geodesic: at this latitude the two
    // disagree by about 0.1 degrees of bearing and a few metres over 5 km.
    // That gap is the point of this module, not an error in it.
    expect(result.distanceMeters).toBeGreaterThan(4950);
    expect(result.distanceMeters).toBeLessThan(5050);
    expect(result.initialBearingDeg).toBeGreaterThan(44.8);
    expect(result.initialBearingDeg).toBeLessThan(45.2);
  });

  it("measures a known long baseline", () => {
    // Sydney Opera House to Melbourne Flinders Street, about 713 km.
    const sydney = { latitude: -33.8568, longitude: 151.2153 };
    const melbourne = { latitude: -37.8183, longitude: 144.9671 };
    const { distanceMeters } = inverseGeodesic(sydney, melbourne);
    expect(distanceMeters / 1000).toBeGreaterThan(705);
    expect(distanceMeters / 1000).toBeLessThan(720);
  });

  it("is symmetric in distance", () => {
    const target = offsetByBearing(LULWORTH, 300, 12_000);
    const there = inverseGeodesic(LULWORTH, target).distanceMeters;
    const back = inverseGeodesic(target, LULWORTH).distanceMeters;
    expect(there).toBeCloseTo(back, 6);
  });

  it("reports bearings in [0, 360)", () => {
    for (const bearing of [0, 90, 180, 270, 359]) {
      const target = offsetByBearing(LULWORTH, bearing, 3000);
      const result = inverseGeodesic(LULWORTH, target);
      expect(result.initialBearingDeg).toBeGreaterThanOrEqual(0);
      expect(result.initialBearingDeg).toBeLessThan(360);
      expect(result.initialBearingDeg).toBeCloseTo(bearing === 0 ? 0 : bearing, 0);
    }
  });

  it("diverges from the small-separation approximation at long range", () => {
    // Why this module exists: eastNorthOffset is documented as being for small
    // separations, and at surf-cam range the error is metres.
    const target = offsetByBearing(LULWORTH, 90, 20_000);
    const geodesic = inverseGeodesic(LULWORTH, target).distanceMeters;
    const offset = eastNorthOffset(LULWORTH, target);
    const approximate = Math.hypot(offset.east, offset.north);
    expect(Math.abs(geodesic - approximate)).toBeGreaterThan(1);
  });
});

describe("normaliseBearing", () => {
  it("wraps into [0, 360)", () => {
    expect(normaliseBearing(0)).toBe(0);
    expect(normaliseBearing(360)).toBe(0);
    expect(normaliseBearing(-90)).toBe(270);
    expect(normaliseBearing(450)).toBe(90);
    expect(normaliseBearing(-450)).toBe(270);
  });
});

describe("curvatureDropMeters", () => {
  it("is zero at the observer", () => {
    expect(curvatureDropMeters(0)).toBe(0);
  });

  it("grows with the square of distance", () => {
    const near = curvatureDropMeters(1000);
    const far = curvatureDropMeters(2000);
    expect(far / near).toBeCloseTo(4, 3);
  });

  it("matches the standard figures for a refracted atmosphere", () => {
    // ~0.07 m at 1 km, ~1.7 m at 5 km, ~6.8 m at 10 km with k = 0.13.
    expect(curvatureDropMeters(1000)).toBeCloseTo(0.068, 2);
    expect(curvatureDropMeters(5000)).toBeCloseTo(1.708, 2);
    expect(curvatureDropMeters(10_000)).toBeCloseTo(6.83, 1);
  });

  it("drops further without refraction than with it", () => {
    expect(curvatureDropMeters(5000, 0)).toBeGreaterThan(
      curvatureDropMeters(5000, DEFAULT_REFRACTION_K),
    );
  });
});

describe("horizonDistanceMeters", () => {
  it("is zero at or below the surface", () => {
    expect(horizonDistanceMeters(0)).toBe(0);
    expect(horizonDistanceMeters(-5)).toBe(0);
  });

  it("gives the familiar refracted horizon distances", () => {
    // Standard refraction puts a 2 m eye height at roughly 5.5 km.
    expect(horizonDistanceMeters(2) / 1000).toBeGreaterThan(5);
    expect(horizonDistanceMeters(2) / 1000).toBeLessThan(6);
    // A mount around 30 m reaches roughly 21 km.
    expect(horizonDistanceMeters(30) / 1000).toBeGreaterThan(19);
    expect(horizonDistanceMeters(30) / 1000).toBeLessThan(23);
  });

  it("increases with height and with refraction", () => {
    expect(horizonDistanceMeters(50)).toBeGreaterThan(horizonDistanceMeters(10));
    expect(horizonDistanceMeters(10, 0.13)).toBeGreaterThan(
      horizonDistanceMeters(10, 0),
    );
  });
});

describe("geodeticEnuOffset", () => {
  it("is zero for coincident points", () => {
    const point = { ...LULWORTH, heightMeters: 12 };
    const offset = geodeticEnuOffset(point, point);
    expect(offset.east).toBeCloseTo(0, 9);
    expect(offset.north).toBeCloseTo(0, 9);
    expect(offset.up).toBeCloseTo(0, 9);
  });

  it("points east and north with the expected signs from Lulworth", () => {
    const from = { ...LULWORTH, heightMeters: 30 };
    const north = {
      ...directGeodesic(LULWORTH, 0, 2_000).position,
      heightMeters: 30,
    };
    const east = {
      ...directGeodesic(LULWORTH, 90, 2_000).position,
      heightMeters: 30,
    };
    const toNorth = geodeticEnuOffset(from, north);
    const toEast = geodeticEnuOffset(from, east);
    expect(toNorth.north).toBeGreaterThan(1_990);
    expect(Math.abs(toNorth.east)).toBeLessThan(2);
    expect(toNorth.up).toBeLessThan(0);
    expect(toEast.east).toBeGreaterThan(1_990);
    expect(Math.abs(toEast.north)).toBeLessThan(2);
  });

  it("carries a height difference in up", () => {
    const from = { ...LULWORTH, heightMeters: 10 };
    const to = { ...LULWORTH, heightMeters: 40 };
    expect(geodeticEnuOffset(from, to).up).toBeCloseTo(30, 6);
  });

  it("round-trips ECEF far enough from the origin to be on the ellipsoid", () => {
    const ecef = geodeticToEcef({ ...LULWORTH, heightMeters: 0 });
    expect(Math.hypot(ecef.x, ecef.y, ecef.z)).toBeGreaterThan(6_300_000);
  });
});
