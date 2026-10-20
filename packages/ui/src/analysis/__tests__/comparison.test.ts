import { describe, expect, it } from "vitest";
import recorded from "../__fixtures__/comparison-positions.json";
import { isAlignedComparison } from "../comparison";
import { reducePipelineEvent } from "../reduce";
import { createInitialAnalysisState, type PipelineEvent, type PositionSnapshot } from "../types";
import { useAnalysisStream } from "../useAnalysisStream";
import type { AnalysisEventSource, AnalysisSourceHandlers } from "../sources/types";

const snapshot = (recorded as PositionSnapshot[]).find((item) => item.ply === 60)!;
const event: PipelineEvent = { type: "positionCompleted", v: 1, phase: "deep", snapshot };

describe("recorded move comparison reduction", () => {
  it("attaches mover evidence to p while preserving p's next-mover root", () => {
    const state = reducePipelineEvent(createInitialAnalysisState(), event);
    expect(state.plies[60]!.toPlay).toBe("B");
    expect(state.plies[60]!.comparison!.mover).toBe("W");
    expect(state.plies[60]!.comparison!.rootPly).toBe(59);
    expect(state.plies[60]!.comparison!.scoreLoss).toBeCloseTo(6.681626325);
    expect(state.plies[60]!.comparison!.evidence.actualSource).toBe("forced");
    expect(state.plies[59]).toBeUndefined();
  });

  it("rejects malformed/wrong-board evidence and clears authoritative absence", () => {
    const comparison = snapshot.comparison!;
    const state = reducePipelineEvent(createInitialAnalysisState(), event);
    for (const invalid of [
      null, undefined, { ...comparison, rootPly: 60 },
      { ...comparison, ownershipDelta: [0] },
      { ...comparison, scoreLoss: Number.NaN },
      { ...comparison, ledgerDiff: { ...comparison.ledgerDiff!, rootPly: 60 } },
      { ...comparison, evidence: { ...comparison.evidence, actualRootHash: "wrong-root" } },
    ]) {
      expect(isAlignedComparison(invalid, 60, 19)).toBe(false);
      expect(reducePipelineEvent(state, {
        ...event, snapshot: { ...snapshot, comparison: invalid },
      }).plies[60]!.comparison).toBeNull();
    }
    expect(reducePipelineEvent(state, {
      type: "positionStarted", v: 1, ply: 60, toPlay: "B", phase: "deep",
    }).plies[60]!.comparison).toBeNull();
  });

  it("ignores late callbacks after stop, replacement and reset", () => {
    const handlers: AnalysisSourceHandlers[] = [];
    const source: AnalysisEventSource = {
      id: "recorded-comparison-test", label: "Recorded comparison",
      start(next) { handlers.push(next); return { stop() {} }; },
    };
    const stream = useAnalysisStream();
    stream.attachSource(source);
    handlers[0]!.onEvent(event);
    expect(stream.state.value.plies[60]!.comparison).not.toBeNull();
    stream.attachSource(source);
    expect(stream.state.value.plies[60]).toBeUndefined();
    handlers[0]!.onEvent(event);
    handlers[0]!.onError?.(new Error("stale"));
    handlers[0]!.onDone?.();
    expect(stream.state.value.plies[60]).toBeUndefined();
    expect(stream.state.value.status).toBe("streaming");
    stream.stop();
    handlers[1]!.onEvent(event);
    expect(stream.state.value.plies[60]).toBeUndefined();
    stream.reset();
    handlers[1]!.onError?.(new Error("late after reset"));
    expect(stream.state.value.status).toBe("idle");
    expect(stream.state.value.lastError).toBeNull();
  });
});
