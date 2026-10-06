import { describe, expect, it } from "vitest";
import { seasonalPointExposure } from "./seasonalComparison";
import { pointExposure, sunTimeline, type BoxOccluder } from "./exposure";
import { exposureField } from "./exposureField";
import { offsetHoursAt, timeZoneAt } from "./timezone";
import { offsetByBearing } from "../scene/geo";
import { DEFAULT_GRID, groundGrid } from "../scene/grid";
import type { GeoPosition } from "../scene/types";

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const YEAR = 2026;

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

function pointAt(bearingDeg: number, distance: number): GeoPosition {
  const p = offsetByBearing(SITE, bearingDeg, distance);
  return { latitude: p.latitude, longitude: p.longitude, height: 0 };
}

describe("seasonalPointExposure", () => {
  it("returns the three presets in order", () => {
    const result = seasonalPointExposure(pointAt(0, 400), [house()], YEAR);
    expect(result.map((r) => r.season)).toEqual(["SUMMER", "EQUINOX", "WINTER"]);
  });

  it("orders daylight summer > equinox > winter away from the equator", () => {
    const [summer, equinox, winter] = seasonalPointExposure(
      pointAt(0, 400),
      [house()],
      YEAR,
    );
    expect(summer.daylightMinutes).toBeGreaterThan(equinox.daylightMinutes);
    expect(equinox.daylightMinutes).toBeGreaterThan(winter.daylightMinutes);
  });

  it("resolves each season's own daylight-saving offset", () => {
    const zone = timeZoneAt(SITE.latitude, SITE.longitude);
    const [summer, , winter] = seasonalPointExposure(
      pointAt(0, 400),
      [house()],
      YEAR,
    );
    // Sydney is UTC+11 in December and UTC+10 in June.
    expect(offsetHoursAt(summer.date, zone)).toBe(11);
    expect(offsetHoursAt(winter.date, zone)).toBe(10);
  });

  it("gives open ground full daylight in every season", () => {
    for (const entry of seasonalPointExposure(pointAt(0, 400), [house()], YEAR)) {
      expect(entry.directSunMinutes).toBe(entry.daylightMinutes);
      expect(entry.directSunFraction).toBe(1);
    }
  });

  it("shows a strong seasonal swing in the house's shade", () => {
    const shaded = seasonalPointExposure(pointAt(180, 7), [house()], YEAR);
    const [summer, equinox, winter] = shaded;
    expect(summer.directSunMinutes).toBeGreaterThan(winter.directSunMinutes);
    expect(equinox.directSunMinutes).toBeGreaterThan(winter.directSunMinutes);
    expect(winter.directSunFraction).toBeLessThan(0.2);
  });

  it("matches the single-point calculation for the same date and offset", () => {
    const point = pointAt(180, 7);
    const zone = timeZoneAt(point.latitude, point.longitude);
    for (const entry of seasonalPointExposure(point, [house()], YEAR)) {
      const utcOffsetHours = offsetHoursAt(entry.date, zone);
      const direct = pointExposure(point, [house()], entry.date, { utcOffsetHours });
      expect(entry.directSunMinutes).toBe(direct.directSunMinutes);
    }
  });

  it("responds to the house moving away", () => {
    const point = pointAt(180, 7);
    const near = seasonalPointExposure(point, [house()], YEAR);
    const far = seasonalPointExposure(
      point,
      [house({ position: { ...pointAt(0, 300), height: 0 } })],
      YEAR,
    );
    expect(far[2].directSunMinutes).toBeGreaterThan(near[2].directSunMinutes);
  });
});

describe("inspector against the field", () => {
  it("agrees with the field at a grid location", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));
    const options = { utcOffsetHours: 10 };
    const timeline = sunTimeline(SITE, date, options);
    const grid = groundGrid({ centre: SITE, ...DEFAULT_GRID });
    const field = exposureField(
      grid.points.map((p) => p.position),
      [house()],
      timeline,
    );

    for (const index of [0, 310, 480, 620, 960]) {
      const detail = pointExposure(
        grid.points[index].position,
        [house()],
        date,
        options,
      );
      expect(detail.directSunMinutes).toBe(field.minutes[index]);
    }
  });

  it("reconciles sun and shade intervals with total daylight", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));
    const detail = pointExposure(pointAt(180, 7), [house()], date, {
      utcOffsetHours: 10,
    });

    const minutesIn = (state: "SUN" | "BLOCKED") =>
      detail.intervals
        .filter((i) => i.state === state)
        .reduce((total, i) => total + (i.end.getTime() - i.start.getTime()) / 60_000, 0);

    expect(minutesIn("SUN")).toBe(detail.directSunMinutes);
    expect(minutesIn("SUN") + minutesIn("BLOCKED")).toBe(detail.daylightMinutes);
  });
});
