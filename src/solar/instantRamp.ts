/**
 * Colour ramp for the instantaneous sunlight map.
 *
 * Separate from the hours ramp on purpose: that one encodes an absolute
 * quantity with a fixed 0-14 h scale, this one encodes a relative strength
 * with no units. Sharing a ramp would invite reading one as the other.
 *
 * Shade is a deep cool tone rather than transparency, so blocked ground reads
 * as shadow rather than as missing data.
 */

const SHADE: [number, number, number] = [28, 36, 74];
const LOW: [number, number, number] = [120, 96, 150];
const HIGH: [number, number, number] = [255, 232, 150];

/** Below this the sun is so low that the lit colour stays near the bottom. */
const STRENGTH_FLOOR = 0.08;

export function instantColour(strength: number): [number, number, number] {
  if (strength <= 0) return SHADE;
  const t = Math.min(1, Math.max(0, (strength - STRENGTH_FLOOR) / (1 - STRENGTH_FLOOR)));
  return mix(LOW, HIGH, t);
}

export const INSTANT_GRADIENT_CSS = `linear-gradient(to right, ${rgbCss(
  instantColour(0.0001),
)}, ${rgbCss(instantColour(0.5))}, ${rgbCss(instantColour(1))})`;

export const SHADE_CSS = rgbCss(SHADE);

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * How solid the overlay should be at a given instantaneous strength.
 *
 * Same reasoning as the hours ramp: shadow is the answer the user is looking
 * for and stays solid, while broad sunlit ground is drawn lightly so the
 * satellite image still reads through it.
 */
export function instantOpacity(strength: number): number {
  const t = Math.min(1, Math.max(0, strength));
  return SHADE_OPACITY + (SUN_OPACITY - SHADE_OPACITY) * t;
}

const SHADE_OPACITY = 1;
const SUN_OPACITY = 0.4;
