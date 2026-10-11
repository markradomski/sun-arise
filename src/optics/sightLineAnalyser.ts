import type { TerrainProfile, TerrainProfiler } from "./lineOfSight";
import {
  analyseSightLine,
  type SightLineAnalysis,
  type SightLineEndpoint,
} from "./sightLine";

/**
 * Drives sight-line analysis: coalesces rapid edits, issues one terrain
 * request, and refuses results that a later edit has superseded.
 *
 * Deliberately free of both React and Cesium. The terrain comes through a
 * `TerrainProfiler`, so the awkward cases — a target replaced mid-request, the
 * camera moved mid-request, the target removed mid-request — are ordinary unit
 * tests rather than something only the browser can show.
 */

export type SightLineState =
  | { status: "IDLE" }
  | { status: "PENDING" }
  | { status: "READY"; analysis: SightLineAnalysis }
  | { status: "FAILED"; message: string };

export const DEFAULT_DEBOUNCE_MS = 220;

export interface SightLineAnalyserOptions {
  profiler: TerrainProfiler;
  onState: (state: SightLineState) => void;
  debounceMs?: number;
  maxSamples?: number;
}

export class SightLineAnalyser {
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private options: SightLineAnalyserOptions) {}

  /**
   * Analyse this pair once the edits stop. Calling again before the debounce
   * elapses replaces the pending request rather than queueing a second one.
   */
  request(camera: SightLineEndpoint, target: SightLineEndpoint) {
    if (this.disposed) return;

    const token = ++this.token;
    if (this.timer !== null) clearTimeout(this.timer);
    this.options.onState({ status: "PENDING" });

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(token, camera, target);
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Abandon any work in flight and go quiet. For a removed target. */
  clear() {
    this.token += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.disposed) this.options.onState({ status: "IDLE" });
  }

  dispose() {
    this.disposed = true;
    this.token += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(
    token: number,
    camera: SightLineEndpoint,
    target: SightLineEndpoint,
  ) {
    let profile: TerrainProfile;
    try {
      profile = await this.options.profiler.profile(camera.position, target.position, {
        maxSamples: this.options.maxSamples,
      });
    } catch (error) {
      if (this.stale(token)) return;
      this.options.onState({
        status: "FAILED",
        message: error instanceof Error ? error.message : "Terrain request failed.",
      });
      return;
    }

    if (this.stale(token)) return;

    this.options.onState({
      status: "READY",
      analysis: analyseSightLine(
        profile,
        withProfileElevation(camera, profile, 0),
        withProfileElevation(target, profile, profile.samples.length - 1),
      ),
    });
  }

  private stale(token: number): boolean {
    return this.disposed || token !== this.token;
  }
}

/**
 * Prefer the endpoint's elevation from this profile over the one the caller
 * stored.
 *
 * Both ends then come from a single terrain request at a single level of
 * detail, so the clearance cannot be an artefact of the camera's elevation
 * having been sampled at a different moment from the target's. The stored
 * value remains the fallback when that endpoint did not resolve.
 */
function withProfileElevation(
  endpoint: SightLineEndpoint,
  profile: TerrainProfile,
  index: number,
): SightLineEndpoint {
  const sampled = profile.samples[index]?.terrainElevationMeters;
  return sampled === undefined
    ? endpoint
    : { ...endpoint, terrainElevationMeters: sampled };
}
