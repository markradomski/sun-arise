import { describe, expect, it } from "vitest";
import {
  aimAtTarget,
  aimedEnuOffset,
  metersPerPixel,
  OUTPUT_RESOLUTIONS,
  outputResolution,
  projectDirection,
  projectObjectSize,
  sensorAspect,
  verticalFovForFormat,
  type ImagingSetup,
} from "./projection";
import { cameraBasis, type EnuOffset } from "./frustum";
import { LENS_PRESETS, MAX_TILT_DEG, verticalFovDeg } from "./camera";
import {
  DEFAULT_REFRACTION_K,
  GEOMETRIC_REFRACTION_K,
  inverseGeodesic,
} from "./geodesy";

const HD = { widthPixels: 1920, heightPixels: 1080 };
const UHD = { widthPixels: 3840, heightPixels: 2160 };

function setup(overrides: Partial<ImagingSetup> = {}): ImagingSetup {
  return {
    bearingDeg: 0,
    tiltDeg: 0,
    horizontalFovDeg: 54,
    format: HD,
    ...overrides,
  };
}

/** A point `distance` metres away, `offAxis` degrees right and `up` degrees up. */
function offsetAt(
  s: ImagingSetup,
  distance: number,
  rightDeg: number,
  upDeg: number,
): EnuOffset {
  const b = cameraBasis(s.bearingDeg, s.tiltDeg);
  const r = Math.tan((rightDeg * Math.PI) / 180);
  const u = Math.tan((upDeg * Math.PI) / 180);
  return {
    east: (b.forward.east + b.right.east * r + b.up.east * u) * distance,
    north: (b.forward.north + b.right.north * r + b.up.north * u) * distance,
    up: (b.forward.up + b.right.up * r + b.up.up * u) * distance,
  };
}

/** The same direction as `offsetAt`, but at a fixed range from the camera. */
function atRange(
  s: ImagingSetup,
  range: number,
  rightDeg: number,
  upDeg = 0,
): EnuOffset {
  const raw = offsetAt(s, 1, rightDeg, upDeg);
  const scale = range / Math.hypot(raw.east, raw.north, raw.up);
  return { east: raw.east * scale, north: raw.north * scale, up: raw.up * scale };
}

describe("field of view conversion", () => {
  it("narrows vertically at 16:9 and is not interchangeable with horizontal", () => {
    const v = verticalFovForFormat(84, HD);
    expect(v).toBeLessThan(84);
    expect(v).toBeCloseTo(verticalFovDeg(84, 16 / 9), 9);
  });

  it("follows the aspect ratio, not the pixel count", () => {
    // Same shape, four times the pixels: the optics are unchanged.
    expect(verticalFovForFormat(54, UHD)).toBeCloseTo(verticalFovForFormat(54, HD), 9);
    expect(sensorAspect(UHD)).toBeCloseTo(sensorAspect(HD), 9);
  });

  it("narrows the vertical further as the frame gets wider", () => {
    const wide = verticalFovForFormat(54, { widthPixels: 1920, heightPixels: 1080 });
    const square = verticalFovForFormat(54, { widthPixels: 1080, heightPixels: 1080 });
    expect(wide).toBeLessThan(square);
    expect(square).toBeCloseTo(54, 9);
  });

  it("refuses the naive linear shortcut at wide angles", () => {
    // hFov / aspect would give 61.9 here; the tangents give far less.
    expect(verticalFovForFormat(110, HD)).toBeLessThan(80);
    expect(verticalFovForFormat(110, HD)).toBeGreaterThan(70);
  });
});

describe("projection", () => {
  it("puts an on-axis point at the optical centre", () => {
    const s = setup();
    const p = projectDirection(s, offsetAt(s, 2000, 0, 0));
    expect(p.inFrame).toBe(true);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.pixelX).toBeCloseTo(960, 6);
    expect(p.pixelY).toBeCloseTo(540, 6);
    expect(p.angularOffsetDeg).toBeCloseTo(0, 6);
  });

  it("stays centred however far away the point is", () => {
    const s = setup();
    for (const distance of [50, 500, 12_000]) {
      const p = projectDirection(s, offsetAt(s, distance, 0, 0));
      expect(p.pixelX).toBeCloseTo(960, 6);
    }
  });

  it("lands exactly on the left and right frame edges", () => {
    const s = setup({ horizontalFovDeg: 54 });
    const right = projectDirection(s, offsetAt(s, 1000, 27, 0));
    const left = projectDirection(s, offsetAt(s, 1000, -27, 0));
    expect(right.x).toBeCloseTo(1, 9);
    expect(left.x).toBeCloseTo(-1, 9);
    expect(right.pixelX).toBeCloseTo(1920, 6);
    expect(left.pixelX).toBeCloseTo(0, 6);
    expect(right.inFrame).toBe(true);
  });

  it("lands exactly on the top and bottom frame edges", () => {
    const s = setup({ horizontalFovDeg: 54 });
    const half = verticalFovForFormat(54, HD) / 2;
    const top = projectDirection(s, offsetAt(s, 1000, 0, half));
    const bottom = projectDirection(s, offsetAt(s, 1000, 0, -half));
    expect(top.y).toBeCloseTo(1, 9);
    expect(bottom.y).toBeCloseTo(-1, 9);
    expect(top.pixelY).toBeCloseTo(0, 6);
    expect(bottom.pixelY).toBeCloseTo(1080, 6);
  });

  it("reports a point just outside the frame as out of frame", () => {
    const s = setup({ horizontalFovDeg: 54 });
    const out = projectDirection(s, offsetAt(s, 1000, 27.5, 0));
    expect(out.inFrame).toBe(false);
    expect(Math.abs(out.x)).toBeGreaterThan(1);
    expect(out.behind).toBe(false);
  });

  it("refuses to place a point behind the camera", () => {
    const s = setup();
    const behind = projectDirection(s, { east: 0, north: -1000, up: 0 });
    expect(behind.behind).toBe(true);
    expect(behind.inFrame).toBe(false);
    expect(behind.angularOffsetDeg).toBeCloseTo(180, 6);
  });

  it("uses perspective, not a linear degrees-to-pixels scale", () => {
    const s = setup({ horizontalFovDeg: 110 });
    const half = 55;
    const edge = projectDirection(s, offsetAt(s, 1000, half, 0));
    const middle = projectDirection(s, offsetAt(s, 1000, half / 2, 0));
    expect(edge.x).toBeCloseTo(1, 9);
    // Linear would put half the angle at half the frame. A flat sensor does
    // not: tan(27.5)/tan(55) is well under a half.
    expect(middle.x).toBeLessThan(0.45);
    expect(middle.x).toBeCloseTo(
      Math.tan((half / 2) * (Math.PI / 180)) / Math.tan(half * (Math.PI / 180)),
      9,
    );
  });

  it("measures angular offset from the optical axis", () => {
    const s = setup({ bearingDeg: 137, tiltDeg: 11 });
    const p = projectDirection(s, offsetAt(s, 3000, 7, 0));
    expect(p.angularOffsetDeg).toBeCloseTo(7, 6);
  });

  it("tracks the camera when it is aimed elsewhere", () => {
    for (const bearing of [0, 90, 180, 270, 43]) {
      const s = setup({ bearingDeg: bearing, tiltDeg: 6 });
      const p = projectDirection(s, offsetAt(s, 2000, 0, 0));
      expect(p.pixelX).toBeCloseTo(960, 6);
      expect(p.pixelY).toBeCloseTo(540, 6);
    }
  });

  it("puts a target to the right of the optical axis on the right of the frame", () => {
    const expected: Record<number, EnuOffset> = {
      0: { east: 80, north: 1000, up: 0 },
      90: { east: 1000, north: -80, up: 0 },
      180: { east: -80, north: -1000, up: 0 },
      270: { east: -1000, north: 80, up: 0 },
    };
    for (const bearing of [0, 90, 180, 270]) {
      for (const tilt of [0, 6, 35]) {
        const s = setup({ bearingDeg: bearing, tiltDeg: tilt });
        const right = projectDirection(s, expected[bearing]);
        expect(right.behind).toBe(false);
        expect(right.x).toBeGreaterThan(0);
      }
    }
  });

  it("puts a target above the optical axis above the centre", () => {
    for (const bearing of [0, 90, 180, 270]) {
      for (const tilt of [0, 6, 35]) {
        const s = setup({ bearingDeg: bearing, tiltDeg: tilt });
        const above = projectDirection(s, offsetAt(s, 1000, 0, 4));
        expect(above.y).toBeGreaterThan(0);
        expect(above.pixelY).toBeLessThan(540);
      }
    }
  });

  it("survives a degenerate field of view instead of dividing by zero", () => {
    const s = setup({ horizontalFovDeg: 0 });
    const p = projectDirection(s, { east: 0, north: 1000, up: 0 });
    expect(p.inFrame).toBe(false);
    expect(Number.isFinite(p.x)).toBe(true);
  });
});

describe("target pixel footprint", () => {
  it("halves when the target is twice as far", () => {
    const s = setup({ horizontalFovDeg: 54 });
    const near = projectObjectSize(s, offsetAt(s, 1000, 0, 0), 2, 2);
    const far = projectObjectSize(s, offsetAt(s, 2000, 0, 0), 2, 2);
    expect(far.widthPixels).toBeCloseTo(near.widthPixels / 2, 1);
  });

  it("doubles with the raster when the optics are unchanged", () => {
    const base = setup({ format: HD });
    const hd = projectObjectSize(base, offsetAt(base, 2000, 0, 0), 2, 2);
    const uhd = projectObjectSize(
      { ...base, format: UHD },
      offsetAt(base, 2000, 0, 0),
      2,
      2,
    );
    expect(uhd.widthPixels).toBeCloseTo(hd.widthPixels * 2, 3);
    // More pixels over the same ground: a finer sample, not a wider view.
    expect(uhd.metersPerPixel).toBeCloseTo(hd.metersPerPixel / 2, 9);
  });

  it("grows as the lens narrows", () => {
    const offset = offsetAt(setup(), 2000, 0, 0);
    const wide = projectObjectSize(setup({ horizontalFovDeg: 110 }), offset, 2, 2);
    const tele = projectObjectSize(setup({ horizontalFovDeg: 10 }), offset, 2, 2);
    expect(tele.widthPixels).toBeGreaterThan(wide.widthPixels * 5);
  });

  it("scales with the object", () => {
    const s = setup();
    const offset = offsetAt(s, 2000, 0, 0);
    const person = projectObjectSize(s, offset, 2, 2);
    const section = projectObjectSize(s, offset, 5, 3);
    expect(section.widthPixels).toBeCloseTo(person.widthPixels * 2.5, 2);
    expect(section.heightPixels).toBeCloseTo((person.heightPixels * 3) / 2, 2);
  });

  it("agrees with the ground sampling distance on axis", () => {
    const s = setup({ horizontalFovDeg: 54, format: UHD });
    const distance = 2190;
    const size = projectObjectSize(s, offsetAt(s, distance, 0, 0), 2, 2);
    expect(size.widthPixels).toBeCloseTo(2 / size.metersPerPixel, 1);
    expect(size.metersPerPixel).toBeCloseTo(metersPerPixel(s, distance), 9);
  });

  it("stretches an object at the edge of a wide frame, at equal range", () => {
    // A flat sensor spreads an off-axis object over more pixels than the same
    // object the same distance away on the axis.
    const s = setup({ horizontalFovDeg: 110 });
    const centre = projectObjectSize(s, atRange(s, 1000, 0), 2, 2);
    const edge = projectObjectSize(s, atRange(s, 1000, 45), 2, 2);
    expect(edge.widthPixels).toBeGreaterThan(centre.widthPixels * 1.3);
  });

  it("depends on depth rather than lateral offset for a sensor-facing object", () => {
    // An object held parallel to the sensor projects the same width wherever
    // it sits across the frame, as long as its depth is unchanged. This is
    // the billboard assumption, and it is why the test above fixes range.
    const s = setup({ horizontalFovDeg: 110 });
    const centre = projectObjectSize(s, offsetAt(s, 1000, 0, 0), 2, 2);
    const offAxis = projectObjectSize(s, offsetAt(s, 1000, 45, 0), 2, 2);
    expect(offAxis.widthPixels).toBeCloseTo(centre.widthPixels, 9);
  });

  it("gives nothing for a target behind the camera", () => {
    const s = setup();
    const size = projectObjectSize(s, { east: 0, north: -500, up: 0 }, 2, 2);
    expect(size.widthPixels).toBe(0);
    expect(size.heightPixels).toBe(0);
  });

  it("has no sampling distance at zero range", () => {
    expect(metersPerPixel(setup(), 0)).toBe(0);
  });
});

describe("lens presets", () => {
  it("each carry a documented horizontal field of view", () => {
    for (const preset of LENS_PRESETS) {
      expect(preset.horizontalFovDeg).toBeGreaterThan(0);
      expect(preset.horizontalFovDeg).toBeLessThanOrEqual(120);
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it("run from widest to narrowest, each framing tighter than the last", () => {
    const offset = offsetAt(setup(), 2000, 0, 0);
    const widths = LENS_PRESETS.map(
      (preset) =>
        projectObjectSize(
          setup({ horizontalFovDeg: preset.horizontalFovDeg }),
          offset,
          2,
          2,
        ).widthPixels,
    );
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });
});

describe("output resolutions", () => {
  it("are all 16:9, so the lens means the same thing across them", () => {
    for (const resolution of OUTPUT_RESOLUTIONS) {
      expect(sensorAspect(resolution)).toBeCloseTo(16 / 9, 6);
    }
  });

  it("falls back rather than returning nothing for an unknown id", () => {
    expect(outputResolution("nope")).toBe(OUTPUT_RESOLUTIONS[0]);
    expect(outputResolution("4k").widthPixels).toBe(3840);
  });
});

describe("aimAtTarget", () => {
  const CAMERA = {
    position: { latitude: -41.001528744069276, longitude: 147.07141571573635 },
    elevationMeters: 30.9,
  };

  /** A point `distance` metres from the camera on the given bearing. */
  function targetOn(bearingDeg: number, distance: number, elevationMeters: number) {
    const rad = (bearingDeg * Math.PI) / 180;
    const north = (distance * Math.cos(rad)) / 111_320;
    const east =
      (distance * Math.sin(rad)) /
      (111_320 * Math.cos((CAMERA.position.latitude * Math.PI) / 180));
    return {
      position: {
        latitude: CAMERA.position.latitude + north,
        longitude: CAMERA.position.longitude + east,
      },
      elevationMeters,
    };
  }

  it("turns to the target's geodesic bearing at every cardinal point", () => {
    for (const bearing of [0, 90, 180, 270]) {
      const aim = aimAtTarget(CAMERA, targetOn(bearing, 2000, 0));
      const expected = inverseGeodesic(
        CAMERA.position,
        targetOn(bearing, 2000, 0).position,
      ).initialBearingDeg;
      expect(aim.bearingDeg).toBeCloseTo(expected, 9);
      expect(Math.min(Math.abs(aim.bearingDeg - bearing), 360 - Math.abs(aim.bearingDeg - bearing))).toBeLessThan(0.3);
    }
  });

  it("handles intermediate bearings", () => {
    for (const bearing of [37, 135, 213, 318]) {
      const aim = aimAtTarget(CAMERA, targetOn(bearing, 3000, 0));
      // Signed shortest difference. The target is laid out with a flat-earth
      // approximation, so a fraction of a degree is the helper, not the aim.
      const gap = Math.abs(((aim.bearingDeg - bearing + 540) % 360) - 180);
      expect(gap).toBeLessThan(0.5);
    }
  });

  it("tilts down to a target below the lens", () => {
    const aim = aimAtTarget(CAMERA, targetOn(0, 2000, 0));
    expect(aim.tiltDeg).toBeGreaterThan(0);
    expect(aim.clamped).toBe(false);
    // 30.9 m of lens over a sea-level target 2 km out, plus geometric curvature.
    expect(aim.tiltDeg).toBeCloseTo(0.89, 1);
  });

  it("asks to look upwards at a target above the lens, and says it cannot", () => {
    const aim = aimAtTarget(CAMERA, targetOn(0, 1000, 400));
    expect(aim.requestedTiltDeg).toBeLessThan(0);
    // The mount only tilts downwards, so the request is reported, not hidden.
    expect(aim.tiltDeg).toBe(0);
    expect(aim.clamped).toBe(true);
  });

  it("points straight down at a target directly below", () => {
    const aim = aimAtTarget(CAMERA, {
      position: CAMERA.position,
      elevationMeters: 0,
    });
    expect(aim.tiltDeg).toBe(MAX_TILT_DEG);
    expect(aim.clamped).toBe(false);
  });

  it("keeps the current bearing when the target is directly below", () => {
    const aim = aimAtTarget(
      CAMERA,
      { position: CAMERA.position, elevationMeters: 0 },
      { currentBearingDeg: 212 },
    );
    expect(aim.bearingDeg).toBe(212);
  });

  it("stays finite at a near-zero distance", () => {
    const aim = aimAtTarget(CAMERA, targetOn(0, 0.001, 30.9));
    expect(Number.isFinite(aim.bearingDeg)).toBe(true);
    expect(Number.isFinite(aim.tiltDeg)).toBe(true);
  });

  it("centres the target in the frame once applied", () => {
    const target = targetOn(47, 2500, 0);
    const aim = aimAtTarget(CAMERA, target);
    const { distanceMeters } = inverseGeodesic(CAMERA.position, target.position);
    const offset = aimedEnuOffset(CAMERA, target, distanceMeters);
    const p = projectDirection(
      setup({ bearingDeg: aim.bearingDeg, tiltDeg: aim.tiltDeg }),
      offset,
    );
    expect(p.angularOffsetDeg).toBeLessThan(0.01);
    expect(p.pixelX).toBeCloseTo(960, 0);
    expect(p.pixelY).toBeCloseTo(540, 0);
  });

  it("does not mix refraction into the geometric aim used by the viewfinder", () => {
    const target = targetOn(0, 15_000, 0);
    const geometric = aimAtTarget(CAMERA, target);
    const refracted = aimAtTarget(CAMERA, target, {
      refractionK: DEFAULT_REFRACTION_K,
    });
    expect(refracted.tiltDeg).toBeLessThan(geometric.tiltDeg);

    const { distanceMeters } = inverseGeodesic(CAMERA.position, target.position);
    const chord = aimedEnuOffset(
      CAMERA,
      target,
      distanceMeters,
      GEOMETRIC_REFRACTION_K,
    );
    const centred = projectDirection(
      setup({
        bearingDeg: geometric.bearingDeg,
        tiltDeg: geometric.tiltDeg,
        horizontalFovDeg: 10,
      }),
      chord,
    );
    const mixed = projectDirection(
      setup({
        bearingDeg: refracted.bearingDeg,
        tiltDeg: refracted.tiltDeg,
        horizontalFovDeg: 10,
      }),
      chord,
    );
    expect(centred.pixelY).toBeCloseTo(540, 0);
    // Aimed along the refracted path, the rendered chord sits below centre.
    expect(mixed.pixelY).toBeGreaterThan(centred.pixelY + 1);
  });
});
