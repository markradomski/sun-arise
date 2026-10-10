import { describe, expect, it } from "vitest";
import { STARTUP_SITE } from "./startupSite";
import { DEFAULT_SITE } from "./site";
import { isValidLatitude, isValidLongitude } from "./location";
import { isProposedLulworthPosition } from "../optics/camera";

describe("startup site", () => {
  it("opens this build at Lulworth, not on the Sun Arise demonstration scene", () => {
    // The guard against a Sun Arise merge quietly restoring Sydney.
    expect(STARTUP_SITE.name).toBe("Lulworth · Tasmania");
    expect(STARTUP_SITE.position.latitude).not.toBeCloseTo(DEFAULT_SITE.latitude, 3);
    expect(STARTUP_SITE.position.longitude).not.toBeCloseTo(DEFAULT_SITE.longitude, 3);
  });

  it("stands on the proposed mounting point", () => {
    expect(STARTUP_SITE.position.latitude).toBeCloseTo(-41.001528744069276, 12);
    expect(STARTUP_SITE.position.longitude).toBeCloseTo(147.07141571573635, 12);
    expect(isProposedLulworthPosition(STARTUP_SITE.position)).toBe(true);
  });

  it("faces true north, six metres up, tilted six degrees down", () => {
    expect(STARTUP_SITE.mount.bearingDeg).toBe(0);
    expect(STARTUP_SITE.mount.mountHeightMeters).toBe(6);
    expect(STARTUP_SITE.mount.tiltDeg).toBe(6);
  });

  it("carries no elevation, so mount height stays terrain-relative", () => {
    expect(STARTUP_SITE.position.height).toBe(0);
  });

  it("has a valid coordinate", () => {
    expect(isValidLatitude(STARTUP_SITE.position.latitude)).toBe(true);
    expect(isValidLongitude(STARTUP_SITE.position.longitude)).toBe(true);
  });
});
