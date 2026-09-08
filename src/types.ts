export interface SolarPosition {
  azimuthDeg: number;
  altitudeDeg: number;
  sunriseMinutes: number;
  sunsetMinutes: number;
}

// Location and HouseInstance moved to src/scene/types.ts as GeoPosition and
// SceneObject — the scene is now a keyed collection rather than a single house.
export type { GeoPosition as Location, SceneObject } from "./scene/types";
