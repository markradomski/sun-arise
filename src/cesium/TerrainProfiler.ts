import type { TerrainProvider } from "cesium";
import type { LatLng } from "../scene/geo";
import { geodesicPoints, inverseGeodesic } from "../optics/geodesy";
import type { TerrainProfile, TerrainProfiler } from "../optics/lineOfSight";
import { MAX_PROFILE_SAMPLES, planProfileDistances } from "../optics/profilePlan";

/**
 * Samples Cesium World Terrain along the geodesic between two points.
 *
 * The whole profile is one `sampleTerrainMostDetailed` call, so a thousand-
 * metre sight line costs the same round trip as a short one and the tiles are
 * fetched once. Which distances to sample is decided by `profilePlan`, which
 * is pure; this class only turns them into positions and asks Cesium.
 *
 * Elevations are metres above the WGS84 ellipsoid, the same datum the rest of
 * the app uses. They are not AHD and not mean sea level.
 */
export class CesiumTerrainProfiler implements TerrainProfiler {
  constructor(
    private getProvider: () => TerrainProvider | undefined,
    private sample: (
      provider: TerrainProvider,
      positions: LatLng[],
    ) => Promise<(number | undefined)[]>,
  ) {}

  async profile(
    from: LatLng,
    to: LatLng,
    options: { maxSamples?: number } = {},
  ): Promise<TerrainProfile> {
    const provider = this.getProvider();
    if (!provider) throw new Error("Terrain provider is not ready.");

    const { distanceMeters } = inverseGeodesic(from, to);
    const distances = planProfileDistances(
      distanceMeters,
      options.maxSamples ?? MAX_PROFILE_SAMPLES,
    );

    if (distances.length === 0) {
      return { from, to, samples: [], spacingMeters: 0, unresolvedCount: 0 };
    }

    const positions = geodesicPoints(from, to, distances);
    const elevations = await this.sample(provider, positions);

    let unresolvedCount = 0;
    const samples = distances.map((distance, index) => {
      const elevation = elevations[index];
      if (elevation === undefined) unresolvedCount += 1;
      return {
        position: positions[index],
        distanceMeters: distance,
        terrainElevationMeters: elevation,
      };
    });

    return {
      from,
      to,
      samples,
      spacingMeters: distances[1] ?? 0,
      unresolvedCount,
    };
  }
}
