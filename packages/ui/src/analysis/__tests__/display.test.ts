import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_PAINT_STRENGTH,
  ownershipToPaintMap,
} from "../coords";
import {
  buildBoardOverlays,
  buildPvPreview,
  candidateBoardVisitThreshold,
  candidateVisibleOnBoard,
  colorToSign,
} from "../display";
import {
  createInitialAnalysisState,
  type AnalysisState,
  type CandidateSnapshot,
} from "../types";

function stateWithCandidates(
  candidates: CandidateSnapshot[],
  toPlay: "B" | "W" = "B",
  ownership?: number[],
): AnalysisState {
  const state = createInitialAnalysisState();
  state.status = "completed";
  state.size = 9;
  state.plies[0] = {
    ply: 0,
    toPlay,
    rootPartial: false,
    complete: true,
    phase: "deep",
    candidates,
    groups: [],
    ledger: null,
    comparison: null,
    sacrifices: null,
    commentary: null,
    root: {
      visits: 200,
      winrate: 0.55,
      scoreLead: 1.2,
      ownership:
        ownership ??
        Array.from({ length: 81 }, (_, i) =>
          i === 0 ? 0.9 : i === 1 ? -0.7 : 0,
        ),
    },
  };
  return state;
}

describe("buildPvPreview", () => {
  it("places numbered alternating-color stones starting from the candidate", () => {
    const { ghostStoneMap, markerMap } = buildPvPreview(
      ["C7", "D7", "E7"],
      9,
      1,
    );
    // C7 → [2,2], D7 → [3,2], E7 → [4,2]
    expect(ghostStoneMap[2]![2]).toEqual({ sign: 1, faint: false });
    expect(markerMap[2]![2]?.label).toBe("1");
    expect(ghostStoneMap[2]![3]).toEqual({ sign: -1, faint: false });
    expect(markerMap[2]![3]?.label).toBe("2");
    expect(ghostStoneMap[2]![4]).toEqual({ sign: 1, faint: false });
    expect(markerMap[2]![4]?.label).toBe("3");
  });

  it("starts with white when to-play is W", () => {
    const { ghostStoneMap } = buildPvPreview(["C7", "D7"], 9, -1);
    expect(ghostStoneMap[2]![2]?.sign).toBe(-1);
    expect(ghostStoneMap[2]![3]?.sign).toBe(1);
  });

  it("skips pass for placement but advances color", () => {
    const { ghostStoneMap, markerMap } = buildPvPreview(
      ["C7", "pass", "D7"],
      9,
      1,
    );
    expect(markerMap[2]![2]?.label).toBe("1");
    // B on C7 → White passes (no stone) → D7 is Black again.
    expect(ghostStoneMap[2]![3]?.sign).toBe(1);
    expect(markerMap[2]![3]?.label).toBe("2");
  });
});

describe("colorToSign", () => {
  it("maps B/W tokens", () => {
    expect(colorToSign("B")).toBe(1);
    expect(colorToSign("W")).toBe(-1);
    expect(colorToSign(undefined)).toBe(1);
  });
});

describe("buildBoardOverlays", () => {
  const candidates: CandidateSnapshot[] = [
    {
      move: "C7",
      order: 0,
      visits: 120,
      winrate: 0.58,
      pv: ["C7", "D6", "E5"],
    },
    {
      move: "D4",
      order: 1,
      visits: 40,
      winrate: 0.44,
      pv: ["D4", "C5"],
    },
  ];

  it("shows candidate ghosts with no PV arrows by default", () => {
    const overlays = buildBoardOverlays(
      stateWithCandidates(candidates),
      0,
      { size: 9 },
    );
    expect(overlays.lines).toEqual([]);
    expect(overlays.ghostStoneMap[2]![2]?.type).toBe("good");
    expect(overlays.markerMap[2]![2]?.label).toContain("%");
    // Fractional ownership paint (not binary ±1), medium strength.
    expect(overlays.paintMap[0]![0]).toBeGreaterThan(0.4);
    expect(overlays.paintMap[0]![0]).toBeLessThanOrEqual(OWNERSHIP_PAINT_STRENGTH);
    expect(overlays.paintMap[0]![1]).toBeLessThan(-0.4);
    expect(Math.abs(overlays.paintMap[0]![1]!)).toBeLessThanOrEqual(
      OWNERSHIP_PAINT_STRENGTH,
    );
  });

  it("replaces candidates with numbered PV preview when hovering", () => {
    const overlays = buildBoardOverlays(
      stateWithCandidates(candidates, "B"),
      0,
      { size: 9, previewCandidate: 0 },
    );
    expect(overlays.lines).toEqual([]);
    // PV stones have no candidate type — plain B/W ghosts.
    expect(overlays.ghostStoneMap[2]![2]?.type).toBeUndefined();
    expect(overlays.ghostStoneMap[2]![2]?.sign).toBe(1);
    expect(overlays.markerMap[2]![2]?.label).toBe("1");
    // D6 = [3,3]
    expect(overlays.markerMap[3]![3]?.label).toBe("2");
    expect(overlays.ghostStoneMap[3]![3]?.sign).toBe(-1);
    // Candidate D4 ghost should be gone (replaced by PV overlay).
    expect(overlays.ghostStoneMap[5]![3]).toBeNull();
  });

  it("falls back to the candidate move when PV is empty", () => {
    const overlays = buildBoardOverlays(
      stateWithCandidates([{ move: "C7", order: 0, visits: 10, winrate: 0.5 }]),
      0,
      { size: 9, previewCandidate: 0 },
    );
    expect(overlays.markerMap[2]![2]?.label).toBe("1");
  });

  it("hides low-visit candidates from board ghosts/labels (Sabaki-like)", () => {
    expect(candidateBoardVisitThreshold(500)).toBe(10); // max(3, 2% of 500)
    expect(candidateBoardVisitThreshold(100)).toBe(3); // floor
    expect(
      candidateVisibleOnBoard({ move: "C7", order: 0, visits: 2 }, 500),
    ).toBe(false);

    const overlays = buildBoardOverlays(
      stateWithCandidates([
        { move: "C7", order: 0, visits: 120, winrate: 0.58 },
        { move: "D4", order: 1, visits: 2, winrate: 0.4 }, // below 2% of 200
      ]),
      0,
      { size: 9 },
    );
    // Top candidate still labeled.
    expect(overlays.ghostStoneMap[2]![2]?.type).toBe("good");
    expect(overlays.markerMap[2]![2]?.label).toContain("%");
    // Low-visit D4 = [5,3] must not get a board ghost/label.
    expect(overlays.ghostStoneMap[5]![3]).toBeNull();
    expect(overlays.markerMap[5]![3]).toBeNull();
  });
});

describe("ownershipToPaintMap fractional strength", () => {
  it("scales opacity by |ownership| at medium strength", () => {
    const own = Array.from({ length: 9 }, (_, i) =>
      i === 0 ? 1 : i === 1 ? -0.5 : 0.02,
    );
    const paint = ownershipToPaintMap(own, 3);
    expect(paint[0]![0]).toBeCloseTo(OWNERSHIP_PAINT_STRENGTH, 5);
    expect(paint[0]![1]).toBeLessThan(0);
    expect(Math.abs(paint[0]![1]!)).toBeGreaterThan(0.3);
    expect(Math.abs(paint[0]![1]!)).toBeLessThan(OWNERSHIP_PAINT_STRENGTH);
    expect(paint[0]![2]).toBe(0);
  });
});
