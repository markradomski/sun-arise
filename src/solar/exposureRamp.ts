export interface RampStop {
  hours: number;
  rgb: [number, number, number];
}

export interface LegendTick {
  label: string;
  /** Position along the ramp, 0 at no sun and 1 at the top of the scale. */
  position: number;
}

/**
 * Sequential ramp for hours of direct sun: cool and dark in deep shade,
 * warming through violet to sunlit yellow. Luminance rises monotonically, so
 * the ramp still reads in order without relying on hue perception.
 *
 * Stops are absolute hours, never a per-field min/max normalisation, so the
 * same exposure reads as the same colour between recalculations, sites and
 * seasons. The scale runs to 14 h so a midsummer day still has headroom above
 * a winter one instead of both saturating at the top.
 *
 * The warm end stops at yellow rather than continuing into red: this measures
 * hours of sunlight, and a red top would read as heat.
 */
const STOPS: RampStop[] = [
  { hours: 0, rgb: [24, 33, 71] },
  { hours: 2, rgb: [38, 62, 124] },
  { hours: 4, rgb: [72, 82, 158] },
  { hours: 6, rgb: [116, 94, 165] },
  { hours: 8, rgb: [159, 110, 148] },
  { hours: 10, rgb: [194, 142, 96] },
  { hours: 12, rgb: [226, 180, 88] },
  { hours: 14, rgb: [252, 226, 138] },
];

const TOP_HOURS = STOPS[STOPS.length - 1].hours;

export const LEGEND_TICKS: LegendTick[] = [
  { label: "2", position: 2 / TOP_HOURS },
  { label: "4", position: 4 / TOP_HOURS },
  { label: "6", position: 6 / TOP_HOURS },
  { label: "8", position: 8 / TOP_HOURS },
  { label: "10", position: 10 / TOP_HOURS },
  { label: "12", position: 12 / TOP_HOURS },
  { label: "14+", position: 1 },
];

/** The ramp itself as a CSS gradient, so the legend cannot drift from the map. */
export const LEGEND_GRADIENT_CSS = `linear-gradient(to right, ${STOPS.map(
  (stop) => `${rgbCss(stop.rgb)} ${((stop.hours / TOP_HOURS) * 100).toFixed(1)}%`,
).join(", ")})`;

export function colourForHours(hours: number): [number, number, number] {
  if (hours <= STOPS[0].hours) return STOPS[0].rgb;

  const last = STOPS[STOPS.length - 1];
  if (hours >= last.hours) return last.rgb;

  for (let i = 1; i < STOPS.length; i += 1) {
    const upper = STOPS[i];
    if (hours > upper.hours) continue;

    const lower = STOPS[i - 1];
    const t = (hours - lower.hours) / (upper.hours - lower.hours);
    return [
      Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * t),
      Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * t),
      Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * t),
    ];
  }

  return last.rgb;
}

export function colourForMinutes(minutes: number): [number, number, number] {
  return colourForHours(minutes / 60);
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
