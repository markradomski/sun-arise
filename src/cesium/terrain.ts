import {
  Cartographic,
  EllipsoidTerrainProvider,
  Math as CesiumMath,
  createWorldTerrainAsync,
  sampleTerrainMostDetailed,
  type Globe,
  type TerrainProvider,
} from "cesium";

/**
 * Terrain height sampling comes in two flavours, and using the wrong one is the
 * classic way to make dragging stutter:
 *
 *   approxHeight  — synchronous, reads only currently-loaded tiles. Use during
 *                   a drag, every frame.
 *   settleHeight  — asynchronous and precise. Use once, on drag end.
 */

export interface TerrainSetup {
  provider: TerrainProvider;
  /** False when no ion token is configured and we fell back to the ellipsoid. */
  hasWorldTerrain: boolean;
}

export async function createTerrain(): Promise<TerrainSetup> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;

  if (!token) {
    return { provider: new EllipsoidTerrainProvider(), hasWorldTerrain: false };
  }

  try {
    return { provider: await createWorldTerrainAsync(), hasWorldTerrain: true };
  } catch (error) {
    console.warn(
      "[terrain] World terrain failed to load; falling back to the ellipsoid.",
      error,
    );
    return { provider: new EllipsoidTerrainProvider(), hasWorldTerrain: false };
  }
}

/** Synchronous best-effort height. Safe to call every frame. */
export function approxHeight(globe: Globe, latitude: number, longitude: number): number {
  const carto = Cartographic.fromDegrees(longitude, latitude);
  return globe.getHeight(carto) ?? 0;
}

/** Precise height. Await this once, when a drag ends. */
export async function settleHeight(
  provider: TerrainProvider,
  latitude: number,
  longitude: number,
): Promise<number> {
  if (provider instanceof EllipsoidTerrainProvider) return 0;

  try {
    const [sampled] = await sampleTerrainMostDetailed(provider, [
      Cartographic.fromDegrees(longitude, latitude),
    ]);
    return sampled?.height ?? 0;
  } catch (error) {
    console.warn("[terrain] settleHeight failed; keeping approximate height.", error);
    return approxHeightFallback(latitude, longitude);
  }
}

function approxHeightFallback(_latitude: number, _longitude: number): number {
  return 0;
}

export function toCartographicDegrees(carto: Cartographic) {
  return {
    latitude: CesiumMath.toDegrees(carto.latitude),
    longitude: CesiumMath.toDegrees(carto.longitude),
    height: carto.height,
  };
}
