import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_SAMPLES,
  MAX_SPACING_METERS,
  MIN_PATH_METERS,
  MIN_SPACING_METERS,
  planProfileDistances,
} from "./profilePlan";

describe("planProfileDistances", () => {
  it("refuses a path too short to say anything about", () => {
    expect(planProfileDistances(0)).toEqual([]);
    expect(planProfileDistances(MIN_PATH_METERS - 1)).toEqual([]);
    expect(planProfileDistances(Number.NaN)).toEqual([]);
  });

  it("includes both endpoints exactly", () => {
    const distances = planProfileDistances(3000);
    expect(distances[0]).toBe(0);
    expect(distances[distances.length - 1]).toBe(3000);
  });

  it("is strictly increasing", () => {
    for (const total of [100, 1000, 5000, 10_000, 25_000]) {
      const distances = planProfileDistances(total);
      for (let i = 1; i < distances.length; i += 1) {
        expect(distances[i]).toBeGreaterThan(distances[i - 1]);
      }
    }
  });

  it("stays inside the sample budget at every range", () => {
    for (const total of [100, 1000, 10_000, 50_000, 200_000]) {
      expect(planProfileDistances(total).length).toBeLessThanOrEqual(
        MAX_PROFILE_SAMPLES,
      );
    }
  });

  it("honours a smaller budget", () => {
    expect(planProfileDistances(10_000, 40).length).toBeLessThanOrEqual(40);
    expect(planProfileDistances(10_000, 10).length).toBeLessThanOrEqual(10);
  });

  it("samples immediately inside both endpoints", () => {
    // The clearance test skips the endpoints, so the ground just under the
    // mast and just short of the target must still be examined.
    const total = 8000;
    const distances = planProfileDistances(total);
    expect(distances[1]).toBeLessThanOrEqual(MIN_SPACING_METERS);
    expect(total - distances[distances.length - 2]).toBeLessThanOrEqual(
      MIN_SPACING_METERS,
    );
  });

  it("samples finely near the camera and coarsely far away", () => {
    const distances = planProfileDistances(10_000);
    const firstStep = distances[2] - distances[1];
    const lastStep =
      distances[distances.length - 3] - distances[distances.length - 4];
    expect(firstStep).toBeLessThan(lastStep);
  });

  it("keeps near-field spacing fine on a short path", () => {
    const distances = planProfileDistances(300);
    const steps = distances.slice(1, -1).map((d, i) => d - distances[i]);
    expect(Math.max(...steps)).toBeLessThanOrEqual(MAX_SPACING_METERS);
    expect(Math.min(...steps)).toBeGreaterThan(0);
  });

  it("widens spacing rather than truncating range when the budget bites", () => {
    const distances = planProfileDistances(200_000);
    expect(distances[distances.length - 1]).toBe(200_000);
    const steps = distances.slice(1).map((d, i) => d - distances[i]);
    // Everything grew, including the near field, instead of dropping the tail.
    expect(Math.max(...steps)).toBeGreaterThan(MAX_SPACING_METERS);
  });
});
