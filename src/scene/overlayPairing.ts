/**
 * Whether an instantaneous field may be drawn over a given ground field.
 *
 * WHOLE DAY colours live inside the field object itself, so they cannot
 * disagree with its grid. NOW is computed separately and arrives later, which
 * means the two can come from different generations: a field recomputed for
 * moved houses carries a new grid and a new rectangle, while the NOW values
 * still describe the old one. Painting that pair stretches the previous
 * shadow pattern across the new area — the overlay appears correct for a frame
 * and then reverts.
 *
 * The rule is deliberately strict and cheap: a NOW result may only be drawn
 * over the exact field it was computed from.
 */

export interface FieldIdentity {
  /** Identity of the inputs the field was computed from. */
  signature: string;
  /** Number of ground samples in the field's grid. */
  pointCount: number;
}

export interface InstantIdentity {
  /** Signature of the field this instantaneous result was computed over. */
  forSignature: string;
  pointCount: number;
}

export function instantMatchesField(
  instant: InstantIdentity | null | undefined,
  field: FieldIdentity | null | undefined,
): boolean {
  if (!instant || !field) return false;
  return (
    instant.forSignature === field.signature &&
    instant.pointCount === field.pointCount
  );
}
