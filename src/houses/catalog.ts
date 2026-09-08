import type { ObjectType } from "../scene/types";

/**
 * Model manifest.
 *
 * `baseScale` lives here so the renderer never has to special-case a model by
 * filename — it replaces the `url.includes("bungalow")` check that used to sit
 * in CesiumScene.placeHouse.
 */
export interface CatalogEntry {
  slug: string;
  name: string;
  type: ObjectType;
  modelUrl: string;
  /** Multiplier that brings the source GLB to real-world metres. */
  baseScale: number;
  /** Approximate real-world height in metres, used for shadow geometry. */
  heightMeters: number;
}

export const CATALOG: Record<string, CatalogEntry> = {
  "mid-century": {
    slug: "mid-century",
    name: "Mid-century",
    type: "house",
    modelUrl: "/models/mid-century-house.glb",
    baseScale: 1,
    heightMeters: 8,
  },
  bungalow: {
    slug: "bungalow",
    name: "Bungalow",
    type: "house",
    modelUrl: "/models/bungalow.glb",
    baseScale: 0.05,
    heightMeters: 6,
  },
  sample: {
    slug: "sample",
    name: "Sample",
    type: "house",
    modelUrl: "/models/sample-house.glb",
    baseScale: 1,
    heightMeters: 8,
  },
};

export const DEFAULT_HOUSE_SLUG = "mid-century";

export function catalogEntry(slug: string): CatalogEntry {
  return CATALOG[slug] ?? CATALOG[DEFAULT_HOUSE_SLUG];
}

/** Reverse lookup so the renderer can recover metadata from a placed object. */
export function entryForModelUrl(modelUrl: string): CatalogEntry | undefined {
  return Object.values(CATALOG).find((entry) => entry.modelUrl === modelUrl);
}
