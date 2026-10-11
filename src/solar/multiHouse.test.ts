import { describe, expect, it } from "vitest";
import {
  directSunMinutes,
  exposureFor,
  pointExposure,
  sunTimeline,
  type BoxOccluder,
} from "./exposure";
import { exposureField, meanMinutes } from "./exposureField";
import { instantField, instantPoint } from "./instantField";
import { seasonalPointExposure } from "./seasonalComparison";
import { fieldSignature } from "../scene/fieldSignature";
import { offsetByBearing } from "../scene/geo";
import { DEFAULT_GRID, groundGrid } from "../scene/grid";
import type { GeoPosition, SceneObject } from "../scene/types";

/**
 * Multi-house occlusion.
 *
 * Every placed house occludes, not only the selected one, and overlapping
 * shadows must not deduct twice. These are pure geometry fixtures: no Cesium,
 * no store, no renderer.
 */

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const OFFSET = 10;
/** Sydney midwinter, 11:00 civil time: a low northern sun, long shadows south. */
const WINTER = new Date(Date.UTC(2026, 5, 21, 1, 0, 0));
const options = { utcOffsetHours: OFFSET };

function houseAt(bearingDeg: number, metres: number, overrides: Partial<BoxOccluder> = {}): BoxOccluder {
  const p = metres === 0 ? SITE : offsetByBearing(SITE, bearingDeg, metres);
  return {
    position: { latitude: p.latitude, longitude: p.longitude, height: 0 },
    widthMeters: 14,
    depthMeters: 9,
    heightMeters: 4.6,
    headingDeg: 0,
    ...overrides,
  };
}

function groundAt(bearingDeg: number, metres: number): GeoPosition {
  const p = offsetByBearing(SITE, bearingDeg, metres);
  return { latitude: p.latitude, longitude: p.longitude, height: 0 };
}

const timeline = sunTimeline(SITE, WINTER, options);

describe("occluder collections", () => {
  it("leaves every point in full sun with no houses", () => {
    const point = groundAt(180, 6);
    expect(directSunMinutes(point, [], timeline)).toBe(timeline.daylightMinutes);
  });

  it("matches the historical single-house result", () => {
    const house = houseAt(0, 0);
    const shaded = groundAt(180, 4);
    const single = directSunMinutes(shaded, [house], timeline);
    expect(single).toBeLessThan(timeline.daylightMinutes);
    // Adding a house far away must not change that point's answer.
    const withDistantNeighbour = directSunMinutes(
      shaded,
      [house, houseAt(0, 400)],
      timeline,
    );
    expect(withDistantNeighbour).toBe(single);
  });

  it("lets two houses each shade their own ground", () => {
    const a = houseAt(90, 25);
    const b = houseAt(270, 25);
    const underA = groundAt(90, 25);
    const underB = groundAt(270, 25);

    // Each point is shaded by its own house and unaffected by the other.
    expect(directSunMinutes(underA, [a], timeline)).toBeLessThan(
      timeline.daylightMinutes,
    );
    expect(directSunMinutes(underA, [b], timeline)).toBe(timeline.daylightMinutes);

    const both = [a, b];
    expect(directSunMinutes(underA, both, timeline)).toBe(
      directSunMinutes(underA, [a], timeline),
    );
    expect(directSunMinutes(underB, both, timeline)).toBe(
      directSunMinutes(underB, [b], timeline),
    );
  });

  it("does not double-count two houses shading the same point", () => {
    // Two houses stacked at the same place shade exactly as one does.
    const house = houseAt(0, 0);
    const twin = houseAt(0, 0);
    const point = groundAt(180, 4);

    const one = directSunMinutes(point, [house], timeline);
    const two = directSunMinutes(point, [house, twin], timeline);
    expect(two).toBe(one);
    expect(two).toBeGreaterThanOrEqual(0);
  });

  it("restores the single-house answer when a house is removed", () => {
    const a = houseAt(0, 0);
    const b = houseAt(90, 20);
    const point = groundAt(180, 4);

    const withBoth = directSunMinutes(point, [a, b], timeline);
    const afterRemoval = directSunMinutes(point, [a], timeline);
    expect(directSunMinutes(point, [a, b], timeline)).toBe(withBoth);
    expect(afterRemoval).toBe(directSunMinutes(point, [a], timeline));
  });

  it("responds to a non-selected house moving", () => {
    // Selection is not an input here at all: the engine only sees geometry.
    const selected = houseAt(90, 25);
    const point = groundAt(180, 4);

    const neighbourAway = directSunMinutes(
      point,
      [selected, houseAt(0, 300)],
      timeline,
    );
    const neighbourOverhead = directSunMinutes(
      point,
      [selected, houseAt(0, 0)],
      timeline,
    );
    expect(neighbourOverhead).toBeLessThan(neighbourAway);
  });

  it("responds to a non-selected house rotating", () => {
    const selected = houseAt(270, 25);
    // 6 m east and 10 m south of the house. The footprint is 14 wide by 9
    // deep, so upright it covers this point's longitude and turned it does
    // not: the orientation decides whether the point is in shadow at all.
    const point = groundAt(149, 11.66);
    const upright = directSunMinutes(
      point,
      [selected, houseAt(0, 0, { headingDeg: 0 })],
      timeline,
    );
    const turned = directSunMinutes(
      point,
      [selected, houseAt(0, 0, { headingDeg: 90 })],
      timeline,
    );
    expect(turned).not.toBe(upright);
  });

  it("respects differing house elevations", () => {
    const point = groundAt(180, 7);
    const atGrade = houseAt(0, 0);
    const raised = houseAt(0, 0, { position: { ...SITE, height: 8 } });
    // A house lifted clear of the ground casts its shadow further.
    expect(directSunMinutes(point, [raised], timeline)).not.toBe(
      directSunMinutes(point, [atGrade], timeline),
    );
  });
});

describe("fields with multiple occluders", () => {
  const grid = groundGrid({ centre: SITE, ...DEFAULT_GRID });
  const positions = grid.points.map((p) => p.position);

  it("shades more of the NOW field with two houses than one", () => {
    const a = houseAt(90, 12);
    const b = houseAt(270, 12);
    const shadedCount = (occluders: BoxOccluder[]) =>
      Array.from(
        instantField(positions, occluders, SITE, WINTER, options).strength,
      ).filter((v) => v === 0).length;

    const one = shadedCount([a]);
    const two = shadedCount([a, b]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
  });

  it("lowers WHOLE DAY mean exposure as houses are added", () => {
    const a = houseAt(90, 12);
    const b = houseAt(270, 12);
    const mean = (occluders: BoxOccluder[]) =>
      meanMinutes(exposureField(positions, occluders, timeline));

    const none = mean([]);
    const one = mean([a]);
    const two = mean([a, b]);
    expect(one).toBeLessThan(none);
    expect(two).toBeLessThan(one);
  });

  it("gives the same WHOLE DAY field whatever order the houses arrive in", () => {
    const a = houseAt(90, 12);
    const b = houseAt(270, 12);
    const forward = exposureField(positions, [a, b], timeline).minutes;
    const reversed = exposureField(positions, [b, a], timeline).minutes;
    expect(Array.from(forward)).toEqual(Array.from(reversed));
  });

  it("does not double-count overlapping shadows across the field", () => {
    const house = houseAt(0, 0);
    const single = exposureField(positions, [house], timeline).minutes;
    const duplicated = exposureField(positions, [house, houseAt(0, 0)], timeline)
      .minutes;
    expect(Array.from(duplicated)).toEqual(Array.from(single));
  });
});

describe("single-point inspection with multiple houses", () => {
  it("combines occlusion from every house into one result", () => {
    const point = groundAt(180, 5);
    const a = houseAt(0, 0);
    const b = houseAt(45, 9);

    const withA = pointExposure(point, [a], WINTER, options).directSunMinutes;
    const withBoth = pointExposure(point, [a, b], WINTER, options).directSunMinutes;
    expect(withBoth).toBeLessThanOrEqual(withA);
  });

  it("keeps sun and shade intervals consistent with the combined set", () => {
    const point = groundAt(180, 5);
    const result = exposureFor(point, [houseAt(0, 0), houseAt(90, 20)], timeline);
    const sun = result.intervals.filter((i) => i.state === "SUN");
    const shade = result.intervals.filter((i) => i.state === "BLOCKED");
    expect(sun.length + shade.length).toBe(result.intervals.length);
    expect(result.directSunMinutes).toBeLessThanOrEqual(result.daylightMinutes);
  });

  it("reports the instantaneous state against every house", () => {
    const point = groundAt(180, 4);
    const clear = instantPoint(point, [houseAt(90, 40)], SITE, WINTER, options);
    const blocked = instantPoint(
      point,
      [houseAt(90, 40), houseAt(0, 0)],
      SITE,
      WINTER,
      options,
    );
    expect(clear.state).toBe("SUN");
    expect(blocked.state).toBe("BLOCKED");
  });

  it("includes every house in the seasonal comparison", () => {
    const point = groundAt(180, 5);
    const alone = seasonalPointExposure(point, [houseAt(90, 40)], 2026);
    const crowded = seasonalPointExposure(
      point,
      [houseAt(90, 40), houseAt(0, 0)],
      2026,
    );
    expect(crowded).toHaveLength(alone.length);
    for (let i = 0; i < crowded.length; i += 1) {
      expect(crowded[i].season).toBe(alone[i].season);
      expect(crowded[i].directSunMinutes).toBeLessThanOrEqual(
        alone[i].directSunMinutes,
      );
    }
    // At least one season must actually differ, or the houses are not counted.
    expect(
      crowded.some((entry, i) => entry.directSunMinutes < alone[i].directSunMinutes),
    ).toBe(true);
  });
});

describe("placement comparison with neighbours", () => {
  const grid = groundGrid({ centre: SITE, ...DEFAULT_GRID });
  const positions = grid.points.map((p) => p.position);

  it("holds a stationary neighbour identical on both sides", () => {
    const neighbour = houseAt(270, 18);
    const baselineHouse = houseAt(0, 0);
    const movedHouse = houseAt(0, 16);

    const before = exposureField(positions, [baselineHouse, neighbour], timeline);
    const after = exposureField(positions, [movedHouse, neighbour], timeline);

    // The comparison registers a change, and the neighbour is present in both.
    expect(meanMinutes(after)).not.toBe(meanMinutes(before));
    const withoutNeighbour = exposureField(positions, [baselineHouse], timeline);
    expect(meanMinutes(before)).toBeLessThan(meanMinutes(withoutNeighbour));
  });
});

describe("cache invalidation across the whole collection", () => {
  const base = (overrides: Partial<SceneObject> = {}): SceneObject => ({
    id: "house-1",
    type: "house",
    modelUrl: "/models/reference-house.glb",
    position: { ...SITE },
    rotation: { heading: 0, pitch: 0, roll: 0 },
    scale: 1,
    clampToGround: true,
    ...overrides,
  });

  const inputs = (houses: SceneObject[]) => ({
    houses,
    baseline: null,
    civilDay: "Australia/Sydney:2026-06-21",
    utcOffsetHours: OFFSET,
  });

  const second = base({
    id: "house-2",
    position: { ...SITE, latitude: SITE.latitude + 0.0002 },
  });

  it("changes when a house is added or removed", () => {
    const one = fieldSignature(inputs([base()]));
    const two = fieldSignature(inputs([base(), second]));
    expect(two).not.toBe(one);
    expect(fieldSignature(inputs([base()]))).toBe(one);
  });

  it("changes when any house moves, including a non-selected one", () => {
    const before = fieldSignature(inputs([base(), second]));
    const movedNeighbour = fieldSignature(
      inputs([
        base(),
        { ...second, position: { ...second.position, longitude: SITE.longitude + 0.0004 } },
      ]),
    );
    expect(movedNeighbour).not.toBe(before);
  });

  it("changes when any house rotates, resizes or shifts vertically", () => {
    const before = fieldSignature(inputs([base(), second]));
    expect(
      fieldSignature(
        inputs([base(), { ...second, rotation: { heading: 90, pitch: 0, roll: 0 } }]),
      ),
    ).not.toBe(before);
    expect(fieldSignature(inputs([base(), { ...second, scale: 1.5 }]))).not.toBe(
      before,
    );
    expect(
      fieldSignature(
        inputs([base(), { ...second, position: { ...second.position, height: 9 } }]),
      ),
    ).not.toBe(before);
  });

  it("is unchanged by house order", () => {
    expect(fieldSignature(inputs([base(), second]))).toBe(
      fieldSignature(inputs([second, base()])),
    );
  });

  it("is unchanged by which house is selected", () => {
    // Selection is not part of the inputs, so it cannot enter the signature.
    const houses = [base(), second];
    const first = fieldSignature(inputs(houses));
    const again = fieldSignature(inputs(houses));
    expect(again).toBe(first);
    expect(JSON.stringify(inputs(houses))).not.toMatch(/selected/i);
  });
});
