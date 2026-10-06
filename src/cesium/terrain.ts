import {
  Cartographic,
  EllipsoidTerrainProvider,
  Ion,
  createWorldTerrainAsync,
  sampleTerrainMostDetailed,
  type Globe,
  type TerrainProvider,
} from "cesium";
import type { TerrainStatus } from "../scene/types";

export interface TerrainSetup {
  provider: TerrainProvider;
  /** APPROXIMATE when no token is configured, UNAVAILABLE when loading failed. */
  status: Extract<TerrainStatus, "READY" | "UNAVAILABLE" | "APPROXIMATE">;
  providerName: string;
}

export async function createTerrain(): Promise<TerrainSetup> {
  const token = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim();

  if (!token) {
    return {
      provider: new EllipsoidTerrainProvider(),
      status: "APPROXIMATE",
      providerName: "WGS84 ellipsoid",
    };
  }

  Ion.defaultAccessToken = token;

  try {
    return {
      provider: await createWorldTerrainAsync(),
      status: "READY",
      providerName: "Cesium World Terrain",
    };
  } catch (error) {
    console.warn("[terrain] World terrain failed to load.", error);
    return {
      provider: new EllipsoidTerrainProvider(),
      status: "UNAVAILABLE",
      providerName: "WGS84 ellipsoid (world terrain unavailable)",
    };
  }
}

/**
 * Synchronous best-effort height from tiles already resident. Safe to call
 * every frame during a drag; returns undefined rather than 0 when the tile
 * covering the point has not loaded, so callers can tell "ground is at sea
 * level" from "we do not know yet".
 */
export function loadedHeight(
  globe: Globe,
  latitude: number,
  longitude: number,
): number | undefined {
  return globe.getHeight(Cartographic.fromDegrees(longitude, latitude));
}

/**
 * Precise elevations for a batch of positions. One request covers all of them,
 * which is why footprint sampling costs the same as sampling a single point.
 */
export async function sampleElevations(
  provider: TerrainProvider,
  positions: { latitude: number; longitude: number }[],
): Promise<(number | undefined)[]> {
  if (positions.length === 0) return [];

  const carto = positions.map((p) => Cartographic.fromDegrees(p.longitude, p.latitude));
  const sampled = await sampleTerrainMostDetailed(provider, carto);
  return sampled.map((s) => (Number.isFinite(s?.height) ? s.height : undefined));
}
