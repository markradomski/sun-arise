import { describe, expect, it } from "vitest";
import { asSceneObject } from "./DragController";
import { validateMountSurface } from "../scene/mountSurface";
import { DEFAULT_ROTATION, type SceneObject } from "../scene/types";
import { CATALOG } from "../houses/catalog";

/**
 * Placing a camera on the roof while the frustum is displayed.
 *
 * The frustum is polylines in world space and its apex sits exactly on the
 * roof, so the topmost pick at the most useful pixel is a polyline rather
 * than the house. These cover the resolution of that: look past the
 * visualisation, keep the house, and keep doing so when the camera is placed
 * again and the frustum has moved to the new spot.
 */

const ENTRY = CATALOG["contemporary-au"]; // 14 × 9 m, 4.6 m tall
const BASE_HEIGHT = 25.36;

function house(): SceneObject {
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
  };
}

/** A Cesium entity pick, as the frustum's polylines produce. */
function entityPick(id: string) {
  return { id: { id }, primitive: { constructor: { name: "Polyline" } } };
}

/** A model pick carrying one of our scene objects. */
function modelPick(object: SceneObject) {
  return { id: object, primitive: { constructor: { name: "Model" } } };
}

/** The first scene object in a drill stack, as the controller resolves it. */
function drillForObject(picks: unknown[]): SceneObject | undefined {
  for (const pick of picks) {
    const candidate = asSceneObject(pick);
    if (candidate) return candidate;
  }
  return undefined;
}

describe("asSceneObject", () => {
  it("keeps our scene objects", () => {
    const subject = house();
    expect(asSceneObject(modelPick(subject))).toBe(subject);
  });

  it("rejects visualisation entities, which carry no type", () => {
    expect(asSceneObject(entityPick("frustum-edge"))).toBeUndefined();
  });

  it("rejects nothing at all", () => {
    expect(asSceneObject(undefined)).toBeUndefined();
    expect(asSceneObject(null)).toBeUndefined();
    expect(asSceneObject({})).toBeUndefined();
    expect(asSceneObject({ id: "a-plain-string" })).toBeUndefined();
  });
});

describe("picking the house through the frustum", () => {
  it("finds the house under a frustum edge at the apex", () => {
    const subject = house();
    // The stack Cesium actually returns at the apex pixel: the frustum's
    // polyline on top, the house model behind it, another edge beyond.
    const stack = [
      entityPick("frustum-edge-a"),
      modelPick(subject),
      entityPick("frustum-edge-b"),
    ];
    expect(drillForObject(stack)).toBe(subject);
  });

  it("still finds the house when nothing is drawn over it", () => {
    const subject = house();
    expect(drillForObject([modelPick(subject)])).toBe(subject);
  });

  it("finds nothing when the ray misses the house entirely", () => {
    // A frustum edge out over the bay, with no building behind it.
    const stack = [entityPick("frustum-edge-a"), entityPick("frustum-edge-b")];
    expect(drillForObject(stack)).toBeUndefined();
  });

  it("takes the nearest house when several are stacked", () => {
    const near = house();
    const far = { ...house(), id: "house-2" };
    const stack = [entityPick("frustum-edge"), modelPick(near), modelPick(far)];
    expect(drillForObject(stack)?.id).toBe("house-1");
  });
});

describe("repeated placement with the frustum visible", () => {
  /**
   * After a placement the frustum moves to the new mount, so the next click
   * meets the same obstruction in a new place. Placement must keep working,
   * and each pick must still be validated rather than trusted.
   */
  it("places repeatedly, with the frustum over the pick every time", () => {
    const subject = house();
    const roof = BASE_HEIGHT + ENTRY.heightMeters;
    const spots = [
      { latitude: -41.0015, longitude: 147.0714, height: roof },
      { latitude: -41.00155, longitude: 147.07145, height: roof - 0.4 },
      { latitude: -41.001512, longitude: 147.071395, height: roof - 0.2 },
    ];

    for (const spot of spots) {
      const stack = [entityPick("frustum-edge"), modelPick(subject)];
      const picked = drillForObject(stack);
      expect(picked).toBe(subject);

      const validated = validateMountSurface(spot, picked!);
      expect(validated.ok).toBe(true);
      if (validated.ok) expect(validated.surface.height).toBeCloseTo(spot.height, 9);
    }
  });

  it("still rejects a bad depth even when the house was found by drilling", () => {
    // Drilling past the frustum must not become a way to smuggle an
    // untrustworthy surface through: the pick still has to validate.
    const subject = house();
    const throughGlass = {
      latitude: subject.position.latitude,
      longitude: subject.position.longitude,
      height: BASE_HEIGHT - 6,
    };
    const picked = drillForObject([entityPick("frustum-edge"), modelPick(subject)]);
    expect(picked).toBe(subject);
    expect(validateMountSurface(throughGlass, picked!)).toEqual({
      ok: false,
      reason: "BELOW_BASE",
    });
  });

  it("never yields a position when the house is not under the cursor", () => {
    // No house means no placement at all — and in particular no terrain
    // fallback standing in for one.
    const picked = drillForObject([entityPick("frustum-edge")]);
    expect(picked).toBeUndefined();
  });
});
