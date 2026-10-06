import { describe, expect, it } from "vitest";
import {
  areaAboveHours,
  exposureField,
  meanMinutes,
} from "./exposureField";
import { pointExposure, sunTimeline, type BoxOccluder } from "./exposure";
import { seasonalDate } from "./seasons";
import { offsetByBearing } from "../scene/geo";
import { DEFAULT_GRID, groundGrid } from "../scene/grid";
import type { GeoPosition } from "../scene/types";

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const WINTER_OFFSET = 10;
const WINTER = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));
const CELL_AREA = DEFAULT_GRID.spacingMeters ** 2;

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

function movedHouse(bearingDeg: number, distance: number): BoxOccluder {
  const p = offsetByBearing(SITE, bearingDeg, distance);
  return house({ position: { latitude: p.latitude, longitude: p.longitude, height: 0 } });
}

/**
 * Both placements are measured over one grid anchored on the baseline, which
 * is what makes the areas comparable.
 */
function compare(baseline: BoxOccluder[], current: BoxOccluder[], date = WINTER) {
  const grid = groundGrid({ centre: baseline[0].position, ...DEFAULT_GRID });
  const positions = grid.points.map((p) => p.position);
  const timeline = sunTimeline(baseline[0].position, date, {
    utcOffsetHours: WINTER_OFFSET,
  });

  const a = exposureField(positions, baseline, timeline);
  const b = exposureField(positions, current, timeline);

  return {
    area8h: {
      baseline: areaAboveHours(a, CELL_AREA, 8),
      current: areaAboveHours(b, CELL_AREA, 8),
    },
    area6h: {
      baseline: areaAboveHours(a, CELL_AREA, 6),
      current: areaAboveHours(b, CELL_AREA, 6),
    },
    averageMinutes: { baseline: meanMinutes(a), current: meanMinutes(b) },
  };
}

describe("placement comparison", () => {
  it("reports no change for an unchanged placement", () => {
    const c = compare([house()], [house()]);
    expect(c.area8h.current).toBe(c.area8h.baseline);
    expect(c.area6h.current).toBe(c.area6h.baseline);
    expect(c.averageMinutes.current).toBe(c.averageMinutes.baseline);
  });

  it("increases exposure when the house moves away", () => {
    const c = compare([house()], [movedHouse(0, 40)]);
    expect(c.averageMinutes.current).toBeGreaterThan(c.averageMinutes.baseline);
    expect(c.area8h.current).toBeGreaterThan(c.area8h.baseline);
  });

  it("changes metrics when the house rotates", () => {
    const c = compare([house({ headingDeg: 0 })], [house({ headingDeg: 90 })]);
    expect(c.averageMinutes.current).not.toBe(c.averageMinutes.baseline);
  });

  it("returns to zero deltas when the placement is restored", () => {
    const moved = compare([house()], [movedHouse(0, 40)]);
    expect(moved.averageMinutes.current).not.toBe(moved.averageMinutes.baseline);

    const restored = compare([house()], [house()]);
    expect(restored.averageMinutes.current - restored.averageMinutes.baseline).toBe(0);
    expect(restored.area8h.current - restored.area8h.baseline).toBe(0);
  });

  it("stays internally consistent when the date changes", () => {
    // Both sides are recomputed against the active timeline, so an unchanged
    // placement still reports no change in any season.
    for (const season of ["SUMMER", "EQUINOX", "WINTER"] as const) {
      const date = seasonalDate(season, SITE.latitude, 2026, WINTER_OFFSET);
      const c = compare([house()], [house()], date);
      expect(c.averageMinutes.current).toBe(c.averageMinutes.baseline);
    }
  });

  it("shows a seasonal difference while keeping deltas comparable", () => {
    const summer = compare(
      [house()],
      [movedHouse(0, 40)],
      seasonalDate("SUMMER", SITE.latitude, 2026, 11),
    );
    const winter = compare(
      [house()],
      [movedHouse(0, 40)],
      seasonalDate("WINTER", SITE.latitude, 2026, 10),
    );
    expect(summer.averageMinutes.baseline).toBeGreaterThan(
      winter.averageMinutes.baseline,
    );
    expect(summer.averageMinutes.current).toBeGreaterThan(
      summer.averageMinutes.baseline,
    );
  });

  it("compares the inspected point exactly, not via the nearest grid cell", () => {
    // At the equinox the shadow edge falls between 7 m and 8 m south, so the
    // point and the nearest 2 m grid cell genuinely disagree and must not be
    // treated as interchangeable.
    const equinox = seasonalDate("EQUINOX", SITE.latitude, 2026, WINTER_OFFSET);
    const probePosition = offsetByBearing(SITE, 180, 7);
    const probe: GeoPosition = {
      latitude: probePosition.latitude,
      longitude: probePosition.longitude,
      height: 0,
    };

    const atPoint = pointExposure(probe, [house()], equinox, {
      utcOffsetHours: WINTER_OFFSET,
    }).directSunMinutes;

    const grid = groundGrid({ centre: SITE, ...DEFAULT_GRID });
    const timeline = sunTimeline(SITE, equinox, { utcOffsetHours: WINTER_OFFSET });
    const field = exposureField(
      grid.points.map((p) => p.position),
      [house()],
      timeline,
    );
    let nearest = 0;
    let best = Infinity;
    grid.points.forEach((point, index) => {
      const d = Math.hypot(point.east, point.north + 7);
      if (d < best) {
        best = d;
        nearest = index;
      }
    });

    expect(atPoint).not.toBe(field.minutes[nearest]);
  });

  it("moves the inspected point's exposure when the house moves", () => {
    const probePosition = offsetByBearing(SITE, 180, 7);
    const probe: GeoPosition = {
      latitude: probePosition.latitude,
      longitude: probePosition.longitude,
      height: 0,
    };
    const options = { utcOffsetHours: WINTER_OFFSET };

    const before = pointExposure(probe, [house()], WINTER, options).directSunMinutes;
    const after = pointExposure(probe, [movedHouse(0, 40)], WINTER, options)
      .directSunMinutes;

    expect(after).toBeGreaterThan(before);
  });
});
