import type { BoxOccluder } from "../solar/exposure";
import type { SceneObject } from "./types";

export interface FieldInputs {
  houses: SceneObject[];
  baseline: BoxOccluder[] | null;
  /** Timezone and civil day the field is evaluated over. */
  civilDay: string;
  utcOffsetHours: number;
}

/**
 * Identity of the exposure field: every input that changes the numbers, and
 * nothing else.
 *
 * Whether the heatmap is currently shown is deliberately not part of this.
 * Hiding the overlay must not invalidate a computed field, or each toggle
 * would resample terrain, rebuild the field and tear the panel down with it.
 */
export function fieldSignature(inputs: FieldInputs): string {
  // Sorted, because occlusion is the union of the houses: the same scene in a
  // different order is the same analysis, and must not look like a change.
  const houses = inputs.houses
    .map(
      (house) =>
        `${house.id}:${place(house.position.latitude)},${place(house.position.longitude)},${house.position.height.toFixed(2)},${house.rotation.heading.toFixed(2)},${house.scale}`,
    )
    .sort()
    .join("|");

  const baseline =
    inputs.baseline
      ?.map(
        (occluder) =>
          `${place(occluder.position.latitude)},${place(occluder.position.longitude)},${occluder.position.height.toFixed(2)},${occluder.headingDeg.toFixed(2)},${occluder.widthMeters},${occluder.depthMeters},${occluder.heightMeters}`,
      )
      .join("|") ?? "none";

  return [houses, baseline, inputs.civilDay, inputs.utcOffsetHours].join("//");
}

/** Seven decimal places is roughly a centimetre, well below analytical resolution. */
function place(degrees: number): string {
  return degrees.toFixed(7);
}
