import { describe, expect, it } from "vitest";
import {
  classifyQuery,
  formatCoordinates,
  isValidLatitude,
  isValidLongitude,
  parseCoordinates,
} from "./location";

describe("parseCoordinates", () => {
  it("parses a comma-separated pair", () => {
    expect(parseCoordinates("-41.0023, 147.0858")).toEqual({
      latitude: -41.0023,
      longitude: 147.0858,
    });
  });

  it("accepts a space separator and surrounding whitespace", () => {
    expect(parseCoordinates("   -41.0023 147.0858  ")).toEqual({
      latitude: -41.0023,
      longitude: 147.0858,
    });
    expect(parseCoordinates("-41.0023,147.0858")).toEqual({
      latitude: -41.0023,
      longitude: 147.0858,
    });
  });

  it("accepts both signs and whole numbers", () => {
    expect(parseCoordinates("41, -147")).toEqual({ latitude: 41, longitude: -147 });
    expect(parseCoordinates("0, 0")).toEqual({ latitude: 0, longitude: 0 });
  });

  it("tolerates a degree symbol", () => {
    expect(parseCoordinates("-41.0023°, 147.0858°")).toEqual({
      latitude: -41.0023,
      longitude: 147.0858,
    });
  });

  it("rejects out-of-range values rather than clamping them", () => {
    expect(parseCoordinates("-91, 147")).toBeNull();
    expect(parseCoordinates("41, 181")).toBeNull();
    expect(parseCoordinates("90.0001, 0")).toBeNull();
  });

  it("accepts the exact limits", () => {
    expect(parseCoordinates("-90, -180")).toEqual({ latitude: -90, longitude: -180 });
    expect(parseCoordinates("90, 180")).toEqual({ latitude: 90, longitude: 180 });
  });

  it("returns null for anything that is not a coordinate pair", () => {
    for (const input of [
      "",
      "   ",
      "43 Hurst Street, Lulworth TAS 7252",
      "-41.0023",
      "-41.0023, 147.0858, 12",
      "forty one south",
      "-41.0023; 147.0858",
      "--41, 147",
    ]) {
      expect(parseCoordinates(input)).toBeNull();
    }
  });
});

describe("validation", () => {
  it("bounds latitude and longitude", () => {
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90.1)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180.1)).toBe(false);
    expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("classifyQuery", () => {
  it("routes a coordinate pair to local parsing", () => {
    expect(classifyQuery("-41.0023, 147.0858")).toEqual({
      kind: "COORDINATES",
      value: { latitude: -41.0023, longitude: 147.0858 },
    });
  });

  it("routes an address to the geocoder", () => {
    expect(classifyQuery("  43 Hurst Street, Lulworth TAS 7252 ")).toEqual({
      kind: "ADDRESS",
      value: "43 Hurst Street, Lulworth TAS 7252",
    });
  });

  it("sends an out-of-range numeric pair to the geocoder rather than guessing", () => {
    // Not a valid coordinate, so it is not silently reinterpreted as one.
    expect(classifyQuery("200, 300")).toEqual({ kind: "ADDRESS", value: "200, 300" });
  });

  it("returns null for empty input", () => {
    expect(classifyQuery("")).toBeNull();
    expect(classifyQuery("   ")).toBeNull();
  });
});

describe("formatCoordinates", () => {
  it("shows five decimal places", () => {
    expect(formatCoordinates({ latitude: -41.0023, longitude: 147.0858 })).toBe(
      "-41.00230, 147.08580",
    );
  });
});
