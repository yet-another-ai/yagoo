import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import snapshotsJson from "../../analysis/__fixtures__/comparison-positions.json";
import oldSample from "../../analysis/__fixtures__/sample-scan-deep.ndjson?raw";
import { parseNdjson, reducePipelineEvent, reducePipelineEvents } from "../../analysis/reduce";
import { createInitialAnalysisState, type PipelineEvent, type PositionSnapshot } from "../../analysis/types";
import { useAnalysisStream } from "../../analysis/useAnalysisStream";
import type { AnalysisSourceHandlers } from "../../analysis/sources/types";
import { buildCommentaryFacts, renderCommentary } from "../../commentary";
import { buildReviewReport, reviewPipelineEvents } from "../build";
import { exportReviewHtml, exportReviewMarkdown, ReviewExportSession, type ReviewExportFile } from "../export";
import { compareReportMoves, isReportComparison } from "../summary";

const snapshots = snapshotsJson as unknown as PositionSnapshot[];
const start: PipelineEvent = {
  type: "gameStarted", v: 1, size: 19, komi: 0.5, rules: "chinese",
  moveCount: 100, positionCount: 101, strategy: "scan_then_deep",
};
function evidenceEvents(): PipelineEvent[] {
  return [start, ...snapshots.map((snapshot): PipelineEvent => ({
    type: "positionCompleted", v: 1, phase: "deep", snapshot,
  })), { type: "gameCompleted", v: 1 }];
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("deterministic review from genuine full-history fixtures", () => {
  it("ranks actual p60 at root59 and retains equality p43 without using old ko-invalid swings", () => {
    const report = reviewPipelineEvents(evidenceEvents());
    expect(report.moves.map((m) => m.ply)).toEqual([60, 44, 43, 50, 96]);
    expect(report.moves[0]).toMatchObject({
      rootPly: 59, actualMove: "S3", aiMove: "H3", mover: "W",
      scoreLoss: 6.681626325,
    });
    expect(report.moves.find((m) => m.ply === 43)).toMatchObject({
      rootPly: 42, actualMove: "R2", aiMove: "R2", scoreLoss: 0,
      categories: expect.arrayContaining(["matches_preferred"]),
    });
    expect(report.status).toBe("partial");
    expect(report.coverage.comparedMovePlies).toEqual([43, 44, 50, 60, 96]);
    expect(report.coverage.missingComparisonPlies).toHaveLength(95);
    expect(report.overview.matchesPreferred).toBe(3);
    expect(report.moves[0]!.facts.some((f) => f.id === "ply-60/comparison-score-loss")).toBe(true);
    for (const row of report.moves) {
      const ids = new Set(row.facts.map((f) => f.id));
      for (const recommendation of row.recommendations) {
        expect(recommendation.factIds.length).toBeGreaterThan(0);
        expect(recommendation.factIds.every((id) => ids.has(id))).toBe(true);
      }
    }
    const old = reviewPipelineEvents(parseNdjson(oldSample), { source: "bundled sample analysis" });
    expect(old.moves).toEqual([]);
    expect(old.warnings.join(" ")).toMatch(/ko-illegal/);
    expect(old.unassessedPlies.length).toBeGreaterThan(0);
  });

  it("rejects p-position context, conflicting histories, malformed loss and partial replacements", () => {
    const comparison = structuredClone(snapshots.find((s) => s.ply === 60)!.comparison!);
    expect(isReportComparison(comparison, 60)).toBe(true);
    expect(isReportComparison({ ...comparison, rootPly: 60 }, 60)).toBe(false);
    expect(isReportComparison({ ...comparison, scoreLoss: 99 }, 60)).toBe(false);
    expect(isReportComparison({
      ...comparison, evidence: { ...comparison.evidence, actualRootHash: "different" },
    }, 60)).toBe(false);
    let state = reducePipelineEvents(evidenceEvents());
    state = reducePipelineEvent(state, {
      type: "stagePartial", v: 1, phase: "deep", stage: "root", ply: 60,
      root: { scoreLead: 100, winrate: 1 },
    });
    expect(buildReviewReport(state).moves.some((m) => m.ply === 60)).toBe(false);
  });

  it("keeps deterministic output and exact evidence when optional notes are forged or stale", () => {
    const state = reducePipelineEvents(evidenceEvents());
    const row = state.plies[60]!;
    const facts = buildCommentaryFacts({ ply: 60, comparison: row.comparison, sacrifices: row.sacrifices })
      .filter((f) => f.id.includes("/comparison-") || f.id.includes("/sacrifice-"));
    row.commentary = renderCommentary(facts);
    const report = buildReviewReport(state);
    expect(buildReviewReport(state)).toEqual(report);
    row.commentary = { text: "A giant dragon dies! <script>alert(1)</script>", citedFactIds: [], verified: true, provider: "forged" };
    const safe = buildReviewReport(state);
    expect(safe.moves[0]!.explanation.text).not.toMatch(/dragon|script/);
    expect(safe.moves[0]!.explanation.verified).toBe(false);
    expect(safe.moves[0]!.explanation.text).toBe(report.moves[0]!.explanation.text);
  });

  it("a new game clears prior comparison and report metadata even without a wrapper reset", () => {
    const state = reducePipelineEvents(evidenceEvents());
    state.reportSummary = buildReviewReport(state).coverage;
    const next = reducePipelineEvent(state, { ...start, moveCount: 2, positionCount: 3 });
    expect(next.plies).toEqual({});
    expect(next.reportSummary).toBeNull();
    expect(buildReviewReport(next).status).toBe("in_progress");
    expect(buildReviewReport(next).moves).toEqual([]);
  });

  it("does not import unanchored sacrifice claims and distinguishes transport EOF from pipeline completion", () => {
    const state = reducePipelineEvents(evidenceEvents());
    state.plies[60]!.sacrifices = [{
      groupId: "S3", ownershipFlip: 1, compensationPoints: 8, exchangedWith: ["H3"], pv: ["H3"],
    }];
    const row = buildReviewReport(state).moves[0]!;
    expect(row.categories).not.toContain("sacrifice_evidence");
    expect(row.missingEvidence).toContain("Sacrifice assessment is unassessed.");
    const emptyGame = reducePipelineEvents([
      { ...start, moveCount: 0, positionCount: 1 },
      { type: "positionCompleted", v: 1, phase: "scan",
        snapshot: { ...snapshots[0]!, ply: 0, comparison: null } },
    ]);
    emptyGame.status = "completed"; // Transport EOF without the pipeline terminal event.
    expect(buildReviewReport(emptyGame).status).toBe("partial");
    expect(buildReviewReport(reducePipelineEvent(emptyGame, { type: "gameCompleted", v: 1 })).status).toBe("complete");
    const reference = buildReviewReport(state).coverage.rankedMoves[0]!;
    // Explicit synthetic ranking values; no new engine outcome is claimed.
    const values = [
      { ...reference, ply: 3, scoreLoss: -2, winrateLoss: -0.1 },
      { ...reference, ply: 2, scoreLoss: 0, winrateLoss: 0 },
      { ...reference, ply: 1, scoreLoss: 2, winrateLoss: 0.1 },
    ].sort(compareReportMoves);
    expect(values.map((r) => r.scoreLoss)).toEqual([2, 0, -2]);
  });
});

describe("local review exports", () => {
  it("renders metadata, source links, facts and free text as inert text in both formats", () => {
    const attack = '<img src=x onerror="alert(1)"> [click](javascript:alert(1)) https://evil.test <script>alert(1)</script>';
    const report = reviewPipelineEvents(evidenceEvents(), {
      source: attack, provenance: [attack],
      sgf: `(;SZ[19]PB[${attack.replaceAll("]", "\\]")}]PW[White])`,
    });
    report.moves[0]!.explanation.text = attack; // Export boundary also escapes free text.
    const html = exportReviewHtml(report);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelectorAll("script,img,iframe,link,object")).toHaveLength(0);
    expect([...document.querySelectorAll("a")].every((a) => /^#move-\d+$/.test(a.getAttribute("href")!))).toBe(true);
    expect(document.body.textContent).toContain(attack);
    expect(document.querySelector("meta[http-equiv='Content-Security-Policy']")).not.toBeNull();
    const markdown = exportReviewMarkdown(report);
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("[click](javascript:");
    expect(markdown).toContain("6.68 points");
    expect(exportReviewMarkdown(report)).toBe(markdown);
  });

  it("latest export wins; cancellation and source changes invalidate pending output", async () => {
    const first = deferred<ReviewExportFile>();
    const second = deferred<ReviewExportFile>();
    const deliver = vi.fn();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const session = new ReviewExportSession(deliver, render);
    const report = reviewPipelineEvents(evidenceEvents());
    const a = session.export(report, "markdown");
    const b = session.export(report, "html");
    expect(render.mock.calls[0]![2].aborted).toBe(true);
    first.resolve({ filename: "old.md", mimeType: "text/plain", contents: "old" });
    expect(await a).toBe(false);
    second.resolve({ filename: "new.html", mimeType: "text/html", contents: "new" });
    expect(await b).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
    const pending = deferred<ReviewExportFile>();
    const cancelled = new ReviewExportSession(deliver, () => pending.promise);
    const run = cancelled.export(report, "markdown");
    cancelled.cancel(); // Same invalidation used by report/source watcher and unmount.
    pending.resolve({ filename: "stale.md", mimeType: "text/plain", contents: "stale" });
    expect(await run).toBe(false);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

describe("review cancellation and stale transport results", () => {
  it("ignores old-source callbacks after stop, replacement, and unmount", () => {
    const scope = effectScope();
    const stream = scope.run(() => useAnalysisStream())!;
    let first!: AnalysisSourceHandlers;
    let second!: AnalysisSourceHandlers;
    stream.attachSource({ id: "first", label: "first", start: (handlers) => {
      first = handlers; return { stop: vi.fn() };
    } });
    first.onEvent(start);
    first.onEvent(evidenceEvents()[1]!);
    stream.stop();
    first.onEvent(evidenceEvents()[4]!);
    expect(Object.keys(stream.state.value.plies)).toEqual(["43"]);
    expect(buildReviewReport(stream.state.value).status).toBe("partial");
    stream.reset();
    stream.attachSource({ id: "second", label: "second", start: (handlers) => {
      second = handlers; return { stop: vi.fn() };
    } });
    first.onEvent(evidenceEvents()[4]!);
    first.onError?.(new Error("late"));
    first.onDone?.();
    expect(stream.state.value.lastError).toBeNull();
    expect(stream.state.value.plies).toEqual({});
    scope.stop();
    second.onEvent(start);
    expect(stream.state.value.moveCount).toBeNull();
  });
});
