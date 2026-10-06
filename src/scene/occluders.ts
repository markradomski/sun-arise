import { entryForModelUrl } from "../houses/catalog";
import type { BoxOccluder } from "../solar/exposure";
import type { SceneObject } from "./types";

const FALLBACK_FOOTPRINT_METERS = 12;
const FALLBACK_HEIGHT_METERS = 6;

/**
 * Approximates a scene object as the box the exposure engine casts rays
 * against. Depth runs along the object's heading, width across it, matching
 * how footprint samples are laid out.
 */
export function occluderFor(object: SceneObject): BoxOccluder {
  const entry = entryForModelUrl(object.modelUrl);
  const scale = (entry?.baseScale ?? 1) * object.scale;

  return {
    position: object.position,
    widthMeters: (entry?.footprint.width ?? FALLBACK_FOOTPRINT_METERS) * scale,
    depthMeters: (entry?.footprint.depth ?? FALLBACK_FOOTPRINT_METERS) * scale,
    heightMeters: (entry?.heightMeters ?? FALLBACK_HEIGHT_METERS) * scale,
    headingDeg: object.rotation.heading,
  };
}
