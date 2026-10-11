import { describe, expect, it } from "vitest";
import { lineOfSight, type TerrainProfile } from "./lineOfSight";
import { curvatureDropMeters } from "./geodesy";

const FROM = { latitude: -41.0014, longitude: 147.0716 };
const TO = { latitude: -40.997, longitude: 147.067 };

/** Flat terrain at a fixed elevation, sampled every `spacing` metres. */
function flatProfile(
  elevation: number,
  totalMeters: number,
  spacing = 100,
): TerrainProfile {
  const samples = [];
  for (let d = 0; d <= totalMeters; d += spacing) {
    samples.push({
      position: FROM,
      distanceMeters: d,
      terrainElevationMeters: elevation,
    });
  }
  return { from: FROM, to: TO, samples, spacingMeters: spacing, unresolvedCount: 0 };
}

describe("lineOfSight", () => {
  it("is clear over flat ground well below the sight line", () => {
    const result = lineOfSight(flatProfile(0, 2000), {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    expect(result.clear).toBe(true);
    expect(result.blockedAtMeters).toBeNull();
    expect(result.minimumClearanceMeters).toBeGreaterThan(0);
  });

  it("is blocked by a ridge that rises through the line", () => {
    const profile = flatProfile(0, 2000);
    // A 60 m hill halfway along, well above the 30 m to 0 m sight line.
    profile.samples[10].terrainElevationMeters = 60;
    const result = lineOfSight(profile, {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    expect(result.clear).toBe(false);
    expect(result.blockedAtMeters).toBe(1000);
    expect(result.minimumClearanceMeters).toBeLessThan(0);
  });

  it("reports the smallest clearance and where it occurs", () => {
    const profile = flatProfile(0, 2000);
    profile.samples[5].terrainElevationMeters = 22; // close to, but under, the line
    const result = lineOfSight(profile, {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    expect(result.clear).toBe(true);
    expect(result.minimumClearanceAtMeters).toBe(500);
    // Line is at 22.5 m there, terrain at 22 m, plus a small curvature gain.
    expect(result.minimumClearanceMeters).toBeGreaterThan(0.4);
    expect(result.minimumClearanceMeters).toBeLessThan(0.7);
  });

  it("applies the curvature correction, easing the terrain downwards", () => {
    const profile = flatProfile(0, 10_000, 1000);
    const withCurvature = lineOfSight(profile, {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    const withoutRefraction = lineOfSight(profile, {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
      refractionK: 0,
    });
    // No refraction means the surface falls away further, so more clearance.
    expect(withoutRefraction.minimumClearanceMeters).toBeGreaterThan(
      withCurvature.minimumClearanceMeters,
    );
    const difference =
      withoutRefraction.minimumClearanceMeters - withCurvature.minimumClearanceMeters;
    // The minimum sits at the last interior sample, 9 km out, not at the target.
    expect(withCurvature.minimumClearanceAtMeters).toBe(9000);
    expect(difference).toBeCloseTo(
      curvatureDropMeters(9000, 0) - curvatureDropMeters(9000, 0.13),
      2,
    );
  });

  it("separates curvature from terrain relief", () => {
    // Identical flat terrain at two ranges differs only by the curvature term,
    // which grows with distance and so leaves more clearance further out.
    const near = lineOfSight(flatProfile(0, 1000, 100), {
      observerElevationMeters: 30,
      targetElevationMeters: 30,
    });
    const far = lineOfSight(flatProfile(0, 10_000, 1000), {
      observerElevationMeters: 30,
      targetElevationMeters: 30,
    });
    expect(far.minimumClearanceMeters).toBeGreaterThan(near.minimumClearanceMeters);
  });

  it("measures clearance between the ends, not at them", () => {
    // The target sits on the ground, so including the final sample would make
    // every profile report near-zero clearance regardless of the terrain.
    const result = lineOfSight(flatProfile(0, 2000), {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    expect(result.minimumClearanceAtMeters).toBe(1900);
    expect(result.minimumClearanceMeters).toBeGreaterThan(1);
  });

  it("has no verdict when there is nothing between the ends", () => {
    const result = lineOfSight(flatProfile(0, 1000, 1000), {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    expect(result.incomplete).toBe(true);
    expect(result.clear).toBe(false);
  });

  it("flags an incomplete verdict when samples are missing", () => {
    const profile = flatProfile(0, 2000);
    profile.samples[7].terrainElevationMeters = undefined;
    profile.unresolvedCount = 1;
    const result = lineOfSight(profile, {
      observerElevationMeters: 30,
      targetElevationMeters: 0,
    });
    expect(result.incomplete).toBe(true);
  });

  it("refuses to call an empty profile clear", () => {
    const result = lineOfSight(
      { from: FROM, to: TO, samples: [], spacingMeters: 100, unresolvedCount: 0 },
      { observerElevationMeters: 30, targetElevationMeters: 0 },
    );
    expect(result.clear).toBe(false);
    expect(result.incomplete).toBe(true);
  });

  it("treats a target above the observer as a rising line", () => {
    const profile = flatProfile(0, 2000);
    profile.samples[10].terrainElevationMeters = 25;
    const result = lineOfSight(profile, {
      observerElevationMeters: 10,
      targetElevationMeters: 60,
    });
    // Line is at 35 m halfway, clearing the 25 m rise.
    expect(result.clear).toBe(true);
  });
});
