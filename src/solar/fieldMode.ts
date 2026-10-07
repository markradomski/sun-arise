/**
 * What the sunlight overlay represents.
 *
 * `NOW` is direct sun at the instant on the clock; `WHOLE_DAY` is accumulated
 * hours of direct sun over the civil day. The two answer different questions
 * and carry different scales, so they never share a legend or a ramp.
 *
 * This is separate from whether the overlay is visible.
 */
export type FieldMode = "NOW" | "WHOLE_DAY";

export const FIELD_MODES: FieldMode[] = ["NOW", "WHOLE_DAY"];

export const FIELD_MODE_LABELS: Record<FieldMode, string> = {
  NOW: "Now",
  WHOLE_DAY: "Whole day",
};
