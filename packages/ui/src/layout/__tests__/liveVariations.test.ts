import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PositionAnalysisRequest } from "../../analysis";
import type { PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../AnalysisReviewer.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";
import ReviewerLayout from "../ReviewerLayout.vue";

const sgf = "(;SZ[9];B[dd];W[ff])";
function result(request: PositionAnalysisRequest): PipelineEvent {
  const ply = request.ply + (request.moves?.length ?? 0);
  return {
    type: "positionCompleted", v: 1, phase: "deep",
    snapshot: {
      schemaVersion: 1, ply, toPlay: ply % 2 ? "W" : "B",
      ownershipConvention: "black_positive", board: { size: 9, black: [], white: [] },
      chains: [], root: { visits: 200, ownership: Array(81).fill(0.5) },
      candidates: [{ move: "C3", order: 0, visits: 150, winrate: 0.6, pv: ["C3", "B8"] }],
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("live variation wiring with controlled adapters (no models)", () => {
  it("uses the browser single-position API while keeping the main review separate", async () => {
    const analyzeSgf = vi.fn(async function* () {});
    const analyzePosition = vi.fn(async function* (request: PositionAnalysisRequest) {
      yield JSON.stringify(result(request));
    });
    const stop = vi.fn();
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sgf, vertexSize: 16, browserEngine: { analyzeSgf, analyzePosition, stop } },
    });
    await flushPromises();
    wrapper.getComponent(ReviewerLayout).vm.goToPly(1);
    await flushPromises();
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await flushPromises();
    await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
    await flushPromises();
    expect(analyzeSgf).not.toHaveBeenCalled();
    expect(analyzePosition.mock.calls.at(-1)![0]).toMatchObject({ ply: 1, moves: ["A9"] });
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("C3");
    await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
    const positionCount = analyzePosition.mock.calls.length;
    const panel = wrapper.getComponent(EngineSourcePanel);
    panel.vm.$emit("connect-browser");
    await flushPromises();
    panel.vm.$emit("connect-browser");
    await flushPromises();
    expect(analyzeSgf).not.toHaveBeenCalled();
    expect(analyzePosition).toHaveBeenCalledTimes(positionCount + 2);
    expect(analyzePosition.mock.calls.at(-1)![0]).toMatchObject({ ply: 1, moves: ["A9"] });
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("C3");
    wrapper.unmount();
  });

  it("uses the chosen native endpoint and passes anchor history plus branch moves", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      requests.push({ url, body });
      const event = url.endsWith("/analyze-position")
        ? result(body)
        : { type: "gameCompleted", v: 1 };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    }));
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: sgf, vertexSize: 16 } });
    await flushPromises();
    await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
    wrapper.getComponent(EngineSourcePanel).vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
    await flushPromises();
    wrapper.getComponent(ReviewerLayout).vm.goToPly(1);
    await flushPromises();
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="try-pass"]').trigger("click");
    await flushPromises();
    expect(requests.at(-1)).toMatchObject({
      url: "http://127.0.0.1:9999/analyze-position",
      body: { ply: 1, moves: ["pass"], visits: 200 },
    });
    expect(requests.at(-1)!.body.sgf).toContain("B[dd]");
    expect(requests.at(-1)!.body.sgf).not.toContain("W[ff]");
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("C3");
    const requestCount = requests.length;
    wrapper.getComponent(EngineSourcePanel).vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
    await flushPromises();
    expect(requests).toHaveLength(requestCount + 1);
    expect(requests.at(-1)).toMatchObject({
      url: "http://127.0.0.1:9999/analyze-position",
      body: { ply: 1, moves: ["pass"] },
    });
    expect(requests.filter((request) => request.url.endsWith("/analyze"))).toHaveLength(1);
    wrapper.unmount();
  });

  it("clears an empty SGF and ignores its previous pending variation", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const stop = vi.fn();
    const analyzePosition = vi.fn(async function* (request: PositionAnalysisRequest) {
      await pending;
      yield JSON.stringify(result(request));
    });
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sgf, vertexSize: 16,
        browserEngine: { analyzeSgf: async function* () {}, analyzePosition, stop },
      },
    });
    await flushPromises();
    wrapper.getComponent(ReviewerLayout).vm.goToPly(1);
    await flushPromises();
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await flushPromises();
    expect(analyzePosition).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ initialSgf: "" });
    await flushPromises();
    expect(stop).toHaveBeenCalled();
    expect(wrapper.getComponent(ReviewerLayout).vm.tryMode).toBe(false);
    expect(wrapper.getComponent(ReviewerLayout).vm.moveNumber).toBe(0);
    finish();
    await flushPromises();
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("C3");
    expect(wrapper.get('.shudan-vertex[data-x="3"][data-y="3"]').classes()).toContain("shudan-sign_0");
    wrapper.unmount();
  });

  it("discards a slow older SGF file read after a newer SGF is selected", async () => {
    let resolveOld!: (text: string) => void;
    const old = { name: "old.sgf", text: () => new Promise<string>((done) => { resolveOld = done; }) } as File;
    const latest = { name: "latest.sgf", text: async () => "(;SZ[13])" } as File;
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: sgf, vertexSize: 16 } });
    await flushPromises();
    await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
    const panel = wrapper.getComponent(EngineSourcePanel);
    panel.vm.$emit("sgf-file", old);
    panel.vm.$emit("sgf-file", latest);
    await flushPromises();
    resolveOld("(;SZ[5])");
    await flushPromises();
    expect(wrapper.getComponent(ReviewerLayout).vm.boardSize).toBe(13);
    wrapper.unmount();
  });
});
