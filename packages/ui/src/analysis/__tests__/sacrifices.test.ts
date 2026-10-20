import { describe, expect, it } from "vitest";
import recorded from "../__fixtures__/comparison-positions.json";
import { alignedSacrificeAssessment, sacrificesFromComparison } from "../sacrifices";
import { reducePipelineEvent } from "../reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../types";
import { constructedSacrifice } from "./constructedSacrifice";

const snapshots = recorded as PositionSnapshot[];
describe("root-aligned sacrifice evidence", () => {
  it("distinguishes recorded assessed negatives, low-visit unassessed and absent evidence", () => {
    for (const snapshot of snapshots) {
      const assessment = alignedSacrificeAssessment(snapshot.comparison, snapshot.ply, 19);
      expect(assessment).not.toBeNull();
      expect(assessment!.annotations).toEqual([]);
      const sacrifices = sacrificesFromComparison(snapshot.comparison, snapshot.ply, 19);
      expect(sacrifices).toEqual(snapshot.ply === 50 ? null : []);
    }
    expect(sacrificesFromComparison(null, 44, 19)).toBeNull();
  });

  it("rejects wrong roots, invented groups, invalid exchanges and mismatched provenance", () => {
    expect(sacrificesFromComparison(constructedSacrifice(), 1, 5)).toHaveLength(1);
    for (const mutate of [
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.rootPly = 1; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.annotations[0]!.mover = "W"; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.annotations[0]!.groupId = "invented"; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.annotations[0]!.compensationBook = NaN; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.annotations[0]!.exchanges[0]!.intersections = ["Z99"]; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.annotations[0]!.evidence.rootHash = "different-root"; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.annotations[0]!.evidence.preferredVisits = 1; },
      (c: ReturnType<typeof constructedSacrifice>) => { c.sacrificeAssessment!.status = "unassessed"; },
    ]) {
      const comparison = constructedSacrifice();
      mutate(comparison);
      expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
    }
  });

  it("clears the derived slot when restarting or replacing a snapshot with absent evidence", () => {
    const snapshot = structuredClone(snapshots.find((item) => item.ply === 44)!);
    let state = reducePipelineEvent(createInitialAnalysisState(), { v: 1, type: "positionCompleted", phase: "deep", snapshot });
    expect(state.plies[44]!.sacrifices).toEqual([]);
    state = reducePipelineEvent(state, { v: 1, type: "positionStarted", ply: 44, phase: "deep", toPlay: "B" });
    expect(state.plies[44]!.sacrifices).toBeNull();
    delete snapshot.comparison;
    state = reducePipelineEvent(state, { v: 1, type: "positionCompleted", phase: "deep", snapshot });
    expect(state.plies[44]!.sacrifices).toBeNull();
  });
});
