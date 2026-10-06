import type { ObjectType } from "../scene/types";

/**
 * Model manifest.
 *
 * ── Canonical Solar House GLB convention ──────────────────────────────────
 *  Units   metres
 *  Up      +Y   (glTF standard; matches Cesium's default `upAxis`)
 *  Forward -Z   (glTF standard; becomes NORTH at heading 0 in Cesium's ENU
 *               frame, so a house's front faces north at heading 0 — the
 *               solar-correct orientation for the southern hemisphere)
 *  Origin  footprint centre at ground level, so the model sits ON terrain
 *          rather than half-buried
 *
 * Models that follow this need no per-model transform. `baseScale` exists only
 * for imported models that do not — it replaced a `url.includes("bungalow")`
 * check that used to live in the renderer.
 *
 * `footprint` is the horizontal extent in metres. It is declared rather than
 * derived because a model's 3D bounding sphere includes its height, which makes
 * it a poor proxy for the ground footprint — a tall narrow building would get a
 * selection ring far wider than the building itself.
 */
export interface CatalogEntry {
  slug: string;
  name: string;
  type: ObjectType;
  modelUrl: string;
  /** Multiplier that brings the source GLB to real-world metres. */
  baseScale: number;
  /** Approximate real-world height in metres. */
  heightMeters: number;
  /** Horizontal extent in metres, along the model's local X and Z. */
  footprint: { width: number; depth: number };
}

export const CATALOG: Record<string, CatalogEntry> = {
  "contemporary-au": {
    slug: "contemporary-au",
    name: "Contemporary AU",
    type: "house",
    modelUrl: "/models/reference-house.glb",
    baseScale: 1,
    heightMeters: 4.6,
    footprint: { width: 14, depth: 9 },
  },
  "mid-century": {
    slug: "mid-century",
    name: "Mid-century",
    type: "house",
    modelUrl: "/models/mid-century-house.glb",
    baseScale: 1,
    heightMeters: 8,
    footprint: { width: 12, depth: 18 },
  },
  bungalow: {
    slug: "bungalow",
    name: "Bungalow",
    type: "house",
    modelUrl: "/models/bungalow.glb",
    baseScale: 0.05,
    heightMeters: 6,
    footprint: { width: 12, depth: 12 },
  },
  sample: {
    slug: "sample",
    name: "Sample",
    type: "house",
    modelUrl: "/models/sample-house.glb",
    baseScale: 1,
    heightMeters: 8,
    footprint: { width: 12, depth: 18 },
  },
};

export const DEFAULT_HOUSE_SLUG = "contemporary-au";

/** Used when a model is not in the catalog at all. */
const FALLBACK_FOOTPRINT_RADIUS = 7;

export function catalogEntry(slug: string): CatalogEntry {
  return CATALOG[slug] ?? CATALOG[DEFAULT_HOUSE_SLUG];
}

/** Reverse lookup so the renderer can recover metadata from a placed object. */
export function entryForModelUrl(modelUrl: string): CatalogEntry | undefined {
  return Object.values(CATALOG).find((entry) => entry.modelUrl === modelUrl);
}

/**
 * Radius of the circle enclosing the model's footprint, in metres.
 *
 * Uses the footprint diagonal so the circle still contains the building at any
 * heading. Scaled by the object's own multiplier.
 */
export function footprintRadius(modelUrl: string, scale = 1): number {
  const entry = entryForModelUrl(modelUrl);
  if (!entry) return FALLBACK_FOOTPRINT_RADIUS * scale;
  const { width, depth } = entry.footprint;
  return Math.hypot(width / 2, depth / 2) * entry.baseScale * scale;
}
