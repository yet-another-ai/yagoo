import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../AnalysisReviewer.vue";
import ReviewerLayout from "../ReviewerLayout.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";

const sgf = "(;SZ[9];B[dd];W[ff])";
function recording(visits: number, candidate: string): PipelineEvent[] {
  return [
    { type: "gameStarted", v: 1, size: 9, komi: 7.5, moveCount: 2, positionCount: 3, strategy: "deep_only" },
    ...[0, 1, 2].map((ply): PipelineEvent => ({
      type: "positionCompleted", v: 1, phase: "deep", snapshot: {
        schemaVersion: 1, ply, toPlay: ply % 2 ? "W" : "B",
        ownershipConvention: "black_positive", board: { size: 9, black: [], white: [] },
        chains: [], root: { visits }, candidates: [{ move: candidate, visits }],
      },
    })),
    { type: "gameCompleted", v: 1 },
  ];
}
const file = (name: string, visits: number, candidate: string) => ({
  name, text: async () => recording(visits, candidate).map((event) => JSON.stringify(event)).join("\n"),
}) as File;

afterEach(() => vi.unstubAllGlobals());

describe("switching from live variations to recorded analysis", () => {
  it("finishes recordings without restarting browser Try and ignores canceled sources", async () => {
    let resolveNative!: (response: Response) => void;
    const pendingNative = new Promise<Response>((resolve) => { resolveNative = resolve; });
    let nativeSignal!: AbortSignal;
    const fetch = vi.fn((_url: string, options: RequestInit) => {
      nativeSignal = options.signal as AbortSignal;
      return pendingNative;
    });
    vi.stubGlobal("fetch", fetch);
    const analyzePosition = vi.fn(async function* () {});
    const analyzeSgf = vi.fn(async function* () {});
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: sgf, vertexSize: 16 } });
    await flushPromises();
    const layout = wrapper.getComponent(ReviewerLayout);
    layout.vm.goToPly(1);
    await flushPromises();
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
    const panel = wrapper.getComponent(EngineSourcePanel);
    panel.vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
    await flushPromises();
    await wrapper.setProps({ browserEngine: { analyzeSgf, analyzePosition } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toContain("/analyze-position");
    expect(nativeSignal.aborted).toBe(false);

    // Drive progressive file batches explicitly; no wall-clock timing assumptions.
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    async function frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
      await flushPromises();
    }
    panel.vm.$emit("ndjson-file", file("first.ndjson", 120, "D4"));
    await flushPromises();
    expect(layout.vm.tryMode).toBe(false);
    expect(layout.vm.view).toBe("board");
    expect(nativeSignal.aborted).toBe(true);
    expect(analyzePosition).not.toHaveBeenCalled();
    await frame();
    await frame();
    expect(layout.props("rootAnalysis")?.visits).toBe(120);
    expect(wrapper.text()).toContain("Loaded first.ndjson");

    // Replacing a still-pending recording invalidates even an already queued callback.
    panel.vm.$emit("ndjson-file", file("superseded.ndjson", 220, "E4"));
    await flushPromises();
    const staleCallbacks = [...frames.values()];
    panel.vm.$emit("ndjson-file", file("latest.ndjson", 330, "F4"));
    await flushPromises();
    staleCallbacks.forEach((callback) => callback(0));
    resolveNative(new Response(`data: ${JSON.stringify(recording(999, "C3")[2])}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    }));
    await frame();
    await frame();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(analyzePosition).not.toHaveBeenCalled();
    expect(analyzeSgf).not.toHaveBeenCalled();
    expect(layout.vm.moveNumber).toBe(1);
    expect(layout.props("rootAnalysis")?.visits).toBe(330);
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("F4");
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("C3");
    expect(wrapper.text()).toContain("Loaded latest.ndjson");
    expect(wrapper.find('[data-testid="try-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
