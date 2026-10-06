/**
 * The scene's source of truth.
 *
 * Deliberately free of any Cesium (or other renderer) types: the renderer
 * consumes SceneObject[], never the other way around. That seam is what makes
 * a future Three.js / R3F object layer a contained change rather than a rewrite.
 */

export type ObjectType = "house" | "tree" | "wall" | "solar-panel";

/**
 * Named camera states. Lives here rather than in `cesium/` so the store can
 * reference it without importing from the renderer.
 */
export type CameraMode = "ORBIT" | "REGION" | "SITE" | "HOUSE" | "SOLAR";

export interface GeoPosition {
  latitude: number;
  longitude: number;
  /** Metres above the WGS84 ellipsoid. */
  height: number;
}

export interface GeoRotation {
  /** Degrees clockwise from true north. */
  heading: number;
  pitch: number;
  roll: number;
}

export interface SceneObject {
  id: string;
  type: ObjectType;
  modelUrl: string;
  position: GeoPosition;
  rotation: GeoRotation;
  /** Uniform scale multiplier applied on top of the catalog's base scale. */
  scale: number;
  /** When true, `position.height` is kept in sync with the terrain beneath it. */
  clampToGround: boolean;
}

export const DEFAULT_ROTATION: GeoRotation = { heading: 0, pitch: 0, roll: 0 };

let counter = 0;

export function nextObjectId(type: ObjectType): string {
  counter += 1;
  return `${type}-${counter}`;
}
