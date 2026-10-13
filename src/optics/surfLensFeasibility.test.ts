import { describe, expect, it } from "vitest";
import { compareLenses, frameTarget, type ReferenceObject } from "./framing";
import {
  frameHeightMeters,
  frameWidthMeters,
  outputResolution,
  verticalFovForFormat,
} from "./projection";
import { createCamera } from "./camera";
import { geodesicPoints, inverseGeodesic } from "./geodesy";
import type { GeoPosition } from "../scene/types";

/**
 * The three framings under consideration for the Lulworth surf camera, at the
 * output format it would record in, against a person-sized reference.
 *
 * Everything here is geometry: how much of the sensor something covers. It is
 * not a claim that anything would be identifiable, which depends on optics,
 * atmosphere, compression and motion that none of this models.
 */

const UHD = outputResolution("4k"); // 3840 x 2160
const ROOF: GeoPosition = {
  latitude: -41.001528744069276,
  longitude: 147.07141571573635,
  height: 25.36,
};
const MOUNT_HEIGHT = 4.6;

/** A person: two metres tall, and nothing like two metres wide. */
const PERSON: ReferenceObject = { widthMeters: 0.5, heightMeters: 2 };

const FOVS = [10, 15, 23];

function camera(horizontalFovDeg: number, bearingDeg = 0, tiltDeg = 0) {
  return createCamera("surf-cam-1", ROOF, {
    mountHeightMeters: MOUNT_HEIGHT,
    bearingDeg,
    tiltDeg,
    horizontalFovDeg,
  });
}

/** A sea-level target `distance` metres away on `bearing`. */
function target(distanceMeters: number, bearingDeg = 0) {
  const far = geodesicPoints(
    ROOF,
    { latitude: ROOF.latitude + 1, longitude: ROOF.longitude },
    [distanceMeters],
  )[0];
  const rad = (bearingDeg * Math.PI) / 180;
  const north = (distanceMeters * Math.cos(rad)) / 111_320;
  const east =
    (distanceMeters * Math.sin(rad)) /
    (111_320 * Math.cos((ROOF.latitude * Math.PI) / 180));
  const ground =
    bearingDeg === 0
      ? { ...far, height: 0 }
      : {
          latitude: ROOF.latitude + north,
          longitude: ROOF.longitude + east,
          height: 0,
        };
  return { ground, heightMeters: 0 };
}

/** Aims the camera straight at a target so it sits on the optical axis. */
function aimedAt(horizontalFovDeg: number, distanceMeters: number, bearingDeg = 0) {
  const spot = target(distanceMeters, bearingDeg);
  const { initialBearingDeg } = inverseGeodesic(ROOF, spot.ground);
  const lens = ROOF.height + MOUNT_HEIGHT;
  const tilt = (Math.atan2(lens - 0, distanceMeters) * 180) / Math.PI;
  return { cam: camera(horizontalFovDeg, initialBearingDeg, tilt), spot };
}

describe("three candidate framings at 4K", () => {
  it("narrower framings put more pixels on the same person", () => {
    const heights = FOVS.map((fov) => {
      const { cam, spot } = aimedAt(fov, 2_000);
      return frameTarget(cam, spot, "4k", PERSON).size.heightPixels;
    });
    // 10 deg must beat 15, which must beat 23.
    expect(heights[0]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
  });

  it("scales pixel height inversely with the tangent of the half angle", () => {
    const { cam: a, spot } = aimedAt(10, 2_000);
    const { cam: b } = aimedAt(23, 2_000);
    const tall = frameTarget(a, spot, "4k", PERSON).size.heightPixels;
    const short = frameTarget(b, spot, "4k", PERSON).size.heightPixels;
    const ratio =
      Math.tan((23 / 2) * (Math.PI / 180)) / Math.tan((10 / 2) * (Math.PI / 180));
    expect(tall / short).toBeCloseTo(ratio, 1);
  });

  it("covers less ground as it narrows, which is the trade being made", () => {
    const widths = FOVS.map((fov) => {
      const { cam, spot } = aimedAt(fov, 2_000);
      const framing = frameTarget(cam, spot, "4k", PERSON);
      return frameWidthMeters(fov, framing.slantRangeMeters);
    });
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
  });

  it("derives vertical coverage from the 16:9 vertical field of view", () => {
    const { cam, spot } = aimedAt(15, 2_000);
    const framing = frameTarget(cam, spot, "4k", PERSON);
    const expected = frameHeightMeters(
      verticalFovForFormat(15, UHD),
      framing.slantRangeMeters,
    );
    expect(frameHeightMeters(framing.verticalFovDeg, framing.slantRangeMeters))
      .toBeCloseTo(expected, 6);
    // 16:9, so the vertical covers appreciably less than the horizontal.
    expect(expected).toBeLessThan(
      frameWidthMeters(15, framing.slantRangeMeters),
    );
  });
});

describe("distance and resolution", () => {
  it("halves pixel height when the target is twice as far", () => {
    const near = aimedAt(15, 1_500);
    const far = aimedAt(15, 3_000);
    const a = frameTarget(near.cam, near.spot, "4k", PERSON).size.heightPixels;
    const b = frameTarget(far.cam, far.spot, "4k", PERSON).size.heightPixels;
    expect(a / b).toBeCloseTo(2, 1);
  });

  it("halves pixel height at 1080p, with the framing unchanged", () => {
    const { cam, spot } = aimedAt(15, 2_000);
    const uhd = frameTarget(cam, spot, "4k", PERSON);
    const hd = frameTarget(cam, spot, "1080p", PERSON);
    expect(uhd.size.heightPixels / hd.size.heightPixels).toBeCloseTo(2, 3);
    // Same lens, so the ground it covers cannot change with the raster.
    expect(hd.horizontalFovDeg).toBe(uhd.horizontalFovDeg);
    expect(hd.slantRangeMeters).toBeCloseTo(uhd.slantRangeMeters, 6);
    // A finer sample, not a wider view.
    expect(hd.size.metersPerPixel).toBeCloseTo(uhd.size.metersPerPixel * 2, 9);
  });

  it("reports ground sampling consistent with the person's pixel height", () => {
    const { cam, spot } = aimedAt(10, 2_500);
    const framing = frameTarget(cam, spot, "4k", PERSON);
    // A 2 m object sampled at g metres per pixel spans about 2/g pixels.
    expect(framing.size.heightPixels).toBeCloseTo(2 / framing.size.metersPerPixel, 0);
  });
});

describe("on-axis and off-axis targets", () => {
  it("centres a target the camera is aimed at", () => {
    const { cam, spot } = aimedAt(15, 2_000);
    const framing = frameTarget(cam, spot, "4k", PERSON);
    expect(framing.image.inFrame).toBe(true);
    expect(framing.angularOffsetDeg).toBeLessThan(0.01);
    expect(framing.image.pixelX).toBeCloseTo(UHD.widthPixels / 2, 0);
  });

  it("keeps a slightly off-axis target in frame and off centre", () => {
    const { cam } = aimedAt(23, 2_000);
    // Same range, swung a few degrees along the beach.
    const offAxis = target(2_000, 5);
    const framing = frameTarget(cam, offAxis, "4k", PERSON);
    expect(framing.image.inFrame).toBe(true);
    expect(framing.angularOffsetDeg).toBeGreaterThan(1);
    expect(Math.abs(framing.image.x)).toBeGreaterThan(0.1);
  });

  it("reports a target outside the recorded frame as outside it", () => {
    const { cam } = aimedAt(10, 2_000);
    // 20 deg off a 10 deg frame is well beyond the edge.
    const wayOff = target(2_000, 20);
    const framing = frameTarget(cam, wayOff, "4k", PERSON);
    expect(framing.image.inFrame).toBe(false);
    expect(framing.image.behind).toBe(false);
  });

  it("narrower framings lose a target that a wider one still holds", () => {
    const offAxis = target(2_000, 8);
    const wide = frameTarget(aimedAt(23, 2_000).cam, offAxis, "4k", PERSON);
    const narrow = frameTarget(aimedAt(10, 2_000).cam, offAxis, "4k", PERSON);
    expect(wide.image.inFrame).toBe(true);
    expect(narrow.image.inFrame).toBe(false);
  });
});

describe("lens comparison rows", () => {
  it("offers all three candidate framings", () => {
    const { cam, spot } = aimedAt(15, 2_000);
    const rows = compareLenses(cam, spot, "4k", PERSON);
    for (const fov of FOVS) {
      expect(rows.some((row) => row.horizontalFovDeg === fov)).toBe(true);
    }
  });

  it("carries the person's height, not only its width", () => {
    const { cam, spot } = aimedAt(15, 2_000);
    const row = compareLenses(cam, spot, "4k", PERSON).find(
      (r) => r.horizontalFovDeg === 15,
    );
    // The reference is 0.5 m wide and 2 m tall, so these must differ.
    expect(row?.objectHeightPixels).toBeGreaterThan(
      (row?.objectWidthPixels ?? 0) * 3,
    );
  });

  it("uses one range for coverage and sampling alike", () => {
    const { cam, spot } = aimedAt(15, 2_000);
    const framing = frameTarget(cam, spot, "4k", PERSON);
    const row = compareLenses(cam, spot, "4k", PERSON).find(
      (r) => r.horizontalFovDeg === 15,
    );
    expect(row?.metersPerPixel).toBeCloseTo(framing.size.metersPerPixel, 9);
    expect(row?.frameWidthMeters).toBeCloseTo(
      frameWidthMeters(15, framing.slantRangeMeters),
      6,
    );
  });

  it("marks the row the camera is currently set to", () => {
    const { cam, spot } = aimedAt(23, 2_000);
    const rows = compareLenses(cam, spot, "4k", PERSON);
    expect(rows.filter((r) => r.active).map((r) => r.horizontalFovDeg)).toEqual([23]);
  });
});
