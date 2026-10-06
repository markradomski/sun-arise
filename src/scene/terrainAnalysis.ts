import type { FootprintSample } from "./footprint";

export type SlopeClass = "FLAT" | "GENTLE" | "MODERATE" | "STEEP";

/**
 * Geometric descriptions only. These say nothing about engineering
 * suitability, planning compliance or buildability.
 */
export const SLOPE_THRESHOLDS_DEG: { limit: number; value: SlopeClass }[] = [
  { limit: 2, value: "FLAT" },
  { limit: 5, value: "GENTLE" },
  { limit: 15, value: "MODERATE" },
  { limit: Infinity, value: "STEEP" },
];

export interface MeasuredSample extends FootprintSample {
  elevation: number;
}

export interface FootprintTerrain {
  samples: MeasuredSample[];
  /** How many of the requested nine positions returned an elevation. */
  sampled: number;
  requested: number;
  minimum: number;
  maximum: number;
  mean: number;
  median: number;
  range: number;
  slopeDeg: number;
  /** Compass bearing the ground falls towards, or undefined if effectively level. */
  downslopeBearing?: number;
  classification: SlopeClass;
  /** Elevation at which a level object should sit. */
  levelElevation: number;
}

export function analyseFootprint(
  samples: MeasuredSample[],
  requested: number,
): FootprintTerrain | null {
  if (samples.length === 0) return null;

  const elevations = samples.map((s) => s.elevation);
  const sorted = [...elevations].sort((a, b) => a - b);
  const minimum = sorted[0];
  const maximum = sorted[sorted.length - 1];
  const mean = elevations.reduce((a, b) => a + b, 0) / elevations.length;
  const median =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const { slopeDeg, downslopeBearing } = fitSlope(samples);

  return {
    samples,
    sampled: samples.length,
    requested,
    minimum,
    maximum,
    mean,
    median,
    range: maximum - minimum,
    slopeDeg,
    downslopeBearing,
    classification: classifySlope(slopeDeg),
    // A level object sits on the highest sampled point so it never cuts into
    // the ground. Foundations and earthworks are not simulated, so on steeper
    // ground the low side will visibly stand clear of the surface.
    levelElevation: maximum,
  };
}

export function classifySlope(slopeDeg: number): SlopeClass {
  return (
    SLOPE_THRESHOLDS_DEG.find((t) => slopeDeg < t.limit)?.value ?? "STEEP"
  );
}

/**
 * Least-squares plane through the samples, in metres east/north.
 *
 * Needs at least three samples that are not collinear; a degenerate set is
 * reported as level rather than producing an arbitrary direction.
 */
function fitSlope(samples: MeasuredSample[]): {
  slopeDeg: number;
  downslopeBearing?: number;
} {
  if (samples.length < 3) return { slopeDeg: 0 };

  const n = samples.length;
  const meanEast = samples.reduce((a, s) => a + s.east, 0) / n;
  const meanNorth = samples.reduce((a, s) => a + s.north, 0) / n;
  const meanElev = samples.reduce((a, s) => a + s.elevation, 0) / n;

  let see = 0, snn = 0, sen = 0, sez = 0, snz = 0;
  for (const s of samples) {
    const e = s.east - meanEast;
    const nn = s.north - meanNorth;
    const z = s.elevation - meanElev;
    see += e * e;
    snn += nn * nn;
    sen += e * nn;
    sez += e * z;
    snz += nn * z;
  }

  const det = see * snn - sen * sen;
  if (Math.abs(det) < 1e-9) return { slopeDeg: 0 };

  const gradEast = (sez * snn - snz * sen) / det;
  const gradNorth = (snz * see - sez * sen) / det;
  const magnitude = Math.hypot(gradEast, gradNorth);
  const slopeDeg = (Math.atan(magnitude) * 180) / Math.PI;

  if (magnitude < 1e-6) return { slopeDeg: 0 };

  const bearing =
    (((Math.atan2(-gradEast, -gradNorth) * 180) / Math.PI) + 360) % 360;
  return { slopeDeg, downslopeBearing: bearing };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compassPoint(bearingDeg: number): string {
  return COMPASS[Math.round(bearingDeg / 45) % 8];
}
