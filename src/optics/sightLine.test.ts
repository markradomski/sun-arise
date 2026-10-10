import { describe, expect, it } from "vitest";
import {
  analyseSightLine,
  MARGINAL_CLEARANCE_METERS,
  type SightLineEndpoint,
} from "./sightLine";
import type { TerrainProfile } from "./lineOfSight";
import { geodesicPoints, inverseGeodesic } from "./geodesy";
import { planProfileDistances } from "./profilePlan";

const CAMERA_POSITION = { latitude: -41.001528744069276, longitude: 147.07141571573635 };

/** Due north into the bay, the direction the proposed mount faces. */
function targetAt(distanceMeters: number) {
  return geodesicPoints(
    CAMERA_POSITION,
    { latitude: CAMERA_POSITION.latitude + 1, longitude: CAMERA_POSITION.longitude },
    [distanceMeters],
  )[0];
}

/**
 * A profile over the real geodesic, with terrain supplied by a function of
 * distance. Synthetic terrain, real geometry.
 */
function syntheticProfile(
  targetPosition: { latitude: number; longitude: number },
  terrainAt: (distanceMeters: number) => number | undefined,
): TerrainProfile {
  const { distanceMeters } = inverseGeodesic(CAMERA_POSITION, targetPosition);
  const distances = planProfileDistances(distanceMeters);
  const positions = geodesicPoints(CAMERA_POSITION, targetPosition, distances);

  let unresolvedCount = 0;
  const samples = distances.map((distance, index) => {
    const elevation = terrainAt(distance);
    if (elevation === undefined) unresolvedCount += 1;
    return {
      position: positions[index],
      distanceMeters: distance,
      terrainElevationMeters: elevation,
    };
  });

  return {
    from: CAMERA_POSITION,
    to: targetPosition,
    samples,
    spacingMeters: distances[1] ?? 0,
    unresolvedCount,
  };
}

function camera(mountHeightMeters: number, terrain = 25): SightLineEndpoint {
  return {
    position: CAMERA_POSITION,
    terrainElevationMeters: terrain,
    heightMeters: mountHeightMeters,
  };
}

function target(
  position: { latitude: number; longitude: number },
  heightMeters = 0,
  terrain = 0,
): SightLineEndpoint {
  return { position, terrainElevationMeters: terrain, heightMeters };
}

describe("analyseSightLine", () => {
  it("calls flat sea-level ground clear from a mast above it", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("CLEAR");
    expect(analysis.lineOfSight.blockedAtMeters).toBeNull();
    expect(analysis.marginal).toBe(false);
  });

  it("calls the approach to a surface-level target grazing, not marginal", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to, 0),
    );
    // The line descends to meet a target lying on the surface, so the last
    // stretch reads near zero on flat ground with nothing in the way. That is
    // the geometry of the shot, and must not be dressed up as a near miss.
    expect(analysis.grazingApproach).toBe(true);
    expect(analysis.marginal).toBe(false);
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeLessThan(1);
    expect(analysis.lineOfSight.minimumClearanceAtMeters).toBeGreaterThan(1900);
  });

  it("stops calling it grazing once the target is lifted off the surface", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to, 3),
    );
    expect(analysis.grazingApproach).toBe(false);
    expect(analysis.marginal).toBe(false);
  });

  it("reports the distance and bearing of the path it analysed", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to),
    );
    expect(analysis.distanceMeters).toBeCloseTo(2000, 2);
    // Due north, which Vincenty returns as a hair under 360 rather than 0.
    const offNorth = Math.min(
      analysis.initialBearingDeg,
      360 - analysis.initialBearingDeg,
    );
    expect(offNorth).toBeLessThan(1e-6);
  });

  it("looks downwards at a target below the lens", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to),
    );
    // 31 m of lens over a surface target 2 km out: atan(31.27 / 2000), the
    // extra 0.27 m being the curvature drop the target has fallen through.
    expect(analysis.targetElevationAngleDeg).toBeLessThan(0);
    expect(analysis.targetElevationAngleDeg).toBeCloseTo(-0.896, 2);
  });

  it("is obstructed by a hill standing through the line", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => (d > 900 && d < 1100 ? 60 : 0)),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("OBSTRUCTED");
    expect(analysis.lineOfSight.blockedAtMeters).toBeGreaterThan(900);
    expect(analysis.lineOfSight.blockedAtMeters).toBeLessThan(1100);
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeLessThan(0);
  });

  it("is clear but marginal when terrain sits just below the line", () => {
    const to = targetAt(2000);
    // Line falls 31 m to 0 m, so it is near 15.5 m at the midpoint.
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => (d > 950 && d < 1050 ? 15 : 0)),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("CLEAR");
    expect(analysis.marginal).toBe(true);
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeGreaterThan(0);
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeLessThan(
      MARGINAL_CLEARANCE_METERS,
    );
  });

  it("excludes the endpoints, so a target lying on the ground is not self-blocking", () => {
    const to = targetAt(1500);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to, 0, 0),
    );
    // The target is at terrain level: including its own sample would pin the
    // clearance at zero and report every path obstructed.
    expect(analysis.classification).toBe("CLEAR");
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeGreaterThan(0);
    expect(analysis.lineOfSight.minimumClearanceAtMeters).toBeLessThan(
      analysis.distanceMeters,
    );
  });

  // A 25 m rise a quarter of the way out, where the sight line is still high
  // enough that mount height and target height both change the answer.
  const RIDGE = (d: number) => (d > 400 && d < 600 ? 25 : 0);

  it("warns when an obstruction is itself below terrain resolution", () => {
    const to = targetAt(2000);
    // The line sits at 15.5 m midway; terrain a decimetre above it is a
    // measured obstruction, but not one the elevation model can be trusted on.
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => (d > 950 && d < 1050 ? 15.7 : 0)),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("OBSTRUCTED");
    expect(analysis.marginal).toBe(true);
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeGreaterThan(-1);
    expect(analysis.lineOfSight.minimumClearanceMeters).toBeLessThan(0);
  });

  it("does not soften an obstruction that clearly stands through the line", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => (d > 950 && d < 1050 ? 60 : 0)),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("OBSTRUCTED");
    expect(analysis.marginal).toBe(false);
  });

  it("clears a blocking ridge when the target is raised", () => {
    const to = targetAt(2000);

    const onGround = analyseSightLine(
      syntheticProfile(to, RIDGE),
      camera(6),
      target(to, 0),
    );
    const raised = analyseSightLine(
      syntheticProfile(to, RIDGE),
      camera(6),
      target(to, 20),
    );

    expect(onGround.classification).toBe("OBSTRUCTED");
    expect(raised.classification).toBe("CLEAR");
  });

  it("clears the same ridge when the camera is mounted higher", () => {
    const to = targetAt(2000);

    const low = analyseSightLine(syntheticProfile(to, RIDGE), camera(2), target(to));
    const high = analyseSightLine(syntheticProfile(to, RIDGE), camera(25), target(to));

    expect(low.classification).toBe("OBSTRUCTED");
    expect(high.classification).toBe("CLEAR");
    expect(high.lineOfSight.minimumClearanceMeters).toBeGreaterThan(
      low.lineOfSight.minimumClearanceMeters,
    );
  });

  it("gains clearance with distance as the surface curves away", () => {
    const near = targetAt(1000);
    const far = targetAt(10_000);
    const flat = () => 0;

    const nearAnalysis = analyseSightLine(
      syntheticProfile(near, flat),
      camera(6),
      target(near, 0, 0),
    );
    const farAnalysis = analyseSightLine(
      syntheticProfile(far, flat),
      camera(6),
      target(far, 0, 0),
    );

    // Same flat sea, but 10 km out the curve has dropped it ~7 m further away.
    const drop = farAnalysis.lineOfSight.samples.at(-2);
    expect(drop?.apparentTerrainMeters).toBeLessThan(-5);
    expect(nearAnalysis.lineOfSight.samples.at(-2)?.apparentTerrainMeters).toBeGreaterThan(
      -1,
    );
  });

  it("applies refraction only when asked, and says which coefficient it used", () => {
    const to = targetAt(10_000);
    const profile = syntheticProfile(to, () => 0);
    const standard = analyseSightLine(profile, camera(6), target(to));
    const vacuum = analyseSightLine(profile, camera(6), target(to), { refractionK: 0 });

    expect(standard.refractionK).toBeCloseTo(0.13, 6);
    expect(vacuum.refractionK).toBe(0);
    // Without refraction the surface falls away faster, leaving more room.
    expect(vacuum.lineOfSight.minimumClearanceMeters).toBeGreaterThan(
      standard.lineOfSight.minimumClearanceMeters,
    );
  });

  it("is indeterminate, not clear, when terrain is missing and nothing blocked", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => (d > 800 && d < 1200 ? undefined : 0)),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("INDETERMINATE");
    expect(analysis.reason).toBe("MISSING_TERRAIN");
  });

  it("still reports an obstruction it measured despite gaps elsewhere", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => {
        if (d > 1600 && d < 1700) return undefined;
        return d > 900 && d < 1100 ? 60 : 0;
      }),
      camera(6),
      target(to),
    );
    // A gap cannot unfind terrain that was measured standing through the line.
    expect(analysis.classification).toBe("OBSTRUCTED");
  });

  it("never treats absent terrain as flat ground", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => undefined),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("INDETERMINATE");
    expect(analysis.lineOfSight.clear).toBe(false);
  });

  it("is indeterminate for a zero-length path", () => {
    const analysis = analyseSightLine(
      syntheticProfile(CAMERA_POSITION, () => 0),
      camera(6),
      target(CAMERA_POSITION),
    );
    expect(analysis.classification).toBe("INDETERMINATE");
    expect(analysis.distanceMeters).toBe(0);
  });

  it("is indeterminate for a path shorter than terrain resolution", () => {
    const to = targetAt(8);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6),
      target(to),
    );
    expect(analysis.classification).toBe("INDETERMINATE");
    expect(analysis.reason).toMatch(/PATH_TOO_SHORT|NO_PROFILE/);
  });

  it("gives the chart and the verdict the same numbers", () => {
    const to = targetAt(3000);
    const analysis = analyseSightLine(
      syntheticProfile(to, (d) => (d > 1000 && d < 1200 ? 40 : 2)),
      camera(6),
      target(to),
    );

    // The series the chart plots must contain the exact minimum the panel
    // prints, at the exact distance it names.
    const plotted = analysis.lineOfSight.samples.filter(
      (s) => s.interior && s.clearanceMeters !== undefined,
    );
    const lowest = plotted.reduce((best, s) =>
      (s.clearanceMeters ?? 0) < (best.clearanceMeters ?? 0) ? s : best,
    );
    expect(lowest.clearanceMeters).toBe(analysis.lineOfSight.minimumClearanceMeters);
    expect(lowest.distanceMeters).toBe(analysis.lineOfSight.minimumClearanceAtMeters);

    // And the obstruction the chart would shade is the one that was reported.
    const firstBlocked = plotted.find((s) => (s.clearanceMeters ?? 0) < 0);
    expect(firstBlocked?.distanceMeters).toBe(analysis.lineOfSight.blockedAtMeters);
  });

  it("keeps the sight line straight between the two endpoint elevations", () => {
    const to = targetAt(2000);
    const analysis = analyseSightLine(
      syntheticProfile(to, () => 0),
      camera(6, 25),
      target(to, 4, 1),
    );
    const samples = analysis.lineOfSight.samples;
    expect(samples[0].lineElevationMeters).toBeCloseTo(31, 6);
    expect(samples.at(-1)?.lineElevationMeters).toBeCloseTo(5, 6);
    expect(analysis.observerElevationMeters).toBeCloseTo(31, 6);
    expect(analysis.targetElevationMeters).toBeCloseTo(5, 6);
  });
});
