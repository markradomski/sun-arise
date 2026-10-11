/**
 * Where to sample terrain along a sight line.
 *
 * Spacing widens with distance. Most of what blocks a coastal camera is in the
 * first few hundred metres — a bank, a dune, the lip of the paddock — and a
 * ridge five kilometres out is broad enough that metre-scale sampling buys
 * nothing. Sampling finely near the observer and coarsely far away therefore
 * spends the sample budget where it changes the answer.
 *
 * Pure arithmetic over distances: it knows nothing about terrain, Cesium or
 * which points are reachable.
 */

/** A terrain request is one round trip, so this bounds its cost, not its rate. */
export const MAX_PROFILE_SAMPLES = 400;

export const MIN_SPACING_METERS = 5;
export const MAX_SPACING_METERS = 60;

/** Spacing grows by this much per metre travelled, before any budget scaling. */
const SPACING_GROWTH = 1 / 90;

/**
 * Shortest path worth analysing. Below this the endpoints are within terrain
 * sampling resolution of each other and a profile says nothing.
 */
export const MIN_PATH_METERS = 20;

function spacingAt(distanceMeters: number, scale: number): number {
  const raw = MIN_SPACING_METERS + distanceMeters * SPACING_GROWTH;
  return Math.min(MAX_SPACING_METERS * scale, Math.max(MIN_SPACING_METERS * scale, raw * scale));
}

function walk(totalMeters: number, scale: number): number[] {
  const distances = [0];
  let distance = 0;
  while (distance < totalMeters) {
    distance += spacingAt(distance, scale);
    if (distance >= totalMeters) break;
    distances.push(distance);
  }
  return distances;
}

/**
 * Sample distances from the observer to the target, both endpoints included.
 *
 * Strictly increasing, and always carries a sample immediately inside each
 * endpoint: the clearance test ignores the endpoints themselves, so without
 * those neighbours the ground right under the mast and right at the target
 * would go unexamined.
 *
 * Returns an empty plan for a path too short to analyse.
 */
export function planProfileDistances(
  totalMeters: number,
  maxSamples = MAX_PROFILE_SAMPLES,
): number[] {
  if (!Number.isFinite(totalMeters) || totalMeters < MIN_PATH_METERS) return [];
  if (maxSamples < 4) return [];

  // Widen everything uniformly until the walk fits the budget, so the near/far
  // ratio is preserved rather than the far field being truncated. Three slots
  // are held back for the target and the two endpoint neighbours below.
  const budget = maxSamples - 3;
  let scale = 1;
  let distances = walk(totalMeters, scale);
  while (distances.length > budget) {
    scale *= distances.length / budget;
    distances = walk(totalMeters, scale);
  }

  distances.push(totalMeters);

  // The walk starts at the observer and ends at the target, but the last step
  // can leave a wide gap before the target; make sure something sits just
  // inside it. Half the finest spacing is close enough to count as adjacent.
  const inset = Math.min(MIN_SPACING_METERS / 2, totalMeters / 4);
  const lastInterior = distances[distances.length - 2];
  if (totalMeters - lastInterior > inset * 2) {
    distances.splice(distances.length - 1, 0, totalMeters - inset);
  }
  if (distances[1] > inset * 2) {
    distances.splice(1, 0, inset);
  }

  return distances;
}
