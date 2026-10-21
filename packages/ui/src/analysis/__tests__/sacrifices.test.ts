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

  it.each<[string, (comparison: ReturnType<typeof constructedSacrifice>) => void]>([
    ["a saving move absent from the analyzed candidates", (c) => {
      const item = c.sacrificeAssessment!.annotations[0]!;
      item.referenceMove = "A1";
      item.evidence.referencePv = ["A1", "E1"];
      c.sacrificeAssessment!.checks[0]!.referenceMove = "A1";
    }],
    ["a different preferred PV under the same query ID", (c) => {
      c.sacrificeAssessment!.annotations[0]!.pv = ["E5", "A1"];
    }],
    ["a different saving PV under the same query ID", (c) => {
      c.sacrificeAssessment!.annotations[0]!.evidence.referencePv = ["B3", "A1"];
    }],
    ["an endpoint belonging to another PV", (c) => {
      c.context.preferredPvEnd!.pv = ["E5", "A1"];
    }],
    ["missing legal replay evidence", (c) => { delete c.context.pvLineages; }],
    ["an original stone absent from the capture record", (c) => {
      c.context.pvLineages![0]!.captures.pop();
    }],
    ["a duplicated capture masquerading as two original stones", (c) => {
      c.context.pvLineages![0]!.captures[1] = { ...c.context.pvLineages![0]!.captures[0]! };
    }],
    ["a saving line that also loses an original stone", (c) => {
      c.context.pvLineages![1]!.captures = [{ color: "B", stone: "B2", plyOffset: 2 }];
    }],
    ["a capture horizon inconsistent with the replay", (c) => {
      c.sacrificeAssessment!.annotations[0]!.evidence.preferredCapturePlyOffset = 1;
    }],
    ["a claimed visit count different from the analysis", (c) => {
      c.sacrificeAssessment!.annotations[0]!.evidence.preferredVisits = 128;
    }],
    ["an ownership mean different from the source map", (c) => {
      c.sacrificeAssessment!.annotations[0]!.referenceOwnership = .7;
    }],
    ["a source saving branch below the published ownership threshold", (c) => {
      for (const index of [16, 17]) c.context.actual.ownership![index] = .2;
      const item = c.sacrificeAssessment!.annotations[0]!;
      item.referenceOwnership = .2;
      item.ownershipFlip = 1.1;
    }],
    ["a source score decline beyond the published tolerance", (c) => {
      c.context.preferred.scoreLead = -2;
      c.context.preferredPvEnd!.analysis.scoreLead = -2;
      c.sacrificeAssessment!.annotations[0]!.evidence.scoreAdvantage = -2;
    }],
    ["a non-finite configurable threshold", (c) => {
      c.sacrificeAssessment!.parameters.maximumScoreDecline = Infinity;
    }],
    ["a malformed per-group check", (c) => {
      (c.sacrificeAssessment as unknown as { checks: unknown[] }).checks = [null];
    }],
    ["an unknown per-group reason", (c) => {
      (c.sacrificeAssessment!.checks[0] as unknown as { reason: string }).reason = "invented";
    }],
  ])("rejects %s without rendering a supported claim", (_name, mutate) => {
    const comparison = constructedSacrifice();
    mutate(comparison);
    expect(() => alignedSacrificeAssessment(comparison, 1, 5)).not.toThrow();
    expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
  });

  it("uses original-stone capture identity even when the endpoint has a same-color replacement", () => {
    const comparison = constructedSacrifice();
    const pv = ["E5", "B3", "B2", "E1"];
    comparison.context.preferred.pv = [...pv];
    comparison.context.preferredPvEnd!.pv = [...pv];
    comparison.context.pvLineages![0]!.pv = [...pv];
    comparison.sacrificeAssessment!.annotations[0]!.pv = [...pv];
    comparison.context.pvLineages![0]!.board.black.push("B2");
    comparison.context.pvLineages![0]!.board.white.push("E1");
    expect(sacrificesFromComparison(comparison, 1, 5)).toHaveLength(1);
  });

  it("links forced actual references to the actual query instead of the unrestricted root query", () => {
    const comparison = constructedSacrifice();
    comparison.evidence.actualSource = "forced";
    comparison.evidence.actualQueryId = "constructed-actual-forced";
    const evidence = comparison.sacrificeAssessment!.annotations[0]!.evidence;
    evidence.referenceSource = "actual_forced";
    evidence.referenceQueryId = comparison.evidence.actualQueryId;
    expect(sacrificesFromComparison(comparison, 1, 5)).toHaveLength(1);
    evidence.referenceSource = "root_candidate";
    evidence.referenceQueryId = comparison.evidence.rootQueryId;
    expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
  });

  it("accepts a forced saving probe only with matching source, root hash and query provenance", () => {
    const comparison = constructedSacrifice();
    comparison.context.savingProbes = [{ queryId: "constructed-saving-forced", rootHash: "constructed",
      candidate: structuredClone(comparison.context.actual) }];
    const evidence = comparison.sacrificeAssessment!.annotations[0]!.evidence;
    evidence.referenceSource = "saving_forced";
    evidence.referenceQueryId = "constructed-saving-forced";
    evidence.referenceRootHash = "constructed";
    expect(sacrificesFromComparison(comparison, 1, 5)).toHaveLength(1);
    delete evidence.referenceRootHash;
    expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
    evidence.referenceRootHash = "constructed";
    comparison.context.savingProbes[0]!.rootHash = "another-root";
    expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
    comparison.context.savingProbes[0]!.rootHash = "constructed";
    evidence.referenceQueryId = comparison.evidence.rootQueryId;
    expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
    evidence.referenceQueryId = "constructed-saving-forced";
    evidence.referenceSource = "root_candidate";
    expect(sacrificesFromComparison(comparison, 1, 5)).toBeNull();
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
