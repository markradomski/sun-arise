import { describe, expect, it } from "vitest";
import {
  directGeodesic,
  geodesicPoints,
  inverseGeodesic,
  normaliseLongitude,
} from "./geodesy";

const LULWORTH = { latitude: -41.001528744069276, longitude: 147.07141571573635 };

describe("directGeodesic", () => {
  it("round-trips against the inverse solution", () => {
    const destination = directGeodesic(LULWORTH, 37.5, 12_000).position;
    const back = inverseGeodesic(LULWORTH, destination);
    expect(back.distanceMeters).toBeCloseTo(12_000, 3);
    expect(back.initialBearingDeg).toBeCloseTo(37.5, 9);
  });

  it("stays put over zero distance", () => {
    const result = directGeodesic(LULWORTH, 123, 0);
    expect(result.position).toEqual(LULWORTH);
  });

  it("moves due north along a meridian without changing longitude", () => {
    const north = directGeodesic(LULWORTH, 0, 5_000).position;
    expect(north.longitude).toBeCloseTo(LULWORTH.longitude, 9);
    expect(north.latitude).toBeGreaterThan(LULWORTH.latitude);
  });

  it("moves due east without changing latitude appreciably", () => {
    const east = directGeodesic(LULWORTH, 90, 5_000).position;
    expect(east.longitude).toBeGreaterThan(LULWORTH.longitude);
    // An east-bound geodesic is not a parallel, but over 5 km the drift is tiny.
    expect(Math.abs(east.latitude - LULWORTH.latitude)).toBeLessThan(0.0002);
  });
});

describe("normaliseLongitude", () => {
  it("wraps across the antimeridian", () => {
    expect(normaliseLongitude(181)).toBeCloseTo(-179, 9);
    expect(normaliseLongitude(-181)).toBeCloseTo(179, 9);
    expect(normaliseLongitude(147)).toBeCloseTo(147, 9);
  });
});

describe("geodesicPoints", () => {
  const target = { latitude: -40.93, longitude: 147.12 };

  it("lands exactly on both endpoints", () => {
    const { distanceMeters } = inverseGeodesic(LULWORTH, target);
    const points = geodesicPoints(LULWORTH, target, [0, distanceMeters]);
    expect(points[0]).toEqual(LULWORTH);
    expect(points[1]).toEqual(target);
  });

  it("places interior points on the geodesic, not on a straight lat/lon line", () => {
    const { distanceMeters } = inverseGeodesic(LULWORTH, target);
    const half = distanceMeters / 2;
    const [midpoint] = geodesicPoints(LULWORTH, target, [half]);

    // The defining property: the two legs sum to the whole path.
    const first = inverseGeodesic(LULWORTH, midpoint).distanceMeters;
    const second = inverseGeodesic(midpoint, target).distanceMeters;
    expect(first).toBeCloseTo(half, 3);
    expect(first + second).toBeCloseTo(distanceMeters, 3);

    // A naive average of the coordinates is a different point. The gap is
    // small at this range, which is exactly why it has to be tested rather
    // than eyeballed.
    const naive = {
      latitude: (LULWORTH.latitude + target.latitude) / 2,
      longitude: (LULWORTH.longitude + target.longitude) / 2,
    };
    expect(inverseGeodesic(midpoint, naive).distanceMeters).toBeGreaterThan(0.5);
  });

  it("spaces requested distances correctly along the path", () => {
    const distances = [0, 500, 1500, 3000];
    const points = geodesicPoints(LULWORTH, target, distances);
    for (let i = 0; i < distances.length; i += 1) {
      expect(inverseGeodesic(LULWORTH, points[i]).distanceMeters).toBeCloseTo(
        distances[i],
        2,
      );
    }
  });

  it("keeps a constant bearing along a path, as a geodesic requires", () => {
    const { initialBearingDeg } = inverseGeodesic(LULWORTH, target);
    const [quarter] = geodesicPoints(LULWORTH, target, [1000]);
    expect(inverseGeodesic(LULWORTH, quarter).initialBearingDeg).toBeCloseTo(
      initialBearingDeg,
      6,
    );
  });

  it("collapses to the origin when the endpoints coincide", () => {
    const points = geodesicPoints(LULWORTH, LULWORTH, [0, 10, 20]);
    expect(points).toEqual([LULWORTH, LULWORTH, LULWORTH]);
  });

  it("clamps distances past the target to the target", () => {
    const { distanceMeters } = inverseGeodesic(LULWORTH, target);
    const [beyond] = geodesicPoints(LULWORTH, target, [distanceMeters + 5000]);
    expect(beyond).toEqual(target);
  });
});
