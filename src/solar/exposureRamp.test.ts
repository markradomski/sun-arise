import { describe, expect, it } from "vitest";
import { colourForHours, colourForMinutes, LEGEND_BANDS } from "./exposureRamp";

/** Perceived lightness, good enough to assert monotonicity. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("exposureRamp", () => {
  it("brightens monotonically with hours of sun", () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => luminance(colourForHours(h)));
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it("is absolute, not normalised per field", () => {
    // The same exposure must produce the same colour regardless of what else
    // the field contains.
    expect(colourForHours(5)).toEqual(colourForHours(5));
    expect(colourForMinutes(300)).toEqual(colourForHours(5));
  });

  it("clamps outside the ramp rather than extrapolating", () => {
    expect(colourForHours(-3)).toEqual(colourForHours(0));
    expect(colourForHours(99)).toEqual(colourForHours(8));
  });

  it("stays within a single hue family", () => {
    // Red >= green >= blue at every step keeps the ramp on one amber hue
    // rather than drifting into a rainbow.
    for (const hours of [0, 2, 4, 6, 8]) {
      const [r, g, b] = colourForHours(hours);
      expect(r).toBeGreaterThanOrEqual(g);
      expect(g).toBeGreaterThanOrEqual(b);
    }
  });

  it("interpolates between stops", () => {
    const low = colourForHours(2);
    const mid = colourForHours(3);
    const high = colourForHours(4);
    expect(luminance(mid)).toBeGreaterThan(luminance(low));
    expect(luminance(mid)).toBeLessThan(luminance(high));
  });

  it("publishes one legend band per reference range", () => {
    expect(LEGEND_BANDS.map((b) => b.label)).toEqual([
      "<2 h",
      "2–4",
      "4–6",
      "6–8",
      "8+",
    ]);
    expect(new Set(LEGEND_BANDS.map((b) => b.css)).size).toBe(LEGEND_BANDS.length);
  });

  it("produces channel values a canvas can use", () => {
    for (const hours of [0, 2.5, 6.25, 12]) {
      for (const channel of colourForHours(hours)) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});
