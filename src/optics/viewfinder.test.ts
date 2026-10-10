import { describe, expect, it } from "vitest";
import { captureFrame, cesiumFrustumFovDeg, viewportFov } from "./viewfinder";
import { verticalFovDeg } from "./camera";

const SENSOR = 16 / 9;
const DEG = Math.PI / 180;

describe("captureFrame", () => {
  it("fills the viewport exactly when the shapes match", () => {
    const frame = captureFrame(SENSOR, SENSOR);
    expect(frame.widthFraction).toBeCloseTo(1, 9);
    expect(frame.heightFraction).toBeCloseTo(1, 9);
  });

  it("letterboxes a 16:9 frame inside a taller viewport", () => {
    const frame = captureFrame(4 / 3, SENSOR);
    expect(frame.widthFraction).toBeCloseTo(1, 9);
    expect(frame.heightFraction).toBeCloseTo((4 / 3) / SENSOR, 9);
    expect(frame.heightFraction).toBeLessThan(1);
  });

  it("pillarboxes a 16:9 frame inside a wider viewport", () => {
    const frame = captureFrame(21 / 9, SENSOR);
    expect(frame.heightFraction).toBeCloseTo(1, 9);
    expect(frame.widthFraction).toBeLessThan(1);
  });

  it("survives a portrait phone without inverting", () => {
    const frame = captureFrame(375 / 812, SENSOR);
    expect(frame.widthFraction).toBeCloseTo(1, 9);
    expect(frame.heightFraction).toBeGreaterThan(0);
    expect(frame.heightFraction).toBeLessThan(0.3);
  });

  it("fills a 1920×1080 desktop that already matches 16:9", () => {
    const frame = captureFrame(1920 / 1080, SENSOR);
    expect(frame.widthFraction).toBeCloseTo(1, 9);
    expect(frame.heightFraction).toBeCloseTo(1, 9);
  });

  it("letterboxes 16:9 inside a 1440×900 desktop", () => {
    const frame = captureFrame(1440 / 900, SENSOR);
    expect(frame.widthFraction).toBeCloseTo(1, 9);
    expect(frame.heightFraction).toBeCloseTo(1440 / 900 / SENSOR, 9);
  });

  it("pillarboxes 16:9 inside landscape mobile", () => {
    const frame = captureFrame(812 / 375, SENSOR);
    expect(frame.heightFraction).toBeCloseTo(1, 9);
    expect(frame.widthFraction).toBeCloseTo(SENSOR / (812 / 375), 9);
  });

  it("refuses to divide by a collapsed viewport", () => {
    expect(captureFrame(0, SENSOR)).toEqual({ widthFraction: 1, heightFraction: 1 });
    expect(captureFrame(SENSOR, 0)).toEqual({ widthFraction: 1, heightFraction: 1 });
  });
});

describe("viewportFov", () => {
  /**
   * The property that matters: whatever the window's shape, the inscribed
   * capture frame must subtend exactly the camera's own field of view.
   */
  function frameFovDeg(horizontalFovDeg: number, viewportAspect: number) {
    const fov = viewportFov(horizontalFovDeg, SENSOR, viewportAspect);
    const frame = captureFrame(viewportAspect, SENSOR);
    return {
      horizontal:
        (Math.atan(
          frame.widthFraction * Math.tan((fov.horizontalFovDeg / 2) * DEG),
        ) /
          DEG) *
        2,
      vertical:
        (Math.atan(
          frame.heightFraction * Math.tan((fov.verticalFovDeg / 2) * DEG),
        ) /
          DEG) *
        2,
    };
  }

  it("gives the capture frame the camera's field of view at any window shape", () => {
    for (const hFov of [10, 54, 84, 110]) {
      for (const viewportAspect of [21 / 9, 16 / 9, 4 / 3, 1, 375 / 812]) {
        const framed = frameFovDeg(hFov, viewportAspect);
        expect(framed.horizontal).toBeCloseTo(hFov, 6);
        expect(framed.vertical).toBeCloseTo(verticalFovDeg(hFov, SENSOR), 6);
      }
    }
  });

  it("shows extra scene around the frame, never less", () => {
    for (const viewportAspect of [21 / 9, 4 / 3, 375 / 812]) {
      const fov = viewportFov(54, SENSOR, viewportAspect);
      expect(fov.horizontalFovDeg).toBeGreaterThanOrEqual(54 - 1e-9);
      expect(fov.verticalFovDeg).toBeGreaterThanOrEqual(
        verticalFovDeg(54, SENSOR) - 1e-9,
      );
    }
  });

  it("matches the camera on both axes when the window is already 16:9", () => {
    const fov = viewportFov(54, SENSOR, SENSOR);
    expect(fov.horizontalFovDeg).toBeCloseTo(54, 9);
    expect(fov.verticalFovDeg).toBeCloseTo(verticalFovDeg(54, SENSOR), 9);
  });
});

describe("cesiumFrustumFovDeg", () => {
  /**
   * Cesium reads its `fov` as horizontal while the canvas is landscape and as
   * vertical once it is portrait. These reproduce that rule, so the helper is
   * pinned to the behaviour it exists to absorb.
   */
  function cesiumDerivedFov(fovDeg: number, viewportAspect: number) {
    return viewportAspect <= 1
      ? {
          vertical: fovDeg,
          horizontal:
            (Math.atan(Math.tan((fovDeg / 2) * DEG) * viewportAspect) / DEG) * 2,
        }
      : {
          horizontal: fovDeg,
          vertical:
            (Math.atan(Math.tan((fovDeg / 2) * DEG) / viewportAspect) / DEG) * 2,
        };
  }

  it("lands the capture frame on the camera's field of view in landscape", () => {
    const viewportAspect = 1400 / 900;
    const fov = cesiumFrustumFovDeg(84, SENSOR, viewportAspect);
    const derived = cesiumDerivedFov(fov, viewportAspect);
    const frame = captureFrame(viewportAspect, SENSOR);
    const framedHorizontal =
      (Math.atan(frame.widthFraction * Math.tan((derived.horizontal / 2) * DEG)) /
        DEG) *
      2;
    expect(framedHorizontal).toBeCloseTo(84, 6);
  });

  it("does the same in portrait, where Cesium switches axis", () => {
    const viewportAspect = 375 / 812;
    const fov = cesiumFrustumFovDeg(84, SENSOR, viewportAspect);
    const derived = cesiumDerivedFov(fov, viewportAspect);
    const frame = captureFrame(viewportAspect, SENSOR);
    const framedHorizontal =
      (Math.atan(frame.widthFraction * Math.tan((derived.horizontal / 2) * DEG)) /
        DEG) *
      2;
    expect(framedHorizontal).toBeCloseTo(84, 6);
  });

  it("would be wrong if the axis were assumed, which is why it is not", () => {
    const viewportAspect = 375 / 812;

    // Handing Cesium the horizontal angle directly, as a landscape-only
    // assumption would, leaves the capture frame far short of the lens.
    const naive = cesiumDerivedFov(84, viewportAspect);
    const frame = captureFrame(viewportAspect, SENSOR);
    const naiveFramed =
      (Math.atan(frame.widthFraction * Math.tan((naive.horizontal / 2) * DEG)) /
        DEG) *
      2;
    expect(naiveFramed).toBeLessThan(50);

    // Choosing the axis gets it right, and needs a much wider vertical sweep
    // to letterbox an 84° frame into a tall window.
    const chosen = cesiumFrustumFovDeg(84, SENSOR, viewportAspect);
    expect(chosen).toBeGreaterThan(84);
  });

  it("stays within a sane range across every lens and window shape", () => {
    for (const hFov of [10, 23, 54, 84, 110]) {
      for (const viewportAspect of [21 / 9, 16 / 9, 1, 0.46]) {
        const fov = cesiumFrustumFovDeg(hFov, SENSOR, viewportAspect);
        expect(fov).toBeGreaterThan(0);
        expect(fov).toBeLessThan(180);
      }
    }
  });
});
