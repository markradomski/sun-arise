import { describe, expect, it } from "vitest";
import { fieldBounds, MAX_FIELD_SAMPLES } from "./fieldBounds";
import { groundGrid } from "./grid";
import { offsetByBearing } from "./geo";
import { inverseGeodesic } from "../optics/geodesy";
import type { GeoPosition, SceneObject } from "./types";

const SITE: GeoPosition = { latitude: -33.870993, longitude: 151.215753, height: 0 };
const SPACING = 2;

function house(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "house-1",
    type: "house",
    modelUrl: "/models/reference-house.glb",
    position: { ...SITE },
    rotation: { heading: 0, pitch: 0, roll: 0 },
    scale: 1,
    clampToGround: true,
    ...overrides,
  };
}

function houseAt(id: string, bearingDeg: number, metres: number, heading = 0): SceneObject {
  const p = offsetByBearing(SITE, bearingDeg, metres);
  return house({
    id,
    position: { latitude: p.latitude, longitude: p.longitude, height: 0 },
    rotation: { heading, pitch: 0, roll: 0 },
  });
}

const options = { spacingMeters: SPACING };

/** Metres east and north of the field centre, by geodesic. */
function offsetFromCentre(bounds: { centre: { latitude: number; longitude: number } }, position: GeoPosition) {
  const { distanceMeters, initialBearingDeg } = inverseGeodesic(bounds.centre, position);
  const bearing = (initialBearingDeg * Math.PI) / 180;
  return {
    east: distanceMeters * Math.sin(bearing),
    north: distanceMeters * Math.cos(bearing),
  };
}

function covers(bounds: NonNullable<ReturnType<typeof fieldBounds>>, position: GeoPosition) {
  const { east, north } = offsetFromCentre(bounds, position);
  return (
    Math.abs(east) <= bounds.extentEastMeters / 2 &&
    Math.abs(north) <= bounds.extentNorthMeters / 2
  );
}

describe("fieldBounds", () => {
  it("returns nothing when there are no houses", () => {
    expect(fieldBounds([], [], options)).toBeNull();
  });

  it("keeps the familiar 60 m square for a single house", () => {
    const bounds = fieldBounds([house()], [], options)!;
    expect(bounds.extentEastMeters).toBe(60);
    expect(bounds.extentNorthMeters).toBe(60);
    expect(bounds.clamped).toBe(false);
    expect(bounds.centre.latitude).toBeCloseTo(SITE.latitude, 6);
    expect(bounds.centre.longitude).toBeCloseTo(SITE.longitude, 6);
    // The same 31 x 31 = 961 samples the field has always used.
    expect(bounds.sampleCount).toBe(961);
  });

  it("covers both houses when they are close together", () => {
    const houses = [house(), houseAt("house-2", 90, 20)];
    const bounds = fieldBounds(houses, [], options)!;
    for (const h of houses) expect(covers(bounds, h.position)).toBe(true);
  });

  it("covers both houses when they are further apart than the old field", () => {
    const houses = [house(), houseAt("house-2", 90, 70)];
    const bounds = fieldBounds(houses, [], options)!;
    expect(bounds.extentEastMeters).toBeGreaterThan(60);
    for (const h of houses) expect(covers(bounds, h.position)).toBe(true);
  });

  it("covers houses 150 m apart", () => {
    const houses = [house(), houseAt("house-2", 90, 150)];
    const bounds = fieldBounds(houses, [], options)!;
    for (const h of houses) expect(covers(bounds, h.position)).toBe(true);
    expect(bounds.clamped).toBe(false);
  });

  it("covers three or more houses spread in different directions", () => {
    const houses = [
      house(),
      houseAt("house-2", 90, 80),
      houseAt("house-3", 200, 60),
      houseAt("house-4", 315, 45),
    ];
    const bounds = fieldBounds(houses, [], options)!;
    for (const h of houses) expect(covers(bounds, h.position)).toBe(true);
  });

  it("widens for a rotated footprint", () => {
    // The reference house is 14 wide by 9 deep, so turning it 90 degrees
    // swaps which axis needs the room.
    const upright = fieldBounds([house()], [], { ...options, minimumExtentMeters: 0 })!;
    const turned = fieldBounds([houseAt("house-1", 0, 0, 90)], [], {
      ...options,
      minimumExtentMeters: 0,
    })!;
    expect(upright.extentEastMeters).toBeGreaterThan(upright.extentNorthMeters);
    expect(turned.extentNorthMeters).toBeGreaterThan(turned.extentEastMeters);
  });

  it("keeps margin around the outermost footprints for shadows", () => {
    const houses = [house(), houseAt("house-2", 90, 100)];
    const bounds = fieldBounds(houses, [], options)!;
    // Each house keeps ground beyond its own footprint, not just its centre.
    const east = offsetFromCentre(bounds, houses[1].position).east;
    expect(bounds.extentEastMeters / 2 - east).toBeGreaterThan(20);
  });

  it("grows when a house is added and shrinks when it is removed", () => {
    const one = fieldBounds([house()], [], options)!;
    const two = fieldBounds([house(), houseAt("house-2", 90, 90)], [], options)!;
    expect(two.extentEastMeters).toBeGreaterThan(one.extentEastMeters);
    const removed = fieldBounds([house()], [], options)!;
    expect(removed.extentEastMeters).toBe(one.extentEastMeters);
  });

  it("follows a house that moves, whether or not it is selected", () => {
    const near = fieldBounds([house(), houseAt("house-2", 90, 30)], [], options)!;
    const far = fieldBounds([house(), houseAt("house-2", 90, 120)], [], options)!;
    expect(far.extentEastMeters).toBeGreaterThan(near.extentEastMeters);
  });

  it("is unaffected by house order", () => {
    const a = house();
    const b = houseAt("house-2", 90, 90);
    const forward = fieldBounds([a, b], [], options)!;
    const reversed = fieldBounds([b, a], [], options)!;
    expect(reversed.extentEastMeters).toBeCloseTo(forward.extentEastMeters, 6);
    expect(reversed.extentNorthMeters).toBeCloseTo(forward.extentNorthMeters, 6);
    expect(reversed.centre.latitude).toBeCloseTo(forward.centre.latitude, 9);
    expect(reversed.centre.longitude).toBeCloseTo(forward.centre.longitude, 9);
  });

  it("takes a saved baseline placement into the same field", () => {
    const houses = [house()];
    const baselineAway = offsetByBearing(SITE, 90, 120);
    const bounds = fieldBounds(
      houses,
      [{ latitude: baselineAway.latitude, longitude: baselineAway.longitude }],
      options,
    )!;
    expect(
      covers(bounds, {
        latitude: baselineAway.latitude,
        longitude: baselineAway.longitude,
        height: 0,
      }),
    ).toBe(true);
    expect(covers(bounds, SITE)).toBe(true);
  });

  it("covers a long east-west spread without clamping, because it is shallow", () => {
    // 2 km apart east-west needs only a 60 m band to the north, so it fits
    // the budget comfortably: the rectangle is what makes this affordable.
    const houses = [house(), houseAt("house-2", 90, 2000)];
    const bounds = fieldBounds(houses, [], options)!;
    expect(bounds.clamped).toBe(false);
    expect(bounds.sampleCount).toBeLessThanOrEqual(MAX_FIELD_SAMPLES);
    for (const h of houses) expect(covers(bounds, h.position)).toBe(true);
  });

  it("clips rather than thinning when houses are spread beyond the budget", () => {
    // Diagonal, so both axes are large and the area genuinely cannot fit.
    const houses = [house(), houseAt("house-2", 45, 5000)];
    const bounds = fieldBounds(houses, [], options)!;
    expect(bounds.clamped).toBe(true);
    expect(bounds.sampleCount).toBeLessThanOrEqual(MAX_FIELD_SAMPLES);
    expect(bounds.droppedEastMeters).toBeGreaterThan(0);
    // Sampling density is never traded away to make an oversized field fit.
    const grid = groundGrid({
      centre: bounds.centre,
      extentMeters: bounds.extentEastMeters,
      extentNorthMeters: bounds.extentNorthMeters,
      spacingMeters: SPACING,
    });
    expect(grid.spacingMeters).toBe(SPACING);
  });

  it("stays within the sample budget across a range of spreads", () => {
    for (const metres of [50, 200, 400, 800, 5000]) {
      const bounds = fieldBounds([house(), houseAt("house-2", 45, metres)], [], options)!;
      expect(bounds.sampleCount).toBeLessThanOrEqual(MAX_FIELD_SAMPLES);
    }
  });

  it("builds a grid at the requested spacing and geographic position", () => {
    const houses = [house(), houseAt("house-2", 90, 100)];
    const bounds = fieldBounds(houses, [], options)!;
    const grid = groundGrid({
      centre: bounds.centre,
      extentMeters: bounds.extentEastMeters,
      extentNorthMeters: bounds.extentNorthMeters,
      spacingMeters: SPACING,
    });

    expect(grid.points).toHaveLength(grid.cols * grid.rows);
    expect(grid.cols * grid.rows).toBe(bounds.sampleCount);

    // Neighbouring samples really are one spacing apart on the ground.
    const first = grid.points[0].position;
    const nextEast = grid.points[1].position;
    expect(inverseGeodesic(first, nextEast).distanceMeters).toBeCloseTo(SPACING, 1);

    // Every house falls inside the grid's own extent.
    for (const h of houses) {
      const { east, north } = offsetFromCentre(bounds, h.position);
      expect(Math.abs(east)).toBeLessThanOrEqual(grid.extentMeters / 2);
      expect(Math.abs(north)).toBeLessThanOrEqual(grid.extentNorthMeters / 2);
    }
  });

  it("uses a rectangle rather than paying for empty ground", () => {
    // Houses spread east-west should not force a tall field to the north.
    const bounds = fieldBounds([house(), houseAt("house-2", 90, 200)], [], options)!;
    expect(bounds.extentEastMeters).toBeGreaterThan(bounds.extentNorthMeters * 2);
    const square = Math.round(bounds.extentEastMeters / SPACING) ** 2;
    expect(bounds.sampleCount).toBeLessThan(square / 2);
  });
});
