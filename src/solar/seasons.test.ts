import { describe, expect, it } from "vitest";
import { isNorthern, seasonalDate, SEASONS } from "./seasons";
import { civilParts } from "./timezone";
import { sunTimeline, type BoxOccluder } from "./exposure";
import { exposureField, areaAboveHours } from "./exposureField";
import { DEFAULT_GRID, groundGrid } from "../scene/grid";
import type { GeoPosition } from "../scene/types";

const SYDNEY: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const LONDON: GeoPosition = { latitude: 51.5074, longitude: -0.1278, height: 0 };
const SYDNEY_OFFSET = 11;
const LONDON_OFFSET = 1;
const YEAR = 2026;

function partsAt(date: Date, timeZone: string) {
  return civilParts(date, timeZone);
}

describe("seasonalDate", () => {
  it("maps summer and winter to opposite solstices by hemisphere", () => {
    const south = {
      summer: partsAt(seasonalDate("SUMMER", SYDNEY.latitude, YEAR, SYDNEY_OFFSET), "Australia/Sydney"),
      winter: partsAt(seasonalDate("WINTER", SYDNEY.latitude, YEAR, SYDNEY_OFFSET), "Australia/Sydney"),
    };
    const north = {
      summer: partsAt(seasonalDate("SUMMER", LONDON.latitude, YEAR, LONDON_OFFSET), "Europe/London"),
      winter: partsAt(seasonalDate("WINTER", LONDON.latitude, YEAR, LONDON_OFFSET), "Europe/London"),
    };

    expect(south.summer.month).toBe(12);
    expect(south.winter.month).toBe(6);
    expect(north.summer.month).toBe(6);
    expect(north.winter.month).toBe(12);
  });

  it("uses nominal solstice and equinox days", () => {
    const winter = partsAt(
      seasonalDate("WINTER", SYDNEY.latitude, YEAR, SYDNEY_OFFSET),
      "Australia/Sydney",
    );
    const equinox = partsAt(
      seasonalDate("EQUINOX", SYDNEY.latitude, YEAR, SYDNEY_OFFSET),
      "Australia/Sydney",
    );
    expect([winter.month, winter.day]).toEqual([6, 21]);
    expect([equinox.month, equinox.day]).toEqual([9, 22]);
  });

  it("lands on the intended civil day whatever the offset", () => {
    for (const offset of [-11, -5, 0, 5.5, 11, 12]) {
      const date = seasonalDate("WINTER", SYDNEY.latitude, YEAR, offset);
      const shifted = new Date(date.getTime() + offset * 3_600_000);
      expect(shifted.getUTCMonth()).toBe(5);
      expect(shifted.getUTCDate()).toBe(21);
    }
  });

  it("treats the equator as northern for preset purposes", () => {
    expect(isNorthern(0)).toBe(true);
    expect(isNorthern(-0.1)).toBe(false);
  });

  it("offers exactly the three presets", () => {
    expect(SEASONS).toEqual(["SUMMER", "EQUINOX", "WINTER"]);
  });
});

describe("seasonal exposure", () => {
  function house(): BoxOccluder {
    return {
      position: { ...SYDNEY },
      widthMeters: 14,
      depthMeters: 9,
      heightMeters: 4.6,
      headingDeg: 0,
    };
  }

  function fieldFor(season: "SUMMER" | "EQUINOX" | "WINTER") {
    const date = seasonalDate(season, SYDNEY.latitude, YEAR, SYDNEY_OFFSET);
    const timeline = sunTimeline(SYDNEY, date, { utcOffsetHours: SYDNEY_OFFSET });
    const grid = groundGrid({ centre: SYDNEY, ...DEFAULT_GRID });
    const result = exposureField(
      grid.points.map((p) => p.position),
      [house()],
      timeline,
    );
    return { timeline, grid, result };
  }

  it("gives winter shorter daylight than summer away from the equator", () => {
    const summer = fieldFor("SUMMER");
    const winter = fieldFor("WINTER");
    const equinox = fieldFor("EQUINOX");

    expect(winter.timeline.daylightMinutes).toBeLessThan(summer.timeline.daylightMinutes);
    expect(equinox.timeline.daylightMinutes).toBeGreaterThan(
      winter.timeline.daylightMinutes,
    );
    expect(equinox.timeline.daylightMinutes).toBeLessThan(
      summer.timeline.daylightMinutes,
    );
  });

  it("puts the equinox near twelve hours of daylight", () => {
    const { timeline } = fieldFor("EQUINOX");
    expect(timeline.daylightMinutes).toBeGreaterThan(11 * 60);
    expect(timeline.daylightMinutes).toBeLessThan(13 * 60);
  });

  it("produces a different field per season", () => {
    const total = (f: { minutes: Float32Array }) =>
      [...f.minutes].reduce((a, b) => a + b, 0);
    expect(total(fieldFor("WINTER").result)).not.toBe(total(fieldFor("SUMMER").result));
  });

  it("leaves more ground in long sun in summer than winter", () => {
    const cell = DEFAULT_GRID.spacingMeters ** 2;
    const summer = areaAboveHours(fieldFor("SUMMER").result, cell, 8);
    const winter = areaAboveHours(fieldFor("WINTER").result, cell, 8);
    expect(summer).toBeGreaterThan(winter);
  });

  it("derives area from the grid rather than any rendered output", () => {
    const { result, grid } = fieldFor("SUMMER");
    const cell = grid.spacingMeters ** 2;
    const area = areaAboveHours(result, cell, 8);
    const cells = [...result.minutes].filter((m) => m >= 8 * 60).length;
    expect(area).toBe(cells * cell);
    expect(area).toBeLessThanOrEqual(result.pointCount * cell);
  });

  it("counts nothing above a threshold no cell reaches", () => {
    const { result, grid } = fieldFor("WINTER");
    expect(areaAboveHours(result, grid.spacingMeters ** 2, 24)).toBe(0);
  });
});
