import { verticalFovDeg } from "./camera";

/**
 * Fitting the planned camera's frame into the viewport it is previewed in.
 *
 * These are two different rectangles. The camera outputs 16:9; the browser
 * window is whatever shape the window happens to be. Stretching one to the
 * other would misreport the field of view on every axis, so instead the
 * capture frame is inscribed in the viewport and the preview is aimed so that
 * *the inscribed frame* carries exactly the camera's horizontal and vertical
 * field of view. The area outside it is scene the real camera would not get.
 *
 * Pure arithmetic: no Cesium here, though `cesiumFrustumFovDeg` exists to feed
 * Cesium's one quirk, documented on that function.
 *
 * The viewport aspect must be the Cesium canvas (or its container), not
 * `window.innerWidth / innerHeight`. A collapsed control panel overlays the
 * globe and must not reframe the virtual camera; measuring the window would
 * also drift from the canvas on mobile chrome and docked developer tools.
 */

const DEG = Math.PI / 180;

export interface CaptureFrame {
  /** Share of the viewport's width the capture frame spans, 0 to 1. */
  widthFraction: number;
  /** Share of the viewport's height the capture frame spans, 0 to 1. */
  heightFraction: number;
}

/** The largest rectangle of `sensorAspect` that fits inside the viewport. */
export function captureFrame(
  viewportAspect: number,
  sensorAspect: number,
): CaptureFrame {
  if (!(viewportAspect > 0) || !(sensorAspect > 0)) {
    return { widthFraction: 1, heightFraction: 1 };
  }
  return sensorAspect >= viewportAspect
    ? { widthFraction: 1, heightFraction: viewportAspect / sensorAspect }
    : { widthFraction: sensorAspect / viewportAspect, heightFraction: 1 };
}

export interface ViewportFov {
  horizontalFovDeg: number;
  verticalFovDeg: number;
}

/**
 * Field of view the whole viewport must cover for the inscribed capture frame
 * to show exactly the camera's own field of view.
 *
 * Because the image plane is flat, angle maps to distance through the
 * tangent, so widening the frame by a factor scales `tan(fov/2)` by that same
 * factor. Whichever axis the capture frame fills is the axis that matches the
 * camera directly; the other follows from the viewport's shape.
 */
export function viewportFov(
  horizontalFovDeg: number,
  sensorAspect: number,
  viewportAspect: number,
): ViewportFov {
  const cameraVerticalFovDeg = verticalFovDeg(horizontalFovDeg, sensorAspect);

  if (sensorAspect >= viewportAspect) {
    // Capture frame spans the full width, so the horizontal matches directly.
    return {
      horizontalFovDeg,
      verticalFovDeg: verticalFovDeg(horizontalFovDeg, viewportAspect),
    };
  }

  // Capture frame spans the full height, so the vertical matches directly.
  const halfVertical = Math.tan((cameraVerticalFovDeg / 2) * DEG);
  return {
    horizontalFovDeg: (Math.atan(halfVertical * viewportAspect) / DEG) * 2,
    verticalFovDeg: cameraVerticalFovDeg,
  };
}

/**
 * The angle to assign to Cesium's `PerspectiveFrustum.fov`.
 *
 * Cesium's trap: that property is the **horizontal** field of view while the
 * canvas is wider than it is tall, and silently becomes the **vertical** one
 * once it is taller — a portrait phone crosses that line. Setting a
 * horizontal angle unconditionally would quietly reframe the preview on
 * rotation, so the axis is chosen here rather than assumed.
 */
export function cesiumFrustumFovDeg(
  horizontalFovDeg: number,
  sensorAspect: number,
  viewportAspect: number,
): number {
  const fov = viewportFov(horizontalFovDeg, sensorAspect, viewportAspect);
  return viewportAspect > 1 ? fov.horizontalFovDeg : fov.verticalFovDeg;
}
