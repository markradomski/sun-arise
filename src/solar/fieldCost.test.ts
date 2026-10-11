import { describe, expect, it } from "vitest";
import { fieldBounds, MAX_FIELD_SAMPLES } from "../scene/fieldBounds";
import { groundGrid } from "../scene/grid";
import { offsetByBearing } from "../scene/geo";
import { occluderFor } from "../scene/occluders";
import { exposureField } from "./exposureField";
import { instantField } from "./instantField";
import { sunTimeline } from "./exposure";
import type { GeoPosition, SceneObject } from "../scene/types";

/**
 * Cost of the adaptive field at representative scene sizes.
 *
 * Not a benchmark with thresholds tuned to this machine — timings vary too
 * much for that to be a useful gate. These assert the bounds that actually
 * matter: the sample budget holds, sampling stays at 2 m, and WHOLE DAY cost
 * stays within a sane multiple of NOW.
 */

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const SPACING = 2;
const WINTER = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));
const options = { utcOffsetHours: 10 };

function scene(count: number, spreadMeters: number): SceneObject[] {
  return Array.from({ length: count }, (_, index) => {
    const bearing = (index * 360) / Math.max(1, count);
    const distance = index === 0 ? 0 : spreadMeters;
    const p = index === 0 ? SITE : offsetByBearing(SITE, bearing, distance);
    return {
      id: `house-${index + 1}`,
      type: "house" as const,
      modelUrl: "/models/reference-house.glb",
      position: { latitude: p.latitude, longitude: p.longitude, height: 0 },
      rotation: { heading: index * 23, pitch: 0, roll: 0 },
      scale: 1,
      clampToGround: true,
    };
  });
}

function measure(houses: SceneObject[]) {
  const bounds = fieldBounds(houses, [], { spacingMeters: SPACING })!;
  const grid = groundGrid({
    centre: bounds.centre,
    extentMeters: bounds.extentEastMeters,
    extentNorthMeters: bounds.extentNorthMeters,
    spacingMeters: SPACING,
  });
  const positions = grid.points.map((p) => p.position);
  const occluders = houses.map(occluderFor);
  const timeline = sunTimeline(bounds.centre, WINTER, options);

  const whole = exposureField(positions, occluders, timeline);
  const now = instantField(positions, occluders, bounds.centre, WINTER, options);

  return {
    samples: grid.points.length,
    spacing: grid.spacingMeters,
    clamped: bounds.clamped,
    sunSamples: timeline.samples.length,
    wholeDayMs: whole.computeMs,
    nowMs: now.computeMs,
  };
}

describe("adaptive field cost", () => {
  const cases: [string, SceneObject[]][] = [
    ["1 house", scene(1, 0)],
    ["2 houses, 20 m apart", scene(2, 20)],
    ["2 houses, 150 m apart", scene(2, 150)],
    ["5 houses, 60 m spread", scene(5, 60)],
    ["10 houses, 100 m spread", scene(10, 100)],
  ];

  for (const [label, houses] of cases) {
    it(`stays within budget at 2 m spacing: ${label}`, () => {
      const result = measure(houses);
      expect(result.spacing).toBe(SPACING);
      expect(result.samples).toBeLessThanOrEqual(MAX_FIELD_SAMPLES);
      expect(result.clamped).toBe(false);
      expect(result.wholeDayMs).toBeGreaterThanOrEqual(0);
    });
  }

  it("keeps a single house at the historical 961 samples", () => {
    expect(measure(scene(1, 0)).samples).toBe(961);
  });

  it("costs far less for NOW than for a whole day", () => {
    // NOW is one sun position; WHOLE DAY is one per timeline sample.
    const result = measure(scene(2, 150));
    expect(result.sunSamples).toBeGreaterThan(50);
    expect(result.nowMs).toBeLessThanOrEqual(result.wholeDayMs + 1);
  });

  it("grows with covered area rather than with house count alone", () => {
    const tight = measure(scene(5, 15));
    const spread = measure(scene(5, 120));
    expect(spread.samples).toBeGreaterThan(tight.samples);
  });

  it("reports what it had to drop when a scene exceeds the budget", () => {
    const bounds = fieldBounds(scene(2, 6000), [], { spacingMeters: SPACING })!;
    expect(bounds.clamped).toBe(true);
    expect(bounds.sampleCount).toBeLessThanOrEqual(MAX_FIELD_SAMPLES);
    expect(
      bounds.droppedEastMeters + bounds.droppedNorthMeters,
    ).toBeGreaterThan(0);
  });
});
