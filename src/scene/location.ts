import type { LatLng } from "./geo";

/**
 * Parsing of a location the user typed.
 *
 * Shared application code, not Surf Cam's: navigating to a place is useful to
 * the solar workflow too. Renderer-free so it can be unit tested directly.
 */

export type LocationQuery =
  | { kind: "COORDINATES"; value: LatLng }
  | { kind: "ADDRESS"; value: string };

/**
 * Decimal degrees only, deliberately. Degrees/minutes/seconds and the many
 * ways people write them are a separate problem; anything that is not clearly
 * a coordinate pair is passed to the geocoder as an address rather than being
 * guessed at here.
 *
 * Accepts: "-41.0023, 147.0858", "-41.0023 147.0858", "-41.0023,147.0858",
 * and the same with surrounding whitespace or a degree symbol.
 */
const COORDINATE_PATTERN =
  /^\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*$/;

export function parseCoordinates(input: string): LatLng | null {
  const match = COORDINATE_PATTERN.exec(input);
  if (!match) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  return { latitude, longitude };
}

export function isValidLatitude(latitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

export function isValidLongitude(longitude: number): boolean {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

/** Decides whether to parse locally or hand the text to a geocoder. */
export function classifyQuery(input: string): LocationQuery | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const coordinates = parseCoordinates(trimmed);
  if (coordinates) return { kind: "COORDINATES", value: coordinates };

  return { kind: "ADDRESS", value: trimmed };
}

/** Display form for a resolved position, at roughly metre precision. */
export function formatCoordinates(position: LatLng): string {
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}
