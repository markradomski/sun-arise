import { describe, expect, it } from "vitest";
import { FEATHER_START, featherAlpha } from "./featherMask";

describe("featherMask", () => {
  it("leaves the middle of the field at full opacity", () => {
    expect(featherAlpha(0.5, 0.5)).toBe(1);
    // Anywhere inside the held fraction, in any direction.
    const inside = 0.5 + (FEATHER_START / 2) * 0.95;
    expect(featherAlpha(inside, 0.5)).toBe(1);
    expect(featherAlpha(0.5, inside)).toBe(1);
  });

  it("reaches zero at the perimeter", () => {
    expect(featherAlpha(0, 0.5)).toBe(0);
    expect(featherAlpha(1, 0.5)).toBe(0);
    expect(featherAlpha(0.5, 0)).toBe(0);
    expect(featherAlpha(0.5, 1)).toBe(0);
  });

  it("clears the corners before the edge midpoints", () => {
    // A square mask would still be opaque diagonally inwards from a corner;
    // the rounded metric must have faded out there already.
    expect(featherAlpha(1, 1)).toBe(0);
    expect(featherAlpha(0, 1)).toBe(0);
    expect(featherAlpha(0.93, 0.93)).toBe(0);
    expect(featherAlpha(0.93, 0.5)).toBeGreaterThan(0);
  });

  it("holds roughly three quarters of the field at full opacity", () => {
    expect(FEATHER_START).toBeGreaterThanOrEqual(0.75);
    expect(FEATHER_START).toBeLessThanOrEqual(0.8);
  });

  it("falls off monotonically towards the edge", () => {
    let previous = featherAlpha(0.5, 0.5);
    for (let u = 0.5; u <= 1.0001; u += 0.02) {
      const alpha = featherAlpha(u, 0.5);
      expect(alpha).toBeLessThanOrEqual(previous + 1e-9);
      previous = alpha;
    }
    expect(previous).toBe(0);
  });

  it("is symmetric about both axes", () => {
    for (const [u, v] of [
      [0.2, 0.35],
      [0.1, 0.9],
      [0.45, 0.05],
    ]) {
      expect(featherAlpha(1 - u, v)).toBeCloseTo(featherAlpha(u, v), 12);
      expect(featherAlpha(u, 1 - v)).toBeCloseTo(featherAlpha(u, v), 12);
    }
  });

  it("depends on position alone", () => {
    // The mask takes no exposure value, so a two-hour and a fourteen-hour cell
    // at the same place are treated identically by construction. This pins the
    // signature against a future change that would couple them.
    expect(featherAlpha.length).toBe(2);
    expect(featherAlpha(0.3, 0.7)).toBe(featherAlpha(0.3, 0.7));
  });

  it("stays within the unit range everywhere", () => {
    for (let u = 0; u <= 1.0001; u += 0.05) {
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const alpha = featherAlpha(u, v);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});
