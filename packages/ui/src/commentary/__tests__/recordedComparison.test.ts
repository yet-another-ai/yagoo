import { describe, expect, it } from "vitest";
import recorded from "../../analysis/__fixtures__/comparison-positions.json";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import { useAnalysisStream } from "../../analysis/useAnalysisStream";
import { buildCommentaryFacts, renderCommentary, resolveCommentary } from "../facts";
import { CommentarySession } from "../session";

// Genuine engine derivatives from #24's recorded 19x19 corpus, not model mocks.
const snapshots = recorded as PositionSnapshot[];
const state = snapshots.reduce((previous, snapshot) => reducePipelineEvent(previous, {
  type: "positionCompleted", v: 1, phase: "deep", snapshot,
}), createInitialAnalysisState());

function pointer(root: unknown, path: string): unknown {
  return path.split("/").slice(1).reduce((value, key) =>
    (value as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}

describe("commentary aligned with recorded historical comparisons", () => {
  it("traces every comparison clause to exact recorded source paths", () => {
    for (const snapshot of snapshots) {
      const facts = buildCommentaryFacts(state.plies[snapshot.ply]!);
      const comparisonFacts = facts.filter((fact) => fact.id.includes("/comparison-"));
      expect(comparisonFacts.length).toBeGreaterThan(3);
      for (const fact of comparisonFacts) {
        for (const source of fact.evidence) {
          expect(pointer(state, source.path), `${fact.id}: ${source.path}`).toEqual(source.value);
          expect(source.path === `/plies/${snapshot.ply}/ply` ||
            source.path.startsWith(`/plies/${snapshot.ply}/comparison/`)).toBe(true);
        }
      }
      const notes = renderCommentary(comparisonFacts);
      expect(resolveCommentary(comparisonFacts, notes)).toEqual(notes);
      expect(notes.text).not.toMatch(/\b(?:severe mistake|sente|gote)\b/);
    }
  });

  it("attributes White's S3 versus H3 loss to root 59, not Black's next-move ledger", () => {
    const position = state.plies[60]!;
    expect(position.toPlay).toBe("B");
    expect(position.ledger!.rootPly).toBe(60);
    expect(position.ledger!.value).toBeCloseTo(15.98294179);
    const facts = buildCommentaryFacts(position);
    const loss = facts.find((fact) => fact.id.endsWith("/comparison-score-loss"))!;
    expect(loss.variants[0]).toBe(
      "For move 60, the score difference (preferred H3 minus played S3) is +6.7 points from White's perspective at root ply 59.",
    );
    expect(loss.evidence).toContainEqual({
      path: "/plies/60/comparison/scoreLoss", value: 6.681626325,
    });
    expect(loss.evidence.some((source) => source.path.includes("/ledger/"))).toBe(false);
    const actualLedger = facts.find((fact) => fact.id.endsWith("/comparison-ledger-search"))!;
    expect(actualLedger.variants[0]).toContain("S3 has a search score difference of -6.7 points versus H3, from White's perspective");
    expect(actualLedger.evidence).toContainEqual({
      path: "/plies/60/comparison/ledgerDiff/value", value: -6.681626325,
    });
    expect(facts.find((fact) => fact.id.endsWith("/ledger-search"))?.variants[0])
      .toContain("At root ply 60");
    expect(buildCommentaryFacts({ ...position, comparison: null })
      .some((fact) => fact.id.includes("/comparison-"))).toBe(false);
  });

  it("keeps the equal R2 move at ply 43 at zero despite a nonzero next-mover ledger", () => {
    const position = state.plies[43]!;
    expect(position.ledger!.value).toBeCloseTo(19.89093441);
    expect(position.comparison!.actualMove).toBe("R2");
    expect(position.comparison!.aiMove).toBe("R2");
    const comparisonFacts = buildCommentaryFacts(position).filter((fact) => fact.id.includes("/comparison-"));
    expect(comparisonFacts.find((fact) => fact.id.endsWith("/comparison-score-loss"))?.variants[0])
      .toContain("(preferred R2 minus played R2) is 0.0 points from Black's perspective at root ply 42");
    expect(comparisonFacts.find((fact) => fact.id.endsWith("/comparison-winrate-loss"))?.variants[0])
      .toContain("0.0 percentage points at root ply 42");
    expect(comparisonFacts.find((fact) => fact.id.endsWith("/comparison-ledger-search"))?.variants[0])
      .toContain("0.0 points versus R2");
    expect(JSON.stringify(comparisonFacts)).not.toMatch(/19\.9 points|19\.89093441/);
    const notes = renderCommentary(comparisonFacts);
    const changed = buildCommentaryFacts({
      ...position,
      comparison: { ...position.comparison!, scoreLoss: 1 },
    }).filter((fact) => fact.id.includes("/comparison-"));
    expect(resolveCommentary(changed, notes).fallbackReason).toBeTruthy();
  });

  it("turns consent off when a replacement source emits snapshots without gameStarted", () => {
    const stream = useAnalysisStream();
    const snapshot = snapshots.find((item) => item.ply === 60)!;
    const source = {
      id: "recorded-comparison-source", label: "Recorded comparison source",
      start(handlers: { onEvent: (event: Parameters<typeof reducePipelineEvent>[1]) => void }) {
        handlers.onEvent({ type: "positionCompleted", v: 1, phase: "deep", snapshot });
        return { stop() {} };
      },
    };
    let enabled = false;
    const session = new CommentarySession((next) => { enabled = next.enabled; });
    stream.attachSource(source);
    const first = stream.gameGeneration.value;
    session.setContext(buildCommentaryFacts(stream.state.value.plies[60]!), first);
    session.setEnabled(true);
    expect(enabled).toBe(true);
    stream.attachSource(source);
    expect(stream.gameGeneration.value).toBeGreaterThan(first);
    session.setContext(buildCommentaryFacts(stream.state.value.plies[60]!), stream.gameGeneration.value);
    expect(enabled).toBe(false);
    stream.stop();
  });
});
