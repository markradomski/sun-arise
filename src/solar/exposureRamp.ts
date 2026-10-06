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
 * lightness.
 *
 * Stops are absolute hours, never a per-field min/max normalisation, so the
 * same exposure reads as the same colour between recalculations, sites and
 * seasons. The scale runs to 14 h so a midsummer day still has headroom above
 * a winter one instead of both saturating at the top.
 */
const STOPS: RampStop[] = [
  { hours: 0, rgb: [46, 38, 22] },
  { hours: 2, rgb: [77, 61, 29] },
  { hours: 4, rgb: [110, 86, 36] },
  { hours: 6, rgb: [145, 113, 43] },
  { hours: 8, rgb: [182, 141, 51] },
  { hours: 10, rgb: [217, 169, 61] },
  { hours: 12, rgb: [242, 198, 84] },
  { hours: 14, rgb: [255, 221, 140] },
];

export const LEGEND_BANDS: LegendBand[] = [
  { label: "2", css: rgbCss(colourForHours(1)) },
  { label: "4", css: rgbCss(colourForHours(3)) },
  { label: "6", css: rgbCss(colourForHours(5)) },
  { label: "8", css: rgbCss(colourForHours(7)) },
  { label: "10", css: rgbCss(colourForHours(9)) },
  { label: "12", css: rgbCss(colourForHours(11)) },
  { label: "14+", css: rgbCss(colourForHours(13)) },
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
