import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useVariationAnalysis } from "../useVariationAnalysis";
import type { AnalysisSourceHandlers, PositionSourceFactory } from "../sources/types";
import type { PipelineEvent } from "../types";

const completed = (ply: number, move: string): PipelineEvent => ({
  type: "positionCompleted", v: 1, phase: "deep",
  snapshot: {
    schemaVersion: 1, ply, toPlay: "W", board: { size: 9, black: ["A9"], white: [] },
    ownershipConvention: "black_positive", chains: [],
    root: { visits: 200, ownership: Array(81).fill(0.4) },
    candidates: [{ move, visits: 150, pv: [move, "pass", "B8"] }],
  },
});

describe("variation analysis with a controlled event source (no model)", () => {
  function fixture() {
    const runs: Array<{ handlers: AnalysisSourceHandlers; stop: ReturnType<typeof vi.fn> }> = [];
    const source: PositionSourceFactory = () => ({
      id: "controlled", label: "Controlled source",
      start(handlers) {
        const stop = vi.fn();
        runs.push({ handlers, stop });
        return { stop };
      },
    });
    return { runs, source };
  }

  it("ignores late events/errors/completion after rapid navigation and cancellation", () => {
    const { runs, source } = fixture();
    const flow = useVariationAnalysis();
    const request = { sgf: "(;SZ[9])", ply: 0, moves: ["A9"] };
    flow.select("a", request, source);
    flow.select("b", request, source);
    expect(runs[0]!.stop).toHaveBeenCalledOnce();
    runs[0]!.handlers.onEvent(completed(1, "C3"));
    runs[0]!.handlers.onError?.(new Error("late"));
    runs[0]!.handlers.onDone?.();
    expect(flow.state.value.status).toBe("streaming");
    expect(flow.state.value.plies[1]).toBeUndefined();
    runs[1]!.handlers.onEvent(completed(1, "D4"));
    runs[1]!.handlers.onDone?.();
    expect(flow.state.value.plies[1]!.candidates[0]!.move).toBe("D4");
    flow.select("a", request, source);
    flow.stop();
    runs[2]!.handlers.onEvent(completed(1, "E5"));
    expect(flow.state.value.plies[1]).toBeUndefined();
  });

  it("caches only completed nodes and clears all nodes on a new game", () => {
    const { runs, source } = fixture();
    const flow = useVariationAnalysis();
    const request = { sgf: "(;SZ[9])", ply: 0, moves: ["pass"] };
    flow.select("a", request, source);
    runs[0]!.handlers.onEvent(completed(1, "D4"));
    runs[0]!.handlers.onDone?.();
    flow.select("a", request, source);
    expect(runs).toHaveLength(1);
    flow.clear();
    runs[0]!.handlers.onEvent(completed(1, "C3"));
    expect(flow.state.value.plies).toEqual({});
    flow.select("a", request, source);
    expect(runs).toHaveLength(2);
    runs[1]!.handlers.onDone?.();
    expect(flow.state.value.lastError).toMatch(/before completing/);
  });

  it("aborts on scope disposal and rejects a mismatched result ply", () => {
    const { runs, source } = fixture();
    const scope = effectScope();
    const flow = scope.run(useVariationAnalysis)!;
    flow.select("a", { sgf: "(;SZ[9])", ply: 0 }, source);
    runs[0]!.handlers.onEvent(completed(4, "D4"));
    expect(flow.state.value.lastError).toMatch(/different variation/);
    scope.stop();
    expect(runs[0]!.stop).toHaveBeenCalledOnce();
  });
});
