import { describe, expect, it } from "vitest";
import { instantField, instantPoint, relativeStrength } from "./instantField";
import { sunTimeline, type BoxOccluder } from "./exposure";
import { exposureField } from "./exposureField";
import { seasonalDate } from "./seasons";
import { offsetByBearing } from "../scene/geo";
import { DEFAULT_GRID, groundGrid } from "../scene/grid";
import type { GeoPosition } from "../scene/types";

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const WINTER_OFFSET = 10;
/** Sydney midwinter, 11:00 civil time. */
const WINTER_MIDDAY = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));

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

function at(bearingDeg: number, metres: number): GeoPosition {
  const p = offsetByBearing(SITE, bearingDeg, metres);
  return { latitude: p.latitude, longitude: p.longitude, height: 0 };
}

const options = { utcOffsetHours: WINTER_OFFSET };

describe("relativeStrength", () => {
  it("is zero at and below the horizon", () => {
    expect(relativeStrength(0)).toBe(0);
    expect(relativeStrength(-10)).toBe(0);
  });

  it("rises with solar altitude and reaches one overhead", () => {
    expect(relativeStrength(90)).toBeCloseTo(1, 10);
    expect(relativeStrength(60)).toBeGreaterThan(relativeStrength(30));
    expect(relativeStrength(30)).toBeCloseTo(0.5, 10);
  });
});

describe("instantPoint", () => {
  it("reports shade south of the house at midwinter midday", () => {
    // Southern hemisphere: the midday sun is north, so the shadow falls south.
    const result = instantPoint(at(180, 4), [house()], SITE, WINTER_MIDDAY, options);
    expect(result.state).toBe("BLOCKED");
    expect(result.night).toBe(false);
  });

  it("reports direct sun on the sunward side", () => {
    const result = instantPoint(at(0, 12), [house()], SITE, WINTER_MIDDAY, options);
    expect(result.state).toBe("SUN");
  });

  it("reports night when the sun is below the horizon", () => {
    const midnight = new Date(Date.UTC(2026, 5, 21, 14, 0, 0));
    const result = instantPoint(at(0, 12), [house()], SITE, midnight, options);
    expect(result.night).toBe(true);
    expect(result.sunAltitudeDeg).toBeLessThanOrEqual(0);
  });
});

describe("instantField", () => {
  const grid = groundGrid({ centre: SITE, ...DEFAULT_GRID });
  const positions = grid.points.map((p) => p.position);

  it("covers every grid point", () => {
    const field = instantField(positions, [house()], SITE, WINTER_MIDDAY, options);
    expect(field.pointCount).toBe(positions.length);
    expect(field.strength).toHaveLength(positions.length);
  });

  it("gives every lit point the same strength", () => {
    // Strength comes from the sun's altitude alone, so the field is two-valued
    // at any instant: shaded, or the one value the current altitude gives.
    const field = instantField(positions, [house()], SITE, WINTER_MIDDAY, options);
    const values = new Set(Array.from(field.strength));
    expect(values.size).toBe(2);
    expect(values.has(0)).toBe(true);
  });

  it("leaves nothing lit at night", () => {
    const midnight = new Date(Date.UTC(2026, 5, 21, 14, 0, 0));
    const field = instantField(positions, [house()], SITE, midnight, options);
    expect(field.night).toBe(true);
    expect(Array.from(field.strength).every((v) => v === 0)).toBe(true);
  });

  it("shades fewer points as the sun climbs", () => {
    const morning = new Date(Date.UTC(2026, 5, 20, 21, 30, 0));
    const noon = new Date(Date.UTC(2026, 5, 21, 2, 0, 0));
    const shaded = (date: Date) =>
      Array.from(
        instantField(positions, [house()], SITE, date, options).strength,
      ).filter((v) => v === 0).length;
    expect(shaded(morning)).toBeGreaterThan(shaded(noon));
  });

  it("agrees with the whole-day engine about which points are shaded", () => {
    // A point in shade at every instant of the day must record no direct sun
    // over the day, since both read the same occlusion geometry.
    const date = seasonalDate("WINTER", SITE.latitude, 2026, WINTER_OFFSET);
    const timeline = sunTimeline(SITE, date, options);
    const daily = exposureField(positions, [house()], timeline);

    let alwaysShadedChecked = 0;
    for (let i = 0; i < positions.length; i += 1) {
      if (daily.minutes[i] !== 0) continue;
      alwaysShadedChecked += 1;
      for (const sample of timeline.samples.slice(0, 6)) {
        const point = instantPoint(positions[i], [house()], SITE, sample.at, options);
        expect(point.state).toBe("BLOCKED");
      }
    }
    expect(alwaysShadedChecked).toBeGreaterThan(0);
  });

  it("costs one sun position rather than a whole timeline", () => {
    const date = seasonalDate("WINTER", SITE.latitude, 2026, WINTER_OFFSET);
    const timeline = sunTimeline(SITE, date, options);
    expect(timeline.samples.length).toBeGreaterThan(50);

    const instant = instantField(positions, [house()], SITE, WINTER_MIDDAY, options);
    const daily = exposureField(positions, [house()], timeline);
    expect(instant.computeMs).toBeLessThanOrEqual(daily.computeMs + 1);
  });
});
