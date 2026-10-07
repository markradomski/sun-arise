/**
 * Positional alpha mask for the exposure overlay.
 *
 * The overlay is a rectangular raster, and its edge against the satellite
 * imagery reads as a tile boundary rather than as analysis. This fades the
 * outer band away, measuring distance with a rounded-square metric so the
 * corners vanish first instead of leaving a visible square.
 *
 * It is a function of position only. Two cells the same distance from the
 * boundary get the same alpha whatever their exposure, so the mask can never
 * be mistaken for, or interfere with, the hours the ramp encodes.
 */

/** Fraction of the half-width held at full opacity before the fade begins. */
export const FEATHER_START = 0.78;

/** Exponent of the distance metric: 2 is a circle, large values a square. */
const EDGE_ROUNDNESS = 4;

/**
 * Alpha multiplier at a point in the field, where `u` and `v` run 0 to 1
 * across its width and height. 1 keeps the overlay's own opacity, 0 is clear.
 */
export function featherAlpha(u: number, v: number): number {
  const x = Math.abs(u * 2 - 1);
  const y = Math.abs(v * 2 - 1);
  const distance = (x ** EDGE_ROUNDNESS + y ** EDGE_ROUNDNESS) ** (1 / EDGE_ROUNDNESS);
  return 1 - smoothstep(FEATHER_START, 1, distance);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
