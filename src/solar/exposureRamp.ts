export interface RampStop {
  hours: number;
  rgb: [number, number, number];
}

export interface LegendBand {
  label: string;
  /** Representative colour for the band, as a CSS value. */
  css: string;
}

/**
 * Sequential ramp for hours of direct sun: one hue, monotonically increasing
 * lightness, anchored on the interface's sun gold at the top.
 *
 * Stops are absolute hours, never a per-field min/max normalisation, so the
 * same exposure reads as the same colour between recalculations and between
 * sites.
 */
const STOPS: RampStop[] = [
  { hours: 0, rgb: [58, 47, 28] },
  { hours: 2, rgb: [107, 84, 36] },
  { hours: 4, rgb: [163, 125, 43] },
  { hours: 6, rgb: [217, 168, 60] },
  { hours: 8, rgb: [255, 211, 106] },
];

export const LEGEND_BANDS: LegendBand[] = [
  { label: "<2 h", css: rgbCss(colourForHours(1)) },
  { label: "2–4", css: rgbCss(colourForHours(3)) },
  { label: "4–6", css: rgbCss(colourForHours(5)) },
  { label: "6–8", css: rgbCss(colourForHours(7)) },
  { label: "8+", css: rgbCss(colourForHours(9)) },
];

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
