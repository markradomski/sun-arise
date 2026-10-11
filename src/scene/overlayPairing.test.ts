import { describe, expect, it } from "vitest";
import { instantMatchesField } from "./overlayPairing";

/**
 * The overlay reverted because a NOW result computed over one grid was drawn
 * over a different, newer grid: correct for a frame, then the previous shadow
 * pattern stretched across the new area. These model that sequence rather than
 * the geometry, which was never at fault.
 */

const fieldA = { signature: "sigA", pointCount: 961 };
const fieldB = { signature: "sigB", pointCount: 2635 };

const instantFor = (field: { signature: string; pointCount: number }) => ({
  forSignature: field.signature,
  pointCount: field.pointCount,
});

describe("instantMatchesField", () => {
  it("accepts a result computed over the field being drawn", () => {
    expect(instantMatchesField(instantFor(fieldA), fieldA)).toBe(true);
  });

  it("rejects a result from an older field", () => {
    // The exact failure: field moved on to B, NOW still describes A.
    expect(instantMatchesField(instantFor(fieldA), fieldB)).toBe(false);
  });

  it("rejects a result from a newer field", () => {
    expect(instantMatchesField(instantFor(fieldB), fieldA)).toBe(false);
  });

  it("rejects a sample count that does not fill the grid", () => {
    // Same inputs, different grid size: drawing this would index past the end
    // of the values and paint the remainder from nothing.
    expect(
      instantMatchesField(
        { forSignature: "sigA", pointCount: 961 },
        { signature: "sigA", pointCount: 2635 },
      ),
    ).toBe(false);
  });

  it("rejects when either side is missing", () => {
    expect(instantMatchesField(null, fieldA)).toBe(false);
    expect(instantMatchesField(undefined, fieldA)).toBe(false);
    expect(instantMatchesField(instantFor(fieldA), null)).toBe(false);
    expect(instantMatchesField(null, null)).toBe(false);
  });

  it("holds when an old request completes after a new one", () => {
    // Houses move: the field becomes B. A slow NOW computation for A lands
    // afterwards and must not be drawn.
    let displayed = fieldA;
    const lateFromA = instantFor(fieldA);
    displayed = fieldB;
    expect(instantMatchesField(lateFromA, displayed)).toBe(false);

    // Only once NOW catches up does the pair become drawable.
    expect(instantMatchesField(instantFor(fieldB), displayed)).toBe(true);
  });

  it("stays correct through a burst of moves", () => {
    // Five rapid moves produce five fields; every stale result is refused and
    // only the last pairing is drawable.
    const fields = [1, 2, 3, 4, 5].map((n) => ({
      signature: `sig${n}`,
      pointCount: 900 + n * 100,
    }));
    const current = fields[fields.length - 1];

    for (const earlier of fields.slice(0, -1)) {
      expect(instantMatchesField(instantFor(earlier), current)).toBe(false);
    }
    expect(instantMatchesField(instantFor(current), current)).toBe(true);
  });

  it("treats adding and removing a house as a different field", () => {
    const twoHouses = { signature: "h1|h2", pointCount: 2635 };
    const oneHouse = { signature: "h1", pointCount: 961 };
    expect(instantMatchesField(instantFor(twoHouses), oneHouse)).toBe(false);
    expect(instantMatchesField(instantFor(oneHouse), twoHouses)).toBe(false);
  });

  it("refuses a result whose field changed only in geometry, not in size", () => {
    // A house rotating can leave the grid the same size while changing every
    // value in it, so the signature has to carry the decision, not the count.
    const before = { signature: "heading-0", pointCount: 961 };
    const after = { signature: "heading-90", pointCount: 961 };
    expect(instantMatchesField(instantFor(before), after)).toBe(false);
  });
});
