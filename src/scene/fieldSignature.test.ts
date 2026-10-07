import { describe, expect, it } from "vitest";
import { fieldSignature, type FieldInputs } from "./fieldSignature";
import type { BoxOccluder } from "../solar/exposure";
import type { SceneObject } from "./types";

const SITE = { latitude: -33.870993, longitude: 151.215753, height: 0 };

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

function occluder(overrides: Partial<BoxOccluder> = {}): BoxOccluder {
  return {
    position: { ...SITE },
    widthMeters: 14,
    depthMeters: 9,
    heightMeters: 4.6,
    headingDeg: 0,
    ...overrides,
  };
}

function inputs(overrides: Partial<FieldInputs> = {}): FieldInputs {
  return {
    houses: [house()],
    baseline: null,
    civilDay: "Australia/Sydney:2026-06-21",
    utcOffsetHours: 10,
    ...overrides,
  };
}

describe("fieldSignature", () => {
  it("is stable for unchanged inputs", () => {
    expect(fieldSignature(inputs())).toBe(fieldSignature(inputs()));
  });

  it("carries no notion of map visibility", () => {
    // Showing or hiding the heatmap is not an input here, so a hidden field
    // stays valid and toggling the map cannot force a recomputation.
    expect(Object.keys(inputs())).not.toContain("fieldEnabled");
    expect(fieldSignature(inputs())).not.toMatch(/true|false/);
  });

  it("changes when a house moves", () => {
    const moved = house({
      position: { ...SITE, latitude: SITE.latitude + 0.0004 },
    });
    expect(fieldSignature(inputs({ houses: [moved] }))).not.toBe(
      fieldSignature(inputs()),
    );
  });

  it("changes when a house rotates", () => {
    const turned = house({ rotation: { heading: 90, pitch: 0, roll: 0 } });
    expect(fieldSignature(inputs({ houses: [turned] }))).not.toBe(
      fieldSignature(inputs()),
    );
  });

  it("changes when the civil day or offset changes", () => {
    expect(
      fieldSignature(inputs({ civilDay: "Australia/Sydney:2026-12-21" })),
    ).not.toBe(fieldSignature(inputs()));
    expect(fieldSignature(inputs({ utcOffsetHours: 11 }))).not.toBe(
      fieldSignature(inputs()),
    );
  });

  it("changes when a baseline is saved, moved or cleared", () => {
    const withBaseline = inputs({ baseline: [occluder()] });
    expect(fieldSignature(withBaseline)).not.toBe(fieldSignature(inputs()));

    const movedBaseline = inputs({
      baseline: [occluder({ position: { ...SITE, latitude: SITE.latitude + 0.0004 } })],
    });
    expect(fieldSignature(movedBaseline)).not.toBe(fieldSignature(withBaseline));
  });

  it("distinguishes a second house from a moved one", () => {
    const two = inputs({
      houses: [house(), house({ id: "house-2" })],
    });
    expect(fieldSignature(two)).not.toBe(fieldSignature(inputs()));
  });

  it("ignores movement far below analytical resolution", () => {
    // A sub-millimetre jitter must not invalidate a field and restart the
    // whole analysis.
    const jittered = house({
      position: { ...SITE, latitude: SITE.latitude + 1e-9 },
    });
    expect(fieldSignature(inputs({ houses: [jittered] }))).toBe(
      fieldSignature(inputs()),
    );
  });
});
