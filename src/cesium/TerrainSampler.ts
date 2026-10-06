import type { TerrainProvider } from "cesium";
import { footprintSamples } from "../scene/footprint";
import {
  analyseFootprint,
  type FootprintTerrain,
  type MeasuredSample,
} from "../scene/terrainAnalysis";
import type { SceneObject, TerrainStatus } from "../scene/types";
import { sampleElevations } from "./terrain";

/**
 * Footprint terrain sampling with per-object request identity.
 *
 * Sampling is asynchronous and a house can be moved again while a request is
 * in flight. Each request takes the next token for its object; a result whose
 * token is no longer current is discarded, so a slow result for an old
 * position cannot overwrite a newer one.
 */
export class TerrainSampler {
  private tokens = new Map<string, number>();
  private counter = 0;
  private disposed = false;

  constructor(
    private getProvider: () => TerrainProvider | undefined,
    private getStatus: () => TerrainStatus,
  ) {}

  /**
   * Returns null when the object cannot be analysed against real terrain, or
   * when a newer request for the same object has superseded this one.
   */
  async analyse(object: SceneObject): Promise<FootprintTerrain | null> {
    const provider = this.getProvider();
    if (!provider || this.getStatus() !== "READY") return null;

    const token = ++this.counter;
    this.tokens.set(object.id, token);

    const positions = footprintSamples(object);
    let elevations: (number | undefined)[];
    try {
      elevations = await sampleElevations(provider, positions);
    } catch (error) {
      console.warn("[terrain] Footprint sampling failed.", error);
      return null;
    }

    if (this.disposed || this.tokens.get(object.id) !== token) return null;

    const measured: MeasuredSample[] = [];
    positions.forEach((position, index) => {
      const elevation = elevations[index];
      if (elevation !== undefined) measured.push({ ...position, elevation });
    });

    return analyseFootprint(measured, positions.length);
  }

  dispose() {
    this.disposed = true;
    this.tokens.clear();
  }
}
