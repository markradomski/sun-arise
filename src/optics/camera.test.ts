import { describe, expect, it } from "vitest";
import {
  cameraElevationMeters,
  cesiumPitchDeg,
  clamp,
  constrainCamera,
  createCamera,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_CAMERA,
  focalLengthToHorizontalFovDeg,
  horizontalFovDeg,
  LENS_PRESETS,
  lensPreset,
  MAX_HFOV_DEG,
  MAX_MOUNT_HEIGHT_METERS,
  MAX_TILT_DEG,
  MIN_HFOV_DEG,
  MIN_MOUNT_HEIGHT_METERS,
  MIN_TILT_DEG,
  nearestLensPreset,
  orientationVector,
  verticalFovDeg,
} from "./camera";
import type { GeoPosition } from "../scene/types";

const GROUND: GeoPosition = { latitude: -41.0023, longitude: 147.0858, height: 25.3 };

describe("field of view", () => {
  it("derives a narrower vertical FOV at 16:9", () => {
    const v = verticalFovDeg(90);
    expect(v).toBeLessThan(90);
    expect(v).toBeCloseTo(58.72, 1);
  });

  it("round-trips horizontal and vertical", () => {
    for (const h of [10, 54, 84, 110]) {
      expect(horizontalFovDeg(verticalFovDeg(h))).toBeCloseTo(h, 8);
    }
  });

  it("is square when the aspect ratio is 1", () => {
    expect(verticalFovDeg(60, 1)).toBeCloseTo(60, 8);
  });

  it("does not scale the angle linearly", () => {
    // The naive h / aspect would give 50.6 for a 90 degree lens; the correct
    // tangent-based answer is several degrees different.
    expect(Math.abs(verticalFovDeg(90) - 90 / DEFAULT_ASPECT_RATIO)).toBeGreaterThan(5);
  });

  it("widens as focal length shortens", () => {
    const wide = focalLengthToHorizontalFovDeg(14, 36);
    const tele = focalLengthToHorizontalFovDeg(200, 36);
    expect(wide).toBeGreaterThan(tele);
    // 35mm lens on a 36mm full-frame sensor is about 54 degrees horizontally.
    expect(focalLengthToHorizontalFovDeg(35, 36)).toBeCloseTo(54.4, 0);
  });

  it("returns zero for degenerate optics rather than infinity", () => {
    expect(focalLengthToHorizontalFovDeg(0, 36)).toBe(0);
    expect(focalLengthToHorizontalFovDeg(35, 0)).toBe(0);
    expect(focalLengthToHorizontalFovDeg(-35, 36)).toBe(0);
  });
});

describe("lens presets", () => {
  it("are ordered from wide to narrow and stay in range", () => {
    for (let i = 1; i < LENS_PRESETS.length; i += 1) {
      expect(LENS_PRESETS[i].horizontalFovDeg).toBeLessThan(
        LENS_PRESETS[i - 1].horizontalFovDeg,
      );
    }
    for (const preset of LENS_PRESETS) {
      expect(preset.horizontalFovDeg).toBeGreaterThanOrEqual(MIN_HFOV_DEG);
      expect(preset.horizontalFovDeg).toBeLessThanOrEqual(MAX_HFOV_DEG);
    }
  });

  it("looks up by id", () => {
    expect(lensPreset("standard")?.horizontalFovDeg).toBe(54);
    expect(lensPreset("nonexistent")).toBeUndefined();
  });

  it("finds the nearest preset to an arbitrary FOV", () => {
    expect(nearestLensPreset(54).id).toBe("standard");
    expect(nearestLensPreset(100).id).toBe("ultra-wide");
    expect(nearestLensPreset(6).id).toBe("super-tele");
    expect(nearestLensPreset(80).id).toBe("wide");
  });
});

describe("orientation", () => {
  it("points north at bearing 0 and level tilt", () => {
    const v = orientationVector(0, 0);
    expect(v.north).toBeCloseTo(1, 8);
    expect(v.east).toBeCloseTo(0, 8);
    expect(v.up).toBeCloseTo(0, 8);
  });

  it("points east at bearing 90", () => {
    const v = orientationVector(90, 0);
    expect(v.east).toBeCloseTo(1, 8);
    expect(v.north).toBeCloseTo(0, 8);
  });

  it("points straight down at 90 degrees of tilt", () => {
    const v = orientationVector(0, 90);
    expect(v.up).toBeCloseTo(-1, 8);
    expect(v.north).toBeCloseTo(0, 8);
  });

  it("tilts downwards, never upwards, for positive tilt", () => {
    for (const tilt of [1, 15, 45, 89]) {
      expect(orientationVector(0, tilt).up).toBeLessThan(0);
    }
  });

  it("stays a unit vector", () => {
    for (const [bearing, tilt] of [
      [0, 0],
      [37, 12],
      [215, 45],
      [359, 89],
    ]) {
      const v = orientationVector(bearing, tilt);
      expect(Math.hypot(v.east, v.north, v.up)).toBeCloseTo(1, 10);
    }
  });

  it("wraps bearings outside the normal range", () => {
    const wrapped = orientationVector(-90, 0);
    const direct = orientationVector(270, 0);
    expect(wrapped.east).toBeCloseTo(direct.east, 10);
    expect(wrapped.north).toBeCloseTo(direct.north, 10);
  });

  it("flips sign for Cesium's pitch convention", () => {
    // Tilt is positive down; Cesium pitch is negative down.
    expect(cesiumPitchDeg(0)).toBe(-0);
    expect(cesiumPitchDeg(30)).toBe(-30);
    expect(cesiumPitchDeg(90)).toBe(-90);
  });
});

describe("camera state", () => {
  it("measures elevation as terrain plus mount height", () => {
    const camera = createCamera("cam-1", GROUND, { mountHeightMeters: 6 });
    expect(cameraElevationMeters(camera)).toBeCloseTo(31.3, 10);
  });

  it("keeps mount height relative to terrain when the terrain changes", () => {
    const camera = createCamera("cam-1", GROUND, { mountHeightMeters: 6 });
    const resampled = { ...camera, ground: { ...GROUND, height: 12 } };
    expect(resampled.mountHeightMeters).toBe(6);
    expect(cameraElevationMeters(resampled)).toBeCloseTo(18, 10);
  });

  it("applies documented defaults", () => {
    const camera = createCamera("cam-1", GROUND);
    expect(camera.mountHeightMeters).toBe(DEFAULT_CAMERA.mountHeightMeters);
    expect(camera.bearingDeg).toBe(DEFAULT_CAMERA.bearingDeg);
    expect(camera.tiltDeg).toBe(DEFAULT_CAMERA.tiltDeg);
    expect(camera.horizontalFovDeg).toBe(DEFAULT_CAMERA.horizontalFovDeg);
    expect(camera.id).toBe("cam-1");
  });

  it("constrains every editable field", () => {
    const camera = constrainCamera({
      id: "cam-1",
      label: "x",
      ground: GROUND,
      mountHeightMeters: 999,
      bearingDeg: 450,
      tiltDeg: -20,
      horizontalFovDeg: 400,
    });
    expect(camera.mountHeightMeters).toBe(MAX_MOUNT_HEIGHT_METERS);
    expect(camera.bearingDeg).toBe(90);
    expect(camera.tiltDeg).toBe(MIN_TILT_DEG);
    expect(camera.horizontalFovDeg).toBe(MAX_HFOV_DEG);
  });

  it("constrains the lower bounds too", () => {
    const camera = constrainCamera({
      id: "cam-1",
      label: "x",
      ground: GROUND,
      mountHeightMeters: -5,
      bearingDeg: -1,
      tiltDeg: 200,
      horizontalFovDeg: 0,
    });
    expect(camera.mountHeightMeters).toBe(MIN_MOUNT_HEIGHT_METERS);
    expect(camera.bearingDeg).toBe(359);
    expect(camera.tiltDeg).toBe(MAX_TILT_DEG);
    expect(camera.horizontalFovDeg).toBe(MIN_HFOV_DEG);
  });

  it("falls back to the minimum rather than propagating NaN", () => {
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
    const camera = createCamera("cam-1", GROUND, {
      mountHeightMeters: Number.NaN,
    });
    expect(Number.isFinite(camera.mountHeightMeters)).toBe(true);
  });
});
