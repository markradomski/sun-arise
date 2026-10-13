import { entryForModelUrl } from "../houses/catalog";
import { eastNorthOffset } from "./geo";
import type { GeoPosition, SceneObject } from "./types";

/**
 * Whether a picked point can plausibly be a camera mounting point on a house.
 *
 * `scene.pickPosition` reads the depth buffer, and this project's house models
 * contain glazing. Translucent surfaces do not write reliable depth, so a click
 * on a window can come back as the terrain behind the building, a point far
 * beyond it, or nothing at all. None of those are a roof.
 *
 * A rejected pick is reported as rejected. It is never quietly replaced with
 * the terrain beneath the cursor: that would silently move a camera the user
 * believes they placed on the roof down to ground level, changing every
 * sightline and every mount height that follows from it.
 *
 * Bounds come from the catalog box the solar engine already uses, widened by
 * a tolerance for the parts a declared footprint does not describe — eaves,
 * a ridge above the nominal height, a parapet.
 */

export type MountRejection =
  | "NO_SURFACE"
  | "NOT_FINITE"
  | "OFF_FOOTPRINT"
  | "BELOW_BASE"
  | "ABOVE_MODEL";

export type MountSurfaceResult =
  | { ok: true; surface: GeoPosition }
  | { ok: false; reason: MountRejection };

/** Eaves and overhangs the declared footprint does not cover. */
export const FOOTPRINT_TOLERANCE_METERS = 1.5;
/** Slack below the base, for terrain datum drift under the model. */
export const BASE_TOLERANCE_METERS = 0.5;
/** Ridge, parapet or chimney above the catalog's approximate height. */
export const RIDGE_TOLERANCE_METERS = 2;

const FALLBACK_FOOTPRINT_METERS = 12;
const FALLBACK_HEIGHT_METERS = 6;
const DEG = Math.PI / 180;

export interface MountBounds {
  /** Half extent across the model's front, metres. */
  halfWidthMeters: number;
  /** Half extent along the model's front, metres. */
  halfDepthMeters: number;
  /** Lowest acceptable elevation. */
  minHeightMeters: number;
  /** Highest acceptable elevation. */
  maxHeightMeters: number;
}

export function mountBounds(house: SceneObject): MountBounds {
  const entry = entryForModelUrl(house.modelUrl);
  const scale = (entry?.baseScale ?? 1) * house.scale;
  const width = (entry?.footprint.width ?? FALLBACK_FOOTPRINT_METERS) * scale;
  const depth = (entry?.footprint.depth ?? FALLBACK_FOOTPRINT_METERS) * scale;
  const height = (entry?.heightMeters ?? FALLBACK_HEIGHT_METERS) * scale;

  return {
    halfWidthMeters: width / 2 + FOOTPRINT_TOLERANCE_METERS,
    halfDepthMeters: depth / 2 + FOOTPRINT_TOLERANCE_METERS,
    minHeightMeters: house.position.height - BASE_TOLERANCE_METERS,
    maxHeightMeters: house.position.height + height + RIDGE_TOLERANCE_METERS,
  };
}

/**
 * Accepts a picked surface only if it lies on the house the user clicked.
 *
 * `surface` may be undefined, which is what an unsupported or failed depth
 * pick gives.
 */
export function validateMountSurface(
  surface: GeoPosition | undefined | null,
  house: SceneObject,
): MountSurfaceResult {
  if (!surface) return { ok: false, reason: "NO_SURFACE" };

  const { latitude, longitude, height } = surface;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(height) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { ok: false, reason: "NOT_FINITE" };
  }

  const bounds = mountBounds(house);

  // Rotate the horizontal offset into the model's own frame. Local "across"
  // runs along the declared width, "along" along the depth, matching how
  // footprint samples are laid out.
  const { east, north } = eastNorthOffset(house.position, surface);
  const distance = Math.hypot(east, north);
  const bearing = Math.atan2(east, north) / DEG;
  const local = (bearing - house.rotation.heading) * DEG;
  const across = distance * Math.sin(local);
  const along = distance * Math.cos(local);

  if (
    Math.abs(across) > bounds.halfWidthMeters ||
    Math.abs(along) > bounds.halfDepthMeters
  ) {
    return { ok: false, reason: "OFF_FOOTPRINT" };
  }

  // A pick that lands at or under the base is the classic glazing failure:
  // the depth buffer let the ray through to the ground behind the glass.
  if (height < bounds.minHeightMeters) return { ok: false, reason: "BELOW_BASE" };
  if (height > bounds.maxHeightMeters) return { ok: false, reason: "ABOVE_MODEL" };

  return { ok: true, surface: { latitude, longitude, height } };
}

export function mountRejectionMessage(reason: MountRejection): string {
  switch (reason) {
    case "NO_SURFACE":
      return "That click did not land on a solid part of the house. Try a roof or wall surface rather than a window.";
    case "NOT_FINITE":
      return "That surface could not be read as a position. Try again on a roof surface.";
    case "OFF_FOOTPRINT":
      return "That point sits outside the building. Glazing can read through to whatever is behind it, so pick a solid roof surface.";
    case "BELOW_BASE":
      return "That point came back below the building, which happens when a click passes through glass. Pick a roof or wall surface.";
    case "ABOVE_MODEL":
      return "That point came back above the building. Pick a surface on the roof itself.";
  }
}
