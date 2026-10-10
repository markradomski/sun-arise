import { describe, expect, it } from "vitest";
import { createCamera, PROPOSED_LULWORTH_CAMERA } from "./camera";
import { DEFAULT_REFRACTION_K, directGeodesic } from "./geodesy";
import {
  compareLenses,
  frameTarget,
  targetOffset,
  type ReferenceObject,
} from "./framing";
import {
  frameWidthMeters,
  metersPerPixel,
  OUTPUT_RESOLUTIONS,
  projectDirection,
  TARGET_SIZES,
} from "./projection";
import type { GeoPosition } from "../scene/types";

const TERRAIN = 24.9;
const PERSON: ReferenceObject = { widthMeters: 2, heightMeters: 2 };

function proposedCamera() {
  return createCamera(
    "surf-cam-1",
    {
      latitude: PROPOSED_LULWORTH_CAMERA.latitude,
      longitude: PROPOSED_LULWORTH_CAMERA.longitude,
      height: TERRAIN,
    },
    {
      bearingDeg: PROPOSED_LULWORTH_CAMERA.bearingDeg,
      tiltDeg: PROPOSED_LULWORTH_CAMERA.tiltDeg,
      mountHeightMeters: PROPOSED_LULWORTH_CAMERA.mountHeightMeters,
    },
  );
}

function targetAt(distanceMeters: number) {
  const position = directGeodesic(
    {
      latitude: PROPOSED_LULWORTH_CAMERA.latitude,
      longitude: PROPOSED_LULWORTH_CAMERA.longitude,
    },
    PROPOSED_LULWORTH_CAMERA.bearingDeg,
    distanceMeters,
  ).position;
  const ground: GeoPosition = { ...position, height: 0 };
  return { ground, heightMeters: 1 };
}

describe("targetOffset models", () => {
  it("uses a geometric chord by default, not the refracted sight line", () => {
    const camera = proposedCamera();
    const target = targetAt(3_000);
    const geometric = targetOffset(camera, target);
    const refracted = targetOffset(camera, target, DEFAULT_REFRACTION_K);
    expect(refracted.offset.up).toBeGreaterThan(geometric.offset.up);
    expect(geometric.distanceMeters).toBeCloseTo(3_000, 0);
  });

  it("centres a geometrically aimed target on the sensor", () => {
    const camera = proposedCamera();
    const target = targetAt(2_000);
    const framing = frameTarget(
      { ...camera, bearingDeg: 0, tiltDeg: 0 },
      target,
      "1080p",
      PERSON,
    );
    // Not yet aimed: the bay is below a level lens.
    expect(framing.image.y).not.toBeCloseTo(0, 2);
  });
});

describe("Lulworth geometric sampling", () => {
  const distances = [500, 1_000, 2_000, 3_000];
  const fieldsOfView = [10, 15, 35, 80];

  it("matches the pinhole equations on axis after aiming along the chord", () => {
    const camera = proposedCamera();

    for (const distance of distances) {
      const target = targetAt(distance);
      const { offset, distanceMeters } = targetOffset(camera, target);
      expect(distanceMeters).toBeCloseTo(distance, 0);

      for (const horizontalFovDeg of fieldsOfView) {
        for (const resolution of OUTPUT_RESOLUTIONS) {
          const aimed = {
            ...camera,
            bearingDeg: Math.atan2(offset.east, offset.north) * (180 / Math.PI),
            tiltDeg: Math.atan2(-offset.up, Math.hypot(offset.east, offset.north)) *
              (180 / Math.PI),
            horizontalFovDeg,
          };
          const framing = frameTarget(aimed, target, resolution.id, PERSON);
          const pinholeWidth = frameWidthMeters(horizontalFovDeg, distance);
          const pinholeMpp = metersPerPixel(
            {
              bearingDeg: aimed.bearingDeg,
              tiltDeg: aimed.tiltDeg,
              horizontalFovDeg,
              format: resolution,
            },
            distance,
          );

          expect(framing.image.inFrame).toBe(true);
          expect(framing.image.x).toBeCloseTo(0, 3);
          expect(framing.image.y).toBeCloseTo(0, 3);
          expect(framing.size.metersPerPixel).toBeCloseTo(pinholeMpp, 3);
          expect(framing.size.widthPixels).toBeCloseTo(2 / pinholeMpp, 0);
          expect(pinholeWidth).toBeCloseTo(
            2 * distance * Math.tan((horizontalFovDeg / 2) * (Math.PI / 180)),
            9,
          );
        }
      }
    }
  });

  it("scales pixel width with resolution and object size, not with claims of identifiability", () => {
    const camera = { ...proposedCamera(), horizontalFovDeg: 15 };
    const target = targetAt(1_000);
    const { offset } = targetOffset(camera, target);
    const aimed = {
      ...camera,
      bearingDeg: Math.atan2(offset.east, offset.north) * (180 / Math.PI),
      tiltDeg:
        Math.atan2(-offset.up, Math.hypot(offset.east, offset.north)) *
        (180 / Math.PI),
    };

    const hd = frameTarget(aimed, target, "1080p", PERSON);
    const uhd = frameTarget(aimed, target, "4k", PERSON);
    expect(uhd.size.widthPixels).toBeCloseTo(hd.size.widthPixels * 2, 1);

    const wave = TARGET_SIZES.find((size) => size.id === "feature")!;
    const feature = frameTarget(aimed, target, "1080p", wave);
    expect(feature.size.widthPixels).toBeCloseTo(hd.size.widthPixels * 5, 1);
  });

  it("reports a target behind the camera as behind, not as a mirrored image", () => {
    const camera = proposedCamera();
    const behind = targetAt(1_000);
    behind.ground.latitude = camera.ground.latitude - 0.02;
    const framing = frameTarget(
      { ...camera, bearingDeg: 0, tiltDeg: 6 },
      behind,
      "1080p",
      PERSON,
    );
    expect(framing.image.behind).toBe(true);
    expect(framing.image.inFrame).toBe(false);
    expect(framing.size.widthPixels).toBe(0);
  });

  it("keeps lens comparison rows on the same geometric offset", () => {
    const camera = proposedCamera();
    const rows = compareLenses(camera, targetAt(2_000), "4k", PERSON);
    expect(rows.length).toBeGreaterThan(1);
    const tele = rows.find((row) => row.presetId === "super-tele")!;
    const wide = rows.find((row) => row.presetId === "ultra-wide")!;
    expect(tele.objectWidthPixels).toBeGreaterThan(wide.objectWidthPixels);
    expect(tele.metersPerPixel).toBeLessThan(wide.metersPerPixel);
  });
});

describe("wide and narrow fields of view", () => {
  it("puts the same on-axis point at the centre of both", () => {
    const camera = proposedCamera();
    const target = targetAt(1_000);
    const { offset } = targetOffset(camera, target);
    const aim = {
      bearingDeg: Math.atan2(offset.east, offset.north) * (180 / Math.PI),
      tiltDeg:
        Math.atan2(-offset.up, Math.hypot(offset.east, offset.north)) *
        (180 / Math.PI),
    };
    for (const horizontalFovDeg of [10, 80]) {
      const image = projectDirection(
        {
          ...aim,
          horizontalFovDeg,
          format: { widthPixels: 1920, heightPixels: 1080 },
        },
        offset,
      );
      expect(image.x).toBeCloseTo(0, 6);
      expect(image.y).toBeCloseTo(0, 6);
    }
  });
});
