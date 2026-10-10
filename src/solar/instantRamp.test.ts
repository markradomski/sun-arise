import { describe, expect, it } from "vitest";
import { instantColour, instantOpacity, SHADE_CSS } from "./instantRamp";

describe("instant overlay", () => {
  it("keeps shade solid and sunlit ground light", () => {
    expect(instantOpacity(0)).toBe(1);
    expect(instantOpacity(1)).toBeLessThan(0.5);
  });

  it("falls monotonically with strength", () => {
    let previous = instantOpacity(0);
    for (let s = 0; s <= 1; s += 0.05) {
      const value = instantOpacity(s);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });

  it("clamps outside the range", () => {
    expect(instantOpacity(-1)).toBe(instantOpacity(0));
    expect(instantOpacity(9)).toBe(instantOpacity(1));
  });

  it("maps the same strength to the same colour and opacity every time", () => {
    expect(instantColour(0.5)).toEqual(instantColour(0.5));
    expect(instantOpacity(0.5)).toBe(instantOpacity(0.5));
  });

  it("keeps shade visually distinct from any lit value", () => {
    const shade = instantColour(0);
    for (const strength of [0.05, 0.3, 0.7, 1]) {
      expect(instantColour(strength)).not.toEqual(shade);
    }
    expect(SHADE_CSS).toContain("rgb(");
  });
});
