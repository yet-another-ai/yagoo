import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../AnalysisReviewer.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";
import ReviewerLayout from "../ReviewerLayout.vue";

function position(visits: number, candidate: string): PipelineEvent {
  return {
    type: "positionCompleted", v: 1, phase: "deep",
    snapshot: {
      schemaVersion: 1, ply: 0, toPlay: "B", ownershipConvention: "black_positive",
      board: { size: 9, black: [], white: [] }, chains: [],
      root: { visits, winrate: 0.6 }, candidates: [{ move: candidate, visits }],
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("connecting an engine for variations", () => {
  it.each([
    ["native", "recorded"], ["browser", "recorded"],
    ["native", "live"], ["browser", "live"],
  ] as const)("preserves %s mainline results from %s analysis", async (engine, mainline) => {
    const recorded = position(65, "D4");
    const variation = position(200, "C3");
    const mainCancel = vi.fn();
    const analyzeSgf = vi.fn(() => new ReadableStream<string>({
      start(controller) { controller.enqueue(JSON.stringify(recorded)); },
      cancel: mainCancel,
    }));
    const analyzePosition = vi.fn(async function* () { yield JSON.stringify(variation); });
    const fetch = vi.fn(async (url: string) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify(url.endsWith("/analyze-position") ? variation : recorded)}\n\n`,
        ));
      },
      cancel: url.endsWith("/analyze-position") ? undefined : mainCancel,
    }), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);

    // Drain the bundled recording without relying on animation timing.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: "(;SZ[9];B[dd])", vertexSize: 16,
        initialNdjson: mainline === "recorded"
          ? [recorded, { type: "gameCompleted", v: 1 }].map(event => JSON.stringify(event)).join("\n")
          : undefined,
        browserEngine: engine === "browser" ? { analyzeSgf, analyzePosition } : undefined,
      },
    });
    try {
      frames.splice(0).forEach(callback => callback(0));
      await flushPromises();
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const panel = wrapper.getComponent(EngineSourcePanel);
      function connect() {
        if (engine === "native") panel.vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
        else panel.vm.$emit("connect-browser");
      }
      if (mainline === "live") {
        connect();
        await flushPromises();
      }
      const layout = wrapper.getComponent(ReviewerLayout);
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("D4");

      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      await flushPromises();
      connect();
      await flushPromises();
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("C3");
      if (mainline === "live") expect(mainCancel).toHaveBeenCalledOnce();
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      expect(layout.props("winrateData")).toHaveLength(1);
      if (mainline === "recorded") expect(wrapper.text()).toContain("bundled sample analysis");

      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("D4");
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("C3");
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      expect(analyzeSgf).toHaveBeenCalledTimes(engine === "browser" && mainline === "live" ? 1 : 0);
      expect(fetch.mock.calls.filter(([url]) => url.endsWith("/analyze")))
        .toHaveLength(engine === "native" && mainline === "live" ? 1 : 0);
    } finally {
      wrapper.unmount();
    }
  });
});
