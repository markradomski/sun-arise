/**
 * Positional alpha mask for the exposure overlay.
 *
 * The overlay is a rectangular raster, and its edge against the satellite
 * imagery reads as a tile boundary rather than as analysis. This fades the
 * outer band away, with corners rounded so no straight edge survives.
 *
 * The fade is a **fixed distance in metres**, not a fraction of the field.
 * When it was proportional, an adaptive field covering houses a few hundred
 * metres apart faded over tens of metres on its long side while a 60 m field
 * faded over six, so the same analysis looked different at different zooms and
 * a house near the edge could dissolve entirely.
 *
 * It is a function of position only. Two cells the same distance from the
 * boundary get the same alpha whatever their exposure, so the mask can never
 * be mistaken for, or interfere with, the hours the ramp encodes.
 */

/**
 * Width of the fade, in metres.
 *
 * Eight matches what the old proportional feather produced on the original
 * 60 m field, which is the appearance this is calibrated against.
 */
export const DEFAULT_FEATHER_METERS = 8;

/**
 * Alpha multiplier at a point, measured in metres east and north of the
 * field's centre. 1 keeps the overlay's own opacity, 0 is clear.
 *
 * The field is treated as a rectangle inset by the feather distance: inside
 * that inner rectangle the overlay is solid, and beyond it the alpha falls to
 * zero over `featherMeters`. Distance to the inner rectangle is measured
 * radially at the corners, which is what rounds them.
 */
export function featherAlpha(
  eastMeters: number,
  northMeters: number,
  halfEastMeters: number,
  halfNorthMeters: number,
  featherMeters: number = DEFAULT_FEATHER_METERS,
): number {
  // A field narrower than two feathers has no solid core to protect, so the
  // fade shrinks to fit rather than inverting the rectangle.
  const feather = Math.max(
    0,
    Math.min(featherMeters, halfEastMeters, halfNorthMeters),
  );

  const innerEast = halfEastMeters - feather;
  const innerNorth = halfNorthMeters - feather;

  const overEast = Math.abs(eastMeters) - innerEast;
  const overNorth = Math.abs(northMeters) - innerNorth;

  if (feather <= 0) {
    return overEast <= 0 && overNorth <= 0 ? 1 : 0;
  }

  // Signed distance from the inner rectangle: negative inside, positive out.
  const outside = Math.hypot(Math.max(overEast, 0), Math.max(overNorth, 0));
  const inside = Math.min(Math.max(overEast, overNorth), 0);
  const distance = outside + inside;

  return 1 - smoothstep(0, feather, distance);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge1 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
