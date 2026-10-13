import { describe, expect, it } from "vitest";
import {
  BASE_TOLERANCE_METERS,
  FOOTPRINT_TOLERANCE_METERS,
  mountBounds,
  mountRejectionMessage,
  RIDGE_TOLERANCE_METERS,
  validateMountSurface,
  type MountRejection,
} from "./mountSurface";
import { offsetByBearing } from "./geo";
import { DEFAULT_ROTATION, type SceneObject } from "./types";
import { CATALOG } from "../houses/catalog";

const BASE_HEIGHT = 25.4;
const ENTRY = CATALOG["contemporary-au"]; // 14 m wide, 9 m deep, 4.6 m tall

function house(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "house-1",
    type: "house",
    modelUrl: ENTRY.modelUrl,
    position: {
      latitude: -41.001528744069276,
      longitude: 147.07141571573635,
      height: BASE_HEIGHT,
    },
    rotation: { ...DEFAULT_ROTATION },
    scale: 1,
    clampToGround: true,
    ...overrides,
  };
}

/** A point `metres` from the house centre on `bearingDeg`, at `height`. */
function surfaceAt(subject: SceneObject, bearingDeg: number, metres: number, height: number) {
  const point =
    metres === 0
      ? { latitude: subject.position.latitude, longitude: subject.position.longitude }
      : offsetByBearing(subject.position, bearingDeg, metres);
  return { ...point, height };
}

/** Elevation of the roof as the catalog describes it. */
const ROOF = BASE_HEIGHT + ENTRY.heightMeters;

describe("mountBounds", () => {
  it("widens the declared footprint for eaves", () => {
    const bounds = mountBounds(house());
    expect(bounds.halfWidthMeters).toBeCloseTo(14 / 2 + FOOTPRINT_TOLERANCE_METERS, 9);
    expect(bounds.halfDepthMeters).toBeCloseTo(9 / 2 + FOOTPRINT_TOLERANCE_METERS, 9);
  });

  it("spans from just under the base to above the ridge", () => {
    const bounds = mountBounds(house());
    expect(bounds.minHeightMeters).toBeCloseTo(BASE_HEIGHT - BASE_TOLERANCE_METERS, 9);
    expect(bounds.maxHeightMeters).toBeCloseTo(ROOF + RIDGE_TOLERANCE_METERS, 9);
  });

  it("follows the object's scale", () => {
    const big = mountBounds(house({ scale: 2 }));
    expect(big.halfWidthMeters).toBeCloseTo(14 + FOOTPRINT_TOLERANCE_METERS, 9);
    expect(big.maxHeightMeters).toBeCloseTo(
      BASE_HEIGHT + ENTRY.heightMeters * 2 + RIDGE_TOLERANCE_METERS,
      9,
    );
  });

  it("falls back to a plausible box for an unknown model", () => {
    const bounds = mountBounds(house({ modelUrl: "/models/unknown.glb" }));
    expect(bounds.halfWidthMeters).toBeGreaterThan(0);
    expect(bounds.maxHeightMeters).toBeGreaterThan(bounds.minHeightMeters);
  });
});

describe("validateMountSurface — accepts a real roof pick", () => {
  it("takes a point over the footprint centre at roof height", () => {
    const subject = house();
    const result = validateMountSurface(surfaceAt(subject, 0, 0, ROOF), subject);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.surface.height).toBeCloseTo(ROOF, 9);
  });

  it("takes a point near the eaves", () => {
    const subject = house();
    // 6.5 m across, inside half-width 7 m.
    const result = validateMountSurface(surfaceAt(subject, 90, 6.5, ROOF), subject);
    expect(result.ok).toBe(true);
  });

  it("takes a ridge slightly above the catalog height", () => {
    const subject = house();
    const result = validateMountSurface(surfaceAt(subject, 0, 0, ROOF + 1), subject);
    expect(result.ok).toBe(true);
  });

  it("follows the house's heading when deciding what is inside", () => {
    // Facing north the depth limit applies northwards: 4.5 m + 1.5 m eaves.
    // Turned 90° the 14 m side runs north-south instead, so the limit there
    // becomes 7 m + 1.5 m and the same point is now on the building.
    const turned = house({ rotation: { ...DEFAULT_ROTATION, heading: 90 } });
    const square = house();
    expect(validateMountSurface(surfaceAt(square, 0, 8, ROOF), square)).toEqual({
      ok: false,
      reason: "OFF_FOOTPRINT",
    });
    expect(validateMountSurface(surfaceAt(turned, 0, 8, ROOF), turned).ok).toBe(true);
  });
});

describe("validateMountSurface — failed picks", () => {
  it("rejects a pick that returned nothing", () => {
    expect(validateMountSurface(undefined, house())).toEqual({
      ok: false,
      reason: "NO_SURFACE",
    });
    expect(validateMountSurface(null, house())).toEqual({
      ok: false,
      reason: "NO_SURFACE",
    });
  });

  it("rejects non-finite coordinates", () => {
    const subject = house();
    for (const bad of [
      { latitude: Number.NaN, longitude: 147, height: ROOF },
      { latitude: -41, longitude: Number.POSITIVE_INFINITY, height: ROOF },
      { latitude: -41, longitude: 147, height: Number.NaN },
    ]) {
      expect(validateMountSurface(bad, subject)).toEqual({
        ok: false,
        reason: "NOT_FINITE",
      });
    }
  });

  it("rejects coordinates outside the globe", () => {
    const subject = house();
    expect(
      validateMountSurface({ latitude: 130, longitude: 147, height: ROOF }, subject).ok,
    ).toBe(false);
    expect(
      validateMountSurface({ latitude: -41, longitude: 400, height: ROOF }, subject).ok,
    ).toBe(false);
  });
});

describe("validateMountSurface — translucent surface failures", () => {
  /**
   * Glazing does not write reliable depth, so a click on a window comes back
   * as whatever the ray reached instead. Each of these is a shape that
   * failure actually takes, and none may be accepted as a mounting point.
   */

  it("rejects the terrain read through a window, under the house", () => {
    const subject = house();
    const throughGlass = surfaceAt(subject, 0, 0, BASE_HEIGHT - 3);
    const result = validateMountSurface(throughGlass, subject);
    expect(result).toEqual({ ok: false, reason: "BELOW_BASE" });
  });

  it("rejects ground seen past the building through glazing", () => {
    const subject = house();
    // 40 m beyond the far wall, at terrain level.
    const beyond = surfaceAt(subject, 0, 40, BASE_HEIGHT);
    expect(validateMountSurface(beyond, subject)).toEqual({
      ok: false,
      reason: "OFF_FOOTPRINT",
    });
  });

  it("rejects a depth read far out to sea", () => {
    const subject = house();
    const sea = surfaceAt(subject, 350, 3200, 0);
    expect(validateMountSurface(sea, subject).ok).toBe(false);
  });

  it("rejects a point floating above the roof", () => {
    const subject = house();
    const sky = surfaceAt(subject, 0, 0, ROOF + RIDGE_TOLERANCE_METERS + 5);
    expect(validateMountSurface(sky, subject)).toEqual({
      ok: false,
      reason: "ABOVE_MODEL",
    });
  });

  it("rejects just outside the eaves while accepting just inside", () => {
    const subject = house();
    const limit = 7 + FOOTPRINT_TOLERANCE_METERS;
    expect(validateMountSurface(surfaceAt(subject, 90, limit - 0.2, ROOF), subject).ok).toBe(
      true,
    );
    expect(validateMountSurface(surfaceAt(subject, 90, limit + 0.5, ROOF), subject).ok).toBe(
      false,
    );
  });

  it("rejects just below the base while accepting the base itself", () => {
    const subject = house();
    expect(validateMountSurface(surfaceAt(subject, 0, 0, BASE_HEIGHT), subject).ok).toBe(
      true,
    );
    expect(
      validateMountSurface(
        surfaceAt(subject, 0, 0, BASE_HEIGHT - BASE_TOLERANCE_METERS - 0.1),
        subject,
      ).ok,
    ).toBe(false);
  });

  it("never substitutes terrain for a rejected pick", () => {
    // The whole point: a rejection carries no position at all, so no caller
    // can mistake a fallback for a surface the user chose.
    const subject = house();
    const result = validateMountSurface(surfaceAt(subject, 0, 0, BASE_HEIGHT - 9), subject);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("surface");
  });
});

describe("mountRejectionMessage", () => {
  it("explains every rejection without blaming the user's aim alone", () => {
    const reasons: MountRejection[] = [
      "NO_SURFACE",
      "NOT_FINITE",
      "OFF_FOOTPRINT",
      "BELOW_BASE",
      "ABOVE_MODEL",
    ];
    for (const reason of reasons) {
      const message = mountRejectionMessage(reason);
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/\.$/);
    }
  });

  it("names glazing where glazing is the likely cause", () => {
    expect(mountRejectionMessage("BELOW_BASE")).toMatch(/glass/i);
    expect(mountRejectionMessage("OFF_FOOTPRINT")).toMatch(/glazing/i);
  });
});
