import { describe, expect, it } from "vitest";
import { DEFAULT_FEATHER_METERS, featherAlpha } from "./featherMask";

/**
 * The feather is a fixed distance in metres, not a fraction of the field.
 * These pin that down, because the proportional version faded an adaptive
 * field over tens of metres while a small one faded over a few.
 */

const F = DEFAULT_FEATHER_METERS;

/** Half extents of the original 60 m square field. */
const SMALL = { halfEast: 30, halfNorth: 30 };
/** A long, shallow field covering two houses 200 m apart east-west. */
const WIDE = { halfEast: 120, halfNorth: 30 };

function alpha(
  east: number,
  north: number,
  field: { halfEast: number; halfNorth: number },
  feather = F,
) {
  return featherAlpha(east, north, field.halfEast, field.halfNorth, feather);
}

describe("featherAlpha", () => {
  it("is solid in the middle of the field", () => {
    expect(alpha(0, 0, SMALL)).toBe(1);
    expect(alpha(0, 0, WIDE)).toBe(1);
  });

  it("is clear at the perimeter", () => {
    expect(alpha(30, 0, SMALL)).toBe(0);
    expect(alpha(0, 30, SMALL)).toBe(0);
    expect(alpha(120, 0, WIDE)).toBe(0);
    expect(alpha(0, 30, WIDE)).toBe(0);
  });

  it("fades over the same distance whatever the field size", () => {
    // Measured inward from the east edge, the two fields must agree exactly.
    for (const inset of [0, 2, 4, 6, 8, 12]) {
      const small = alpha(SMALL.halfEast - inset, 0, SMALL);
      const wide = alpha(WIDE.halfEast - inset, 0, WIDE);
      expect(wide).toBeCloseTo(small, 10);
    }
  });

  it("fades over the same distance on a rectangle's long and short edges", () => {
    for (const inset of [0, 3, 6, 8, 20]) {
      const alongEast = alpha(WIDE.halfEast - inset, 0, WIDE);
      const alongNorth = alpha(0, WIDE.halfNorth - inset, WIDE);
      expect(alongNorth).toBeCloseTo(alongEast, 10);
    }
  });

  it("is solid everywhere further in than the feather", () => {
    expect(alpha(WIDE.halfEast - F - 0.5, 0, WIDE)).toBe(1);
    expect(alpha(0, WIDE.halfNorth - F - 0.5, WIDE)).toBe(1);
    expect(alpha(SMALL.halfEast - F - 0.5, 0, SMALL)).toBe(1);
  });

  it("falls monotonically towards each edge", () => {
    let previous = 1;
    for (let east = WIDE.halfEast - F; east <= WIDE.halfEast; east += 0.5) {
      const value = alpha(east, 0, WIDE);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
    expect(previous).toBe(0);
  });

  it("rounds the corners, clearing them before the edge midpoints", () => {
    // A corner is further from the inner rectangle than an edge at the same
    // inset, so it fades first and no square corner survives.
    const corner = alpha(SMALL.halfEast - 2, SMALL.halfNorth - 2, SMALL);
    const edge = alpha(SMALL.halfEast - 2, 0, SMALL);
    expect(corner).toBeLessThan(edge);
    expect(alpha(SMALL.halfEast, SMALL.halfNorth, SMALL)).toBe(0);
  });

  it("is symmetric about both axes", () => {
    for (const [east, north] of [
      [20, 10],
      [100, 25],
      [5, 29],
    ]) {
      const reference = alpha(east, north, WIDE);
      expect(alpha(-east, north, WIDE)).toBeCloseTo(reference, 12);
      expect(alpha(east, -north, WIDE)).toBeCloseTo(reference, 12);
      expect(alpha(-east, -north, WIDE)).toBeCloseTo(reference, 12);
    }
  });

  it("handles a field narrower than two feathers without inverting", () => {
    const tiny = { halfEast: 3, halfNorth: 3 };
    expect(alpha(0, 0, tiny)).toBe(1);
    expect(alpha(3, 0, tiny)).toBe(0);
    for (let east = 0; east <= 3; east += 0.25) {
      const value = alpha(east, 0, tiny);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("handles a degenerate field", () => {
    expect(featherAlpha(0, 0, 0, 0, F)).toBe(1);
    expect(featherAlpha(1, 0, 0, 0, F)).toBe(0);
  });

  it("stays within the unit range across a whole field", () => {
    for (let east = -WIDE.halfEast; east <= WIDE.halfEast; east += 7) {
      for (let north = -WIDE.halfNorth; north <= WIDE.halfNorth; north += 3) {
        const value = alpha(east, north, WIDE);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps a usable solid core on the original 60 m field", () => {
    // Most of the single-house field must still be at full strength, or the
    // fade has eaten the analysis.
    let solid = 0;
    let total = 0;
    for (let east = -30; east <= 30; east += 1) {
      for (let north = -30; north <= 30; north += 1) {
        total += 1;
        if (alpha(east, north, SMALL) === 1) solid += 1;
      }
    }
    expect(solid / total).toBeGreaterThan(0.5);
  });
});
