import { describe, expect, it } from "vitest";
import snapshotsJson from "../../analysis/__fixtures__/comparison-positions.json";
import { constructedSacrifice } from "../../analysis/__tests__/constructedSacrifice";
import type { MoveComparison } from "../../analysis/modules";
import { reducePipelineEvents } from "../../analysis/reduce";
import type { AnalysisState, PipelineEvent, PositionSnapshot } from "../../analysis/types";
import { buildReviewReport } from "../build";
import type { ReviewReportMove } from "../types";

const snapshots = snapshotsJson as unknown as PositionSnapshot[];
const start: Extract<PipelineEvent, { type: "gameStarted" }> = {
  type: "gameStarted", v: 1, size: 19, komi: 0.5, rules: "chinese",
  moveCount: 100, positionCount: 101, strategy: "scan_then_deep",
};

function recordedState(): AnalysisState {
  return reducePipelineEvents([start, ...snapshots.map((snapshot): PipelineEvent => ({
    type: "positionCompleted", v: 1, phase: "deep", snapshot: structuredClone(snapshot),
  })), { type: "gameCompleted", v: 1 }]);
}

function section(row: ReviewReportMove, id: "group_tradeoffs" | "tempo_changes" | "sacrifices") {
  const result = row.evidenceSections.find((entry) => entry.id === id);
  expect(result).toBeDefined();
  return result!;
}

function pointer(root: unknown, path: string): unknown {
  return path.split("/").slice(1).reduce((value, key) =>
    (value as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}

/** Synthetic legal 5x5 rendering contract; never genuine engine/calibration evidence. */
function constructedState(mutate?: (comparison: MoveComparison) => void): AnalysisState {
  const comparison = constructedSacrifice();
  comparison.sacrificeAssessment!.annotations[0]!.evidence.referenceSource = "root_candidate";
  comparison.sacrificeAssessment!.annotations[0]!.evidence.referenceRootHash = "constructed";
  mutate?.(comparison);
  const snapshot: PositionSnapshot = {
    schemaVersion: 1, ply: 1, toPlay: "W", lastMove: "B3", ownershipConvention: "black_positive",
    board: { size: 5, black: ["B2", "C2", "B3"], white: ["A2", "B1", "C1", "C3", "D2"] },
    chains: [], root: { visits: 64, winrate: 0.5, scoreLead: 0 }, comparison,
  };
  return reducePipelineEvents([
    { ...start, size: 5, moveCount: 1, positionCount: 2 },
    { type: "positionCompleted", v: 1, phase: "deep", snapshot },
    { type: "gameCompleted", v: 1 },
  ]);
}

describe("report evidence sections from genuine full-history recordings", () => {
  it("retains root-ply tradeoff and tempo facts independently of the three summary sentences", () => {
    const state = recordedState();
    const report = buildReviewReport(state);
    const row = report.moves.find((move) => move.ply === 60)!;
    expect(row).toMatchObject({ rootPly: 59, mover: "W", actualMove: "S3", aiMove: "H3" });
    expect(row.explanation.sentences).toHaveLength(3);
    expect(row.explanation.citedFactIds).toContain("ply-60/comparison-score-loss");
    expect(row.explanation.citedFactIds).toContain("ply-60/comparison-winrate-loss");

    const tradeoffs = section(row, "group_tradeoffs");
    const tempos = section(row, "tempo_changes");
    expect(tradeoffs.facts).toHaveLength(3);
    expect(tempos.facts).toHaveLength(2);
    expect(tradeoffs.facts.every((fact) => !row.explanation.citedFactIds.includes(fact.id))).toBe(true);
    expect(tempos.facts.every((fact) => !row.explanation.citedFactIds.includes(fact.id))).toBe(true);
    expect(tradeoffs.facts.flatMap((fact) => fact.evidence)
      .filter((entry) => entry.path.endsWith("/kind")).map((entry) => entry.value).sort())
      .toEqual(["group", "own_territory", "reduce_opponent"]);

    for (const move of report.moves) {
      expect(move.evidenceSections.map((entry) => entry.id)).toEqual([
        "group_tradeoffs", "tempo_changes", "sacrifices",
      ]);
      for (const evidenceSection of move.evidenceSections) {
        for (const fact of evidenceSection.facts) {
          expect(move.facts).toContainEqual(fact);
          for (const entry of fact.evidence) {
            expect(pointer(state, entry.path)).toEqual(entry.value);
            expect(entry.path === `/plies/${move.ply}/ply`
              || entry.path.startsWith(`/plies/${move.ply}/comparison/`)).toBe(true);
          }
        }
      }
    }
    // Snapshot p60's next-mover ledger is not a reason for the move at root59.
    expect(row.facts.flatMap((fact) => fact.evidence).some((entry) =>
      entry.path.startsWith("/plies/60/ledger/"))).toBe(false);
  });

  it("caps each category and reports omitted genuine tempo facts without truncating source facts", () => {
    const report = buildReviewReport(recordedState());
    const row44 = report.moves.find((move) => move.ply === 44)!;
    expect(section(row44, "group_tradeoffs")).toMatchObject({ omittedFacts: 0 });
    expect(section(row44, "group_tradeoffs").facts).toHaveLength(4);
    expect(section(row44, "tempo_changes").facts).toHaveLength(4);

    const row50 = report.moves.find((move) => move.ply === 50)!;
    const allTempoFacts = row50.facts.filter((fact) => fact.id.includes("/comparison-tempo-"));
    const tempos = section(row50, "tempo_changes");
    expect(allTempoFacts).toHaveLength(7);
    expect(tempos.facts).toEqual(allTempoFacts.slice(0, 4));
    expect(tempos.omittedFacts).toBe(3);
    expect(tempos.emptyMessage).toBeUndefined();
    expect(row50.facts).toContainEqual(allTempoFacts[6]);
  });

  it("distinguishes assessed zero candidates from absent and explicitly unassessed evidence", () => {
    const state = recordedState();
    const report = buildReviewReport(state);
    expect(section(report.moves.find((move) => move.ply === 44)!, "sacrifices")).toMatchObject({
      facts: [], omittedFacts: 0,
      emptyMessage: "No supported sacrifice candidate was reported for the assessed groups.",
    });
    expect(section(report.moves.find((move) => move.ply === 50)!, "sacrifices")).toMatchObject({
      facts: [], emptyMessage: "Sacrifice assessment is unassessed.",
    });

    delete state.plies[44]!.comparison!.sacrificeAssessment;
    const missing = buildReviewReport(state).moves.find((move) => move.ply === 44)!;
    expect(section(missing, "sacrifices")).toMatchObject({
      facts: [], emptyMessage: "Sacrifice assessment is unassessed.",
    });
    expect(missing.missingEvidence).toContain("Sacrifice assessment is unassessed.");
    expect(missing.categories).not.toContain("sacrifice_evidence");
  });
});

describe("synthetic positive sacrifice report contract, not engine calibration", () => {
  it("states capture, saving branch and uncalibrated compensation with exact assessment pointers", () => {
    const state = constructedState();
    const row = buildReviewReport(state).moves[0]!;
    const sacrifices = section(row, "sacrifices");
    expect(sacrifices.facts).toHaveLength(1);
    expect(sacrifices.omittedFacts).toBe(0);
    expect(sacrifices.emptyMessage).toBeUndefined();
    expect(row.categories).toContain("sacrifice_evidence");
    const fact = sacrifices.facts[0]!;
    expect(row.facts.filter((entry) => entry.id === fact.id)).toHaveLength(1);
    expect(fact.variants).toHaveLength(1);
    expect(fact.variants[0]).toContain("At root ply 0");
    expect(fact.variants[0]).toContain("Black group B2");
    expect(fact.variants[0]).toContain("preferred E5 line captures 2 original stones by PV move 2");
    expect(fact.variants[0]).toContain("saving alternative B3 retains them through that horizon");
    expect(fact.variants[0]).toContain("ownership flip is 1.80");
    expect(fact.variants[0]).toContain("group cost 3.60 and net compensation elsewhere 5.00 ownership-book units");
    expect(fact.variants[0]).toContain("uncalibrated");
    expect(fact.variants[0]).toContain("do not establish intention or point value");
    expect(fact.target).toEqual({ groupId: "B2", intersections: ["B2", "C2"] });
    // Complete PVs are inspectable evidence, rather than appended prose.
    expect(fact.variants[0]).not.toContain("E5 B3");
    expect(fact.variants[0]).not.toContain("B3 E1");
    const base = "/plies/1/comparison/sacrificeAssessment/annotations/0";
    expect(fact.evidence).toEqual(expect.arrayContaining([
      { path: `${base}/rootPly`, value: 0 },
      { path: `${base}/mover`, value: "B" },
      { path: `${base}/groupId`, value: "B2" },
      { path: `${base}/preferredMove`, value: "E5" },
      { path: `${base}/referenceMove`, value: "B3" },
      { path: `${base}/capturedStones`, value: ["B2", "C2"] },
      { path: `${base}/ownershipFlip`, value: 1.8 },
      { path: `${base}/costBook`, value: 3.6 },
      { path: `${base}/compensationBook`, value: 5 },
      { path: `${base}/pv`, value: ["E5", "B3"] },
      { path: `${base}/evidence/referencePv`, value: ["B3", "E1"] },
      { path: `${base}/evidence/preferredCapturePlyOffset`, value: 2 },
      { path: `${base}/evidence/rootQueryId`, value: "constructed-root" },
      { path: `${base}/evidence/referenceQueryId`, value: "constructed-root" },
      { path: `${base}/evidence/referenceSource`, value: "root_candidate" },
      { path: `${base}/evidence/referenceRootHash`, value: "constructed" },
      { path: `${base}/evidence/preferredPvQueryId`, value: "constructed-pv" },
      { path: "/plies/1/comparison/context/pvLineages/0/captures", value: [
        { color: "B", stone: "B2", plyOffset: 2 }, { color: "B", stone: "C2", plyOffset: 2 },
      ] },
      { path: "/plies/1/comparison/context/pvLineages/1/captures", value: [] },
      { path: "/plies/1/comparison/context/pvLineages/1/board", value:
        state.plies[1]!.comparison!.context.pvLineages![1]!.board },
    ]));
    for (const entry of fact.evidence) {
      expect(entry.path.startsWith("/plies/1/comparison/sacrificeAssessment/")
        || entry.path.startsWith("/plies/1/comparison/context/pvLineages/")).toBe(true);
      expect(pointer(state, entry.path)).toEqual(entry.value);
    }
    expect(row.explanation.citedFactIds).not.toContain(fact.id);
  });

  it("cites the validated lineage records when unrelated imported records are malformed", () => {
    const state = constructedState((comparison) => {
      (comparison.context.pvLineages as unknown[]).unshift(null);
    });
    const fact = section(buildReviewReport(state).moves[0]!, "sacrifices").facts[0]!;
    expect(fact).toBeDefined();
    expect(fact.evidence.some((entry) => entry.path === "/plies/1/comparison/context/pvLineages/1/captures")).toBe(true);
    expect(fact.evidence.some((entry) => entry.path === "/plies/1/comparison/context/pvLineages/2/board")).toBe(true);
    for (const entry of fact.evidence) expect(pointer(state, entry.path)).toEqual(entry.value);
  });

  it.each<[string, (comparison: MoveComparison) => void]>([
    ["missing original captured stone", (comparison) => {
      comparison.sacrificeAssessment!.annotations[0]!.capturedStones.pop();
    }],
    ["capture lineage mismatch", (comparison) => {
      comparison.context.pvLineages![0]!.captures.pop();
    }],
    ["capture horizon beyond the preferred PV", (comparison) => {
      comparison.sacrificeAssessment!.annotations[0]!.evidence.preferredCapturePlyOffset = 99;
    }],
    ["saving reference hash mismatch", (comparison) => {
      comparison.sacrificeAssessment!.annotations[0]!.evidence.referenceRootHash = "another-root";
    }],
    ["compensation below the lost group cost", (comparison) => {
      comparison.sacrificeAssessment!.annotations[0]!.compensationBook = 3;
    }],
    ["compensation contradicting exchange rows", (comparison) => {
      comparison.sacrificeAssessment!.annotations[0]!.compensationBook = 6;
    }],
    ["nonfinite compensation", (comparison) => {
      comparison.sacrificeAssessment!.annotations[0]!.compensationBook = Number.NaN;
    }],
  ])("rejects %s before enriching the report", (_label, mutate) => {
    const row = buildReviewReport(constructedState(mutate)).moves[0]!;
    expect(row).toBeDefined();
    expect(section(row, "sacrifices")).toMatchObject({
      facts: [], omittedFacts: 0, emptyMessage: "Sacrifice assessment is unassessed.",
    });
    expect(row.facts.some((fact) => fact.id.includes("/sacrifice-"))).toBe(false);
    expect(row.categories).not.toContain("sacrifice_evidence");
    expect(row.missingEvidence).toContain("Sacrifice assessment is unassessed.");
  });
});
