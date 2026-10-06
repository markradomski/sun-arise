import { offsetByBearing } from "./geo";
import type { SceneObject } from "./types";
import { entryForModelUrl } from "../houses/catalog";

export interface FootprintSample {
  /** Metres east of the footprint centre. */
  east: number;
  /** Metres north of the footprint centre. */
  north: number;
  latitude: number;
  longitude: number;
}

/**
 * Nine sampling positions over an object's footprint: four corners, four edge
 * midpoints and the centre.
 *
 * Offsets are returned in east/north rather than the object's own frame, so
 * slope direction comes out of the analysis as a true bearing without the
 * analysis needing to know the heading.
 */
const UNIT_OFFSETS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [0, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export function footprintSamples(object: SceneObject): FootprintSample[] {
  const entry = entryForModelUrl(object.modelUrl);
  const scale = (entry?.baseScale ?? 1) * object.scale;
  const halfWidth = ((entry?.footprint.width ?? 12) * scale) / 2;
  const halfDepth = ((entry?.footprint.depth ?? 12) * scale) / 2;
  const heading = object.rotation.heading;

  return UNIT_OFFSETS.map(([ux, uy]) => {
    const acrossFront = ux * halfWidth;
    const alongFront = uy * halfDepth;
    const distance = Math.hypot(acrossFront, alongFront);

    // Local +y is the direction the front faces, which is north at heading 0.
    const bearing =
      heading + (Math.atan2(acrossFront, alongFront) * 180) / Math.PI;
    const point =
      distance === 0
        ? { latitude: object.position.latitude, longitude: object.position.longitude }
        : offsetByBearing(object.position, bearing, distance);

    const bearingRad = (bearing * Math.PI) / 180;
    return {
      east: distance * Math.sin(bearingRad),
      north: distance * Math.cos(bearingRad),
      latitude: point.latitude,
      longitude: point.longitude,
    };
  });
}
