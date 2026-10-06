import { describe, expect, it } from "vitest";
import { exposureField } from "./exposureField";
import {
  pointExposure,
  sunTimeline,
  type BoxOccluder,
} from "./exposure";
import { DEFAULT_GRID, groundGrid } from "../scene/grid";
import { eastNorthOffset } from "../scene/geo";
import type { GeoPosition } from "../scene/types";

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const UTC_OFFSET = 11;
const MIDWINTER = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));
const options = { utcOffsetHours: UTC_OFFSET };

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

function grid() {
  return groundGrid({ centre: SITE, ...DEFAULT_GRID });
}

describe("groundGrid", () => {
  it("covers the requested extent at the requested spacing", () => {
    const g = grid();
    expect(g.cols).toBe(31);
    expect(g.rows).toBe(31);
    expect(g.points).toHaveLength(961);
    expect(g.spacingMeters).toBe(2);
  });

  it("centres on the site with symmetric offsets", () => {
    const g = grid();
    const first = g.points[0];
    const last = g.points[g.points.length - 1];
    expect(first.east).toBe(-30);
    expect(first.north).toBe(-30);
    expect(last.east).toBe(30);
    expect(last.north).toBe(30);

    const centre = g.points[Math.floor(g.points.length / 2)];
    expect(centre.east).toBe(0);
    expect(centre.north).toBe(0);
    expect(centre.position.latitude).toBeCloseTo(SITE.latitude, 9);
  });

  it("places points where their stated offsets say they are", () => {
    const g = grid();
    for (const point of [g.points[0], g.points[400], g.points[960]]) {
      const offset = eastNorthOffset(SITE, point.position);
      expect(offset.east).toBeCloseTo(point.east, 2);
      expect(offset.north).toBeCloseTo(point.north, 2);
    }
  });

  it("is ordered row-major from the south-west", () => {
    const g = grid();
    expect(g.points[1].east).toBeGreaterThan(g.points[0].east);
    expect(g.points[1].north).toBe(g.points[0].north);
    expect(g.points[g.cols].north).toBeGreaterThan(g.points[0].north);
  });

  it("handles a spacing that does not divide the extent evenly", () => {
    const g = groundGrid({ centre: SITE, extentMeters: 10, spacingMeters: 3 });
    expect(g.cols).toBe(4);
    expect(g.points).toHaveLength(16);
  });
});

describe("sunTimeline", () => {
  it("contains only daylight samples", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    expect(timeline.samples.length).toBeGreaterThan(0);
    expect(timeline.samples.every((s) => s.altitudeDeg > 0)).toBe(true);
    expect(timeline.daylightMinutes).toBe(
      timeline.samples.length * timeline.sampleIntervalMinutes,
    );
  });

  it("respects a configured interval", () => {
    const coarse = sunTimeline(SITE, MIDWINTER, { ...options, sampleIntervalMinutes: 30 });
    const fine = sunTimeline(SITE, MIDWINTER, options);
    expect(coarse.sampleIntervalMinutes).toBe(30);
    expect(coarse.samples.length).toBeLessThan(fine.samples.length);
    // A coarser interval quantises the daylight total to its own step.
    expect(Math.abs(coarse.daylightMinutes - fine.daylightMinutes)).toBeLessThanOrEqual(30);
  });
});

describe("exposureField", () => {
  it("is reused across points rather than recomputed per point", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const g = grid();
    const field = exposureField(
      g.points.map((p) => p.position),
      [house()],
      timeline,
    );
    // The same timeline instance backs the whole field.
    expect(field.timeline).toBe(timeline);
    expect(field.pointCount).toBe(961);
    expect(field.minutes).toHaveLength(961);
  });

  it("agrees with the single-point calculation", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const g = grid();
    const field = exposureField(
      g.points.map((p) => p.position),
      [house()],
      timeline,
    );

    for (const index of [0, 123, 480, 960]) {
      const point = g.points[index].position;
      const single = pointExposure(point, [house()], MIDWINTER, options);
      expect(field.minutes[index]).toBeCloseTo(single.directSunMinutes, 6);
    }
  });

  it("gives open ground the full daylight period", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const g = grid();
    const field = exposureField(
      g.points.map((p) => p.position),
      [house()],
      timeline,
    );
    expect(field.maxMinutes).toBe(timeline.daylightMinutes);
  });

  it("shades cells near the house", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const g = grid();
    const field = exposureField(
      g.points.map((p) => p.position),
      [house()],
      timeline,
    );
    expect(field.minMinutes).toBeLessThan(field.maxMinutes);

    const shaded = [...field.minutes].filter((m) => m < timeline.daylightMinutes);
    expect(shaded.length).toBeGreaterThan(0);
    expect(shaded.length).toBeLessThan(field.pointCount);
  });

  it("never reports more direct sun than daylight", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const g = grid();
    const field = exposureField(
      g.points.map((p) => p.position),
      [house()],
      timeline,
    );
    expect(field.maxMinutes).toBeLessThanOrEqual(timeline.daylightMinutes);
    expect(field.minMinutes).toBeGreaterThanOrEqual(0);
  });

  it("changes when the house moves", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const points = grid().points.map((p) => p.position);
    const here = exposureField(points, [house()], timeline);
    const away = exposureField(
      points,
      [house({ position: { latitude: SITE.latitude + 0.01, longitude: SITE.longitude, height: 0 } })],
      timeline,
    );

    const total = (f: { minutes: Float32Array }) =>
      [...f.minutes].reduce((a, b) => a + b, 0);
    expect(total(away)).toBeGreaterThan(total(here));
    expect(away.minMinutes).toBe(timeline.daylightMinutes);
  });

  it("changes when the house rotates", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const points = grid().points.map((p) => p.position);
    const square = exposureField(points, [house({ headingDeg: 0 })], timeline);
    const turned = exposureField(points, [house({ headingDeg: 90 })], timeline);

    const total = (f: { minutes: Float32Array }) =>
      [...f.minutes].reduce((a, b) => a + b, 0);
    expect(total(turned)).not.toBeCloseTo(total(square), 3);
  });

  it("treats an empty point set as an empty field", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const field = exposureField([], [house()], timeline);
    expect(field.pointCount).toBe(0);
    expect(field.minMinutes).toBe(0);
    expect(field.maxMinutes).toBe(0);
  });

  it("measures its own compute time", () => {
    const timeline = sunTimeline(SITE, MIDWINTER, options);
    const field = exposureField(
      grid().points.map((p) => p.position),
      [house()],
      timeline,
    );
    expect(field.computeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(field.computeMs)).toBe(true);
  });
});
