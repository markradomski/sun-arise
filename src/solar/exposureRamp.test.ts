import { describe, expect, it } from "vitest";
import {
  colourForHours,
  colourForMinutes,
  LEGEND_GRADIENT_CSS,
  LEGEND_TICKS,
  opacityForHours,
  opacityForMinutes,
} from "./exposureRamp";

/** Perceived lightness, good enough to assert monotonicity. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("exposureRamp", () => {
  it("brightens monotonically with hours of sun", () => {
    const steps = [0, 2, 4, 6, 8, 10, 12, 14].map((h) => luminance(colourForHours(h)));
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
    expect(colourForHours(99)).toEqual(colourForHours(14));
  });

  it("runs cool in shade and warm in full sun", () => {
    const [shadeR, , shadeB] = colourForHours(0);
    const [sunR, , sunB] = colourForHours(14);
    expect(shadeB).toBeGreaterThan(shadeR);
    expect(sunR).toBeGreaterThan(sunB);
  });

  it("never reaches a red that would read as heat", () => {
    // The warm end must stay amber/yellow, so green never collapses against
    // red anywhere along the ramp.
    for (let hours = 0; hours <= 14; hours += 0.25) {
      const [r, g] = colourForHours(hours);
      expect(g).toBeGreaterThan(r * 0.5);
    }
  });

  it("keeps summer and winter distinguishable above eight hours", () => {
    // Sydney midsummer against midwinter: both exceed 8 h, and the ramp must
    // still separate them rather than saturating.
    expect(luminance(colourForHours(14.25))).toBeGreaterThan(
      luminance(colourForHours(9.75)),
    );
  });

  it("interpolates between stops", () => {
    const low = colourForHours(2);
    const mid = colourForHours(3);
    const high = colourForHours(4);
    expect(luminance(mid)).toBeGreaterThan(luminance(low));
    expect(luminance(mid)).toBeLessThan(luminance(high));
  });

  it("publishes one legend tick per reference hour", () => {
    expect(LEGEND_TICKS.map((t) => t.label)).toEqual([
      "2",
      "4",
      "6",
      "8",
      "10",
      "12",
      "14+",
    ]);
  });

  it("places legend ticks at their true position on the scale", () => {
    for (const tick of LEGEND_TICKS) {
      const hours = Number.parseFloat(tick.label);
      expect(tick.position).toBeCloseTo(hours / 14, 6);
    }
  });

  it("builds the legend gradient from the ramp's own stops", () => {
    // The legend must not be able to drift from the colours the map draws.
    for (const hours of [0, 14]) {
      const [r, g, b] = colourForHours(hours);
      expect(LEGEND_GRADIENT_CSS).toContain(`rgb(${r}, ${g}, ${b})`);
    }
    expect(LEGEND_GRADIENT_CSS).toContain("0.0%");
    expect(LEGEND_GRADIENT_CSS).toContain("100.0%");
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

describe("opacity", () => {
  it("is solid in shade and light in full sun", () => {
    expect(opacityForHours(0)).toBe(1);
    expect(opacityForHours(14)).toBeLessThan(0.5);
  });

  it("falls monotonically as hours rise", () => {
    let previous = opacityForHours(0);
    for (let hours = 0; hours <= 14; hours += 0.5) {
      const value = opacityForHours(hours);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });

  it("clamps outside the scale rather than extrapolating", () => {
    expect(opacityForHours(-3)).toBe(opacityForHours(0));
    expect(opacityForHours(40)).toBe(opacityForHours(14));
  });

  it("depends on the value alone, not on the field", () => {
    // The same exposure must look the same however large the field has grown
    // or how many houses are in it.
    expect(opacityForHours(6)).toBe(opacityForHours(6));
    expect(opacityForMinutes(360)).toBe(opacityForHours(6));
  });

  it("never disappears entirely", () => {
    for (const hours of [0, 3, 7, 11, 14]) {
      expect(opacityForHours(hours)).toBeGreaterThan(0.2);
      expect(opacityForHours(hours)).toBeLessThanOrEqual(1);
    }
  });
});
