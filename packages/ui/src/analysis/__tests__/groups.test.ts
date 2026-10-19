import { describe, expect, it } from "vitest";
import {
  buildGroupOutlines,
  buildGroupVertexIndex,
  dimVerticesOutsideGroup,
  groupOutlineColor,
  groupPrimaryColor,
  groupStoneCount,
} from "../groups";
import type { GroupSnapshot } from "../types";

const sample: GroupSnapshot[] = [
  {
    groupId: "C1",
    members: {
      blackStones: ["C7", "D7"],
      whiteStones: [],
      empty: ["C8"],
    },
    kind: "simple",
    status: "weak",
    strength: { black: 0.4 },
    source: "fixture_proposal",
  },
  {
    groupId: "C2",
    members: {
      blackStones: ["A9"],
      whiteStones: ["B9"],
      empty: [],
    },
    kind: "contested",
    status: "dead",
    source: "fixture_proposal",
  },
];

describe("group helpers", () => {
  it("distinguishes primary color and stone count", () => {
    expect(groupPrimaryColor(sample[0]!)).toBe("B");
    expect(groupPrimaryColor(sample[1]!)).toBe("mixed");
    expect(groupStoneCount(sample[0]!)).toBe(2);
  });

  it("colors dead groups distinctly from weak", () => {
    expect(groupOutlineColor(sample[1]!)).toBe("#F02311");
    expect(groupOutlineColor(sample[0]!)).toBe("#E67E22");
  });

  it("builds outlines and vertex index without inventing chains-as-groups", () => {
    const outlines = buildGroupOutlines(sample, 9);
    expect(outlines).toHaveLength(2);
    expect(outlines[0]!.groupId).toBe("C1");
    // C7=[2,2], D7=[3,2] on 9×9
    expect(outlines[0]!.vertices).toEqual(
      expect.arrayContaining([
        [2, 2],
        [3, 2],
      ]),
    );
    const idx = buildGroupVertexIndex(sample, 9);
    expect(idx.get("2,2")).toBe("C1");
    expect(idx.get("0,0")).toBe("C2"); // A9
  });

  it("dims vertices outside the focused group", () => {
    const dimmed = dimVerticesOutsideGroup(sample[0], 9);
    expect(dimmed.length).toBe(9 * 9 - 3); // 2 stones + 1 empty kept
    expect(dimmed.some(([x, y]) => x === 2 && y === 2)).toBe(false);
  });
});
