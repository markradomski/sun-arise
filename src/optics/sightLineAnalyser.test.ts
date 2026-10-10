import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SightLineAnalyser,
  type SightLineState,
} from "./sightLineAnalyser";
import type { LatLng } from "../scene/geo";
import type { TerrainProfile, TerrainProfiler } from "./lineOfSight";
import { geodesicPoints, inverseGeodesic } from "./geodesy";
import { planProfileDistances } from "./profilePlan";
import type { SightLineEndpoint } from "./sightLine";

const CAMERA: LatLng = { latitude: -41.001528744069276, longitude: 147.07141571573635 };

function north(distanceMeters: number): LatLng {
  return geodesicPoints(
    CAMERA,
    { latitude: CAMERA.latitude + 1, longitude: CAMERA.longitude },
    [distanceMeters],
  )[0];
}

function flatProfile(from: LatLng, to: LatLng, elevation = 0): TerrainProfile {
  const { distanceMeters } = inverseGeodesic(from, to);
  const distances = planProfileDistances(distanceMeters);
  const positions = geodesicPoints(from, to, distances);
  return {
    from,
    to,
    samples: distances.map((distanceMeters, index) => ({
      position: positions[index],
      distanceMeters,
      terrainElevationMeters: elevation,
    })),
    spacingMeters: distances[1] ?? 0,
    unresolvedCount: 0,
  };
}

/** A profiler whose every response is held open until the test releases it. */
class DeferredProfiler implements TerrainProfiler {
  calls: { from: LatLng; to: LatLng }[] = [];
  private pending: (() => void)[] = [];

  profile(from: LatLng, to: LatLng): Promise<TerrainProfile> {
    this.calls.push({ from, to });
    return new Promise((resolve) => {
      this.pending.push(() => resolve(flatProfile(from, to)));
    });
  }

  /** Resolve the request made at `index`, oldest first. */
  release(index = 0) {
    const resolve = this.pending[index];
    this.pending[index] = () => {};
    resolve?.();
  }

  releaseAll() {
    for (let i = 0; i < this.pending.length; i += 1) this.release(i);
  }
}

function camera(position = CAMERA): SightLineEndpoint {
  return { position, terrainElevationMeters: 25, heightMeters: 6 };
}

function target(position: LatLng, heightMeters = 0): SightLineEndpoint {
  return { position, terrainElevationMeters: 0, heightMeters };
}

describe("SightLineAnalyser", () => {
  let states: SightLineState[];
  let profiler: DeferredProfiler;
  let analyser: SightLineAnalyser;

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
    profiler = new DeferredProfiler();
    analyser = new SightLineAnalyser({
      profiler,
      onState: (state) => states.push(state),
      debounceMs: 100,
    });
  });

  afterEach(() => {
    analyser.dispose();
    vi.useRealTimers();
  });

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  it("reports pending immediately and ready once terrain arrives", async () => {
    analyser.request(camera(), target(north(2000)));
    expect(states.at(-1)?.status).toBe("PENDING");

    await vi.advanceTimersByTimeAsync(100);
    profiler.release();
    await settle();

    const last = states.at(-1);
    expect(last?.status).toBe("READY");
    if (last?.status === "READY") {
      expect(last.analysis.distanceMeters).toBeCloseTo(2000, 1);
      expect(last.analysis.classification).toBe("CLEAR");
    }
  });

  it("coalesces rapid edits into a single terrain request", async () => {
    for (const height of [0, 1, 2, 3, 4]) {
      analyser.request(camera(), target(north(2000), height));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(100);

    // Dragging a slider must not fire a request per frame.
    expect(profiler.calls).toHaveLength(1);
  });

  it("ignores a stale response after the target is replaced", async () => {
    analyser.request(camera(), target(north(2000)));
    await vi.advanceTimersByTimeAsync(100);

    // Second target chosen while the first request is still open.
    analyser.request(camera(), target(north(5000)));
    await vi.advanceTimersByTimeAsync(100);
    expect(profiler.calls).toHaveLength(2);

    // The first (stale) response lands last and must be discarded.
    profiler.release(1);
    await settle();
    profiler.release(0);
    await settle();

    const last = states.at(-1);
    expect(last?.status).toBe("READY");
    if (last?.status === "READY") {
      expect(last.analysis.distanceMeters).toBeCloseTo(5000, 1);
    }
  });

  it("ignores a response for a camera position that has since moved", async () => {
    analyser.request(camera(CAMERA), target(north(2000)));
    await vi.advanceTimersByTimeAsync(100);

    const moved = north(300);
    analyser.request(camera(moved), target(north(2000)));
    await vi.advanceTimersByTimeAsync(100);

    profiler.release(1);
    await settle();
    profiler.release(0);
    await settle();

    const last = states.at(-1);
    expect(last?.status).toBe("READY");
    if (last?.status === "READY") {
      // Measured from the moved camera, so ~1700 m rather than 2000 m.
      expect(last.analysis.distanceMeters).toBeCloseTo(1700, 0);
    }
  });

  it("drops an in-flight response when the target is removed", async () => {
    analyser.request(camera(), target(north(2000)));
    await vi.advanceTimersByTimeAsync(100);

    analyser.clear();
    expect(states.at(-1)?.status).toBe("IDLE");

    profiler.release();
    await settle();

    // Nothing may arrive after the target is gone.
    expect(states.at(-1)?.status).toBe("IDLE");
  });

  it("never fires a request for an edit cancelled inside the debounce window", async () => {
    analyser.request(camera(), target(north(2000)));
    await vi.advanceTimersByTimeAsync(50);
    analyser.clear();
    await vi.advanceTimersByTimeAsync(500);

    expect(profiler.calls).toHaveLength(0);
    expect(states.at(-1)?.status).toBe("IDLE");
  });

  it("surfaces a terrain failure instead of inventing a verdict", async () => {
    const failing: TerrainProfiler = {
      profile: () => Promise.reject(new Error("tile request failed")),
    };
    const states2: SightLineState[] = [];
    const failingAnalyser = new SightLineAnalyser({
      profiler: failing,
      onState: (state) => states2.push(state),
      debounceMs: 10,
    });

    failingAnalyser.request(camera(), target(north(2000)));
    await vi.advanceTimersByTimeAsync(20);

    const last = states2.at(-1);
    expect(last?.status).toBe("FAILED");
    if (last?.status === "FAILED") expect(last.message).toMatch(/tile request failed/);
    failingAnalyser.dispose();
  });

  it("goes quiet after disposal", async () => {
    analyser.request(camera(), target(north(2000)));
    await vi.advanceTimersByTimeAsync(100);
    const before = states.length;

    analyser.dispose();
    profiler.releaseAll();
    await settle();

    expect(states.length).toBe(before);
  });

  it("prefers the profile's own endpoint elevations over stored ones", async () => {
    const to = north(2000);
    const elevated: TerrainProfiler = {
      profile: (from, target2) => Promise.resolve(flatProfile(from, target2, 12)),
    };
    const states2: SightLineState[] = [];
    const a = new SightLineAnalyser({
      profiler: elevated,
      onState: (state) => states2.push(state),
      debounceMs: 10,
    });

    // Stored elevations say 25 m and 0 m; this profile says 12 m at both ends.
    a.request(camera(), target(to));
    await vi.advanceTimersByTimeAsync(20);

    const last = states2.at(-1);
    expect(last?.status).toBe("READY");
    if (last?.status === "READY") {
      // Both ends come from one request, so neither can be a stale sample.
      expect(last.analysis.observerElevationMeters).toBeCloseTo(18, 6);
      expect(last.analysis.targetElevationMeters).toBeCloseTo(12, 6);
    }
    a.dispose();
  });
});
