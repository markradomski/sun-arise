import { describe, expect, it } from "vitest";
import { occludes, pointExposure, type BoxOccluder } from "./exposure";
import { offsetByBearing } from "../scene/geo";
import type { GeoPosition } from "../scene/types";

// The Domain, Sydney. Southern hemisphere, so midday sun is in the north.
const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const UTC_OFFSET = 11;
const MIDWINTER = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));

function house(overrides: Partial<BoxOccluder> = {}): BoxOccluder {
  return {
    position: { ...SITE },
    widthMeters: 14,
    depthMeters: 9,
    heightMeters: 4.6,
    headingDeg: 0,
    ...overrides,
  };
}

/** A ground point `distance` metres from the site on the given bearing. */
function pointAt(bearingDeg: number, distance: number): GeoPosition {
  const p = offsetByBearing(SITE, bearingDeg, distance);
  return { latitude: p.latitude, longitude: p.longitude, height: 0 };
}

describe("occludes", () => {
  // A point north of the house is shaded when the sun is in the south: the
  // shadow falls away from the sun, towards the point.
  it("blocks a point north of the house when the sun is low in the south", () => {
    expect(occludes(house(), pointAt(0, 12), 180, 15)).toBe(true);
  });

  it("does not block when the sun is on the same side as the point", () => {
    expect(occludes(house(), pointAt(0, 12), 0, 15)).toBe(false);
  });

  it("does not block when the sun is high enough to clear the roof", () => {
    expect(occludes(house(), pointAt(0, 12), 180, 80)).toBe(false);
  });

  it("never blocks below the horizon", () => {
    expect(occludes(house(), pointAt(0, 12), 180, -5)).toBe(false);
  });

  it("does not shade a point far from the house", () => {
    expect(occludes(house(), pointAt(0, 400), 180, 15)).toBe(false);
  });

  it("follows the house when it moves", () => {
    const moved = house({ position: { ...pointAt(0, 60), height: 0 } });
    // The house is now north of both points, so only the one still south of it
    // sits in the southerly-sun shadow.
    expect(occludes(moved, pointAt(0, 12), 180, 15)).toBe(false);
    expect(occludes(moved, pointAt(0, 72), 180, 15)).toBe(true);
  });

  it("follows the house when it rotates", () => {
    // 6 m east sits inside the 14 m across-heading axis at heading 0, but
    // outside the 9 m axis once that swings east.
    const point = pointAt(90, 6);
    expect(occludes(house({ headingDeg: 0 }), point, 180, 20)).toBe(true);
    expect(occludes(house({ headingDeg: 90 }), point, 180, 20)).toBe(false);
  });

  it("is continuous across the 0/360 heading wrap", () => {
    const point = pointAt(0, 12);
    const at359 = occludes(house({ headingDeg: 359.9 }), point, 180, 15);
    const at0 = occludes(house({ headingDeg: 0 }), point, 180, 15);
    const at1 = occludes(house({ headingDeg: 0.1 }), point, 180, 15);
    expect(at359).toBe(at0);
    expect(at1).toBe(at0);
  });

  it("is continuous across the 0/360 azimuth wrap", () => {
    const point = pointAt(180, 12);
    expect(occludes(house(), point, 359.9, 15)).toBe(
      occludes(house(), point, 0.1, 15),
    );
  });
});

describe("pointExposure", () => {
  const options = { utcOffsetHours: UTC_OFFSET };

  it("gives an unobstructed point the full daylight period", () => {
    const open = pointExposure(pointAt(0, 500), [house()], MIDWINTER, options);
    expect(open.daylightMinutes).toBeGreaterThan(9 * 60);
    expect(open.directSunMinutes).toBe(open.daylightMinutes);
    expect(open.directSunFraction).toBe(1);
    expect(open.intervals.every((i) => i.state === "SUN")).toBe(true);
  });

  it("reduces direct sun for a point in the house's shadow", () => {
    // Midwinter sun stays in the north, so a point on the south side is shaded
    // for part of the day.
    const shaded = pointExposure(pointAt(180, 6), [house()], MIDWINTER, options);
    const open = pointExposure(pointAt(0, 500), [house()], MIDWINTER, options);

    expect(shaded.daylightMinutes).toBe(open.daylightMinutes);
    expect(shaded.directSunMinutes).toBeLessThan(open.directSunMinutes);
    expect(shaded.directSunFraction).toBeLessThan(1);
    expect(shaded.intervals.some((i) => i.state === "BLOCKED")).toBe(true);
  });

  it("counts no daylight as neither sun nor shade", () => {
    const result = pointExposure(pointAt(180, 6), [house()], MIDWINTER, options);
    const covered = result.intervals.reduce(
      (total, i) => total + (i.end.getTime() - i.start.getTime()) / 60_000,
      0,
    );
    expect(covered).toBe(result.daylightMinutes);
    expect(covered).toBeLessThan(24 * 60);
  });

  it("keeps intervals consistent with the totals", () => {
    const result = pointExposure(pointAt(180, 6), [house()], MIDWINTER, options);
    const sun = result.intervals
      .filter((i) => i.state === "SUN")
      .reduce((t, i) => t + (i.end.getTime() - i.start.getTime()) / 60_000, 0);
    expect(sun).toBe(result.directSunMinutes);
  });

  it("produces non-overlapping intervals in chronological order", () => {
    const result = pointExposure(pointAt(180, 6), [house()], MIDWINTER, options);
    for (let i = 1; i < result.intervals.length; i += 1) {
      expect(result.intervals[i].start.getTime()).toBeGreaterThanOrEqual(
        result.intervals[i - 1].end.getTime(),
      );
    }
    expect(result.intervals.every((i) => i.end > i.start)).toBe(true);
  });

  it("responds to the house moving away", () => {
    const point = pointAt(180, 6);
    const near = pointExposure(point, [house()], MIDWINTER, options);
    const far = pointExposure(
      point,
      [house({ position: { ...pointAt(0, 300), height: 0 } })],
      MIDWINTER,
      options,
    );
    expect(far.directSunMinutes).toBeGreaterThan(near.directSunMinutes);
  });

  it("responds to the house rotating", () => {
    const point = pointAt(135, 10);
    const square = pointExposure(point, [house({ headingDeg: 0 })], MIDWINTER, options);
    const turned = pointExposure(point, [house({ headingDeg: 90 })], MIDWINTER, options);
    expect(turned.directSunMinutes).not.toBe(square.directSunMinutes);
  });

  it("gives the same answer either side of midnight for the same civil day", () => {
    const morning = new Date(Date.UTC(2026, 5, 20, 20, 0, 0));
    const evening = new Date(Date.UTC(2026, 5, 21, 10, 0, 0));
    const a = pointExposure(pointAt(180, 6), [house()], morning, options);
    const b = pointExposure(pointAt(180, 6), [house()], evening, options);
    expect(a.date.getTime()).toBe(b.date.getTime());
    expect(a.directSunMinutes).toBe(b.directSunMinutes);
  });

  it("treats an empty occluder list as fully exposed", () => {
    const result = pointExposure(pointAt(0, 5), [], MIDWINTER, options);
    expect(result.directSunMinutes).toBe(result.daylightMinutes);
  });
});
