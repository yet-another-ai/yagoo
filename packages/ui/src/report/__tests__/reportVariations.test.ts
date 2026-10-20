import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PositionAnalysisRequest } from "../../analysis";
import type { PipelineEvent, PositionSnapshot } from "../../analysis/types";
import snapshotsJson from "../../analysis/__fixtures__/comparison-positions.json";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import AnalysisReviewer from "../../layout/AnalysisReviewer.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";
import VariationTree from "../../reviewer/VariationTree.vue";

const snapshot = (snapshotsJson as unknown as PositionSnapshot[]).find((row) => row.ply === 60)!;
const start: PipelineEvent = {
  type: "gameStarted", v: 1, size: 19, komi: .5,
  moveCount: 100, positionCount: 101, strategy: "scan_then_deep",
};
const completed: PipelineEvent = { type: "positionCompleted", v: 1, phase: "deep", snapshot };
const finished: PipelineEvent = { type: "gameCompleted", v: 1 };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const sse = (events: PipelineEvent[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

afterEach(() => vi.unstubAllGlobals());

describe("Review leaves live variations before starting a full-game request", () => {
  it("cancels pending browser Try work before one full-game run and retains the stopped report", async () => {
    const variationRuns: Array<{ request: PositionAnalysisRequest; finish: () => void }> = [];
    const calls: string[] = [];
    const fullGame = deferred<void>();
    const analyzePosition = vi.fn(async function* (request: PositionAnalysisRequest) {
      const pending = deferred<void>();
      variationRuns.push({ request, finish: () => pending.resolve() });
      calls.push("position");
      await pending.promise;
      yield JSON.stringify({ ...completed, snapshot: {
        ...snapshot, ply: request.ply + (request.moves?.length ?? 0), comparison: null,
        candidates: [{ move: "C3", visits: 999, scoreLead: 99 }],
      } });
    });
    const analyzeSgf = vi.fn(async function* () {
      calls.push("game");
      yield JSON.stringify(start);
      yield JSON.stringify(completed);
      await fullGame.promise;
      yield JSON.stringify(finished);
    });
    const stop = vi.fn(() => { calls.push("stop"); });
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sampleSgf, vertexSize: 12, browserEngine: { analyzeSgf, analyzePosition, stop } },
    });
    await flushPromises();
    const layout = wrapper.getComponent(ReviewerLayout);
    layout.vm.goToPly(1);
    await flushPromises();
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
    await flushPromises();
    expect(variationRuns.at(-1)!.request).toMatchObject({ ply: 1, moves: ["A19"] });
    const beforeReview = calls.length;

    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    expect(analyzeSgf).toHaveBeenCalledExactlyOnceWith(sampleSgf);
    expect(layout.vm.tryMode).toBe(false);
    expect(calls.slice(beforeReview)).toEqual(["stop", "game"]);
    expect(wrapper.get('[data-testid="review-report"]').text()).toContain("Move 60");
    const reportWhileRunning = wrapper.get('[data-testid="review-report"]').text();
    const positionCalls = analyzePosition.mock.calls.length;
    variationRuns.forEach((run) => run.finish());
    await flushPromises();
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    expect(analyzeSgf).toHaveBeenCalledTimes(1);
    expect(analyzePosition).toHaveBeenCalledTimes(positionCalls);
    expect(calls.slice(beforeReview)).toEqual(["stop", "game"]);
    expect(wrapper.get('[data-testid="review-report"]').text()).toBe(reportWhileRunning);

    await wrapper.get('[data-testid="cancel-review"]').trigger("click");
    fullGame.resolve();
    await flushPromises();
    expect(wrapper.get('[data-testid="review-report"]').text()).toMatch(/partial[\s\S]*Move 60/);
    expect(wrapper.text()).toContain("Analysis stopped.");
    await wrapper.findAll("button").find((button) => button.text() === "Back to board")!.trigger("click");
    expect(wrapper.find('[data-testid="try-banner"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("C3");
    wrapper.unmount();
  });

  it("leaves an existing SGF variation and sends the entire SGF to the chosen native endpoint", async () => {
    const sgf = "(;SZ[9];B[dd](;W[ff];B[ee])(;W[cc];B[bb]))";
    const pendingVariation = deferred<Response>();
    const requests: Array<{ url: string; body: unknown; signal: AbortSignal }> = [];
    const root: PipelineEvent = {
      type: "positionCompleted", v: 1, phase: "scan", snapshot: {
        schemaVersion: 1, ply: 0, toPlay: "B", ownershipConvention: "black_positive",
        board: { size: 9, black: [], white: [] }, chains: [], root: { visits: 100 },
      },
    };
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(options.body)), signal: options.signal as AbortSignal });
      if (url.endsWith("/analyze-position")) return pendingVariation.promise;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse([
            { ...start, size: 9, moveCount: 3, positionCount: 4 }, root,
          ])));
        },
      }), { headers: { "content-type": "text/event-stream" } }));
    }));
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: sgf, vertexSize: 12 } });
    await flushPromises();
    const layout = wrapper.getComponent(ReviewerLayout);
    layout.vm.goToPly(1);
    await flushPromises();
    wrapper.getComponent(VariationTree).vm.$emit("select-variation", 1);
    await flushPromises();
    await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
    wrapper.getComponent(EngineSourcePanel).vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
    await flushPromises();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toMatchObject({ ply: 2, moves: [] });
    expect((requests[0]!.body as { sgf: string }).sgf).toContain("W[cc]");

    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ url: "http://127.0.0.1:9999/analyze", body: { sgf } });
    expect(requests[1]!.body).toEqual({ sgf });
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.signal.aborted).toBe(false);
    expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 1/4");
    pendingVariation.resolve(new Response(sse([{ ...root, snapshot: { ...root.snapshot, ply: 2 } }]), {
      headers: { "content-type": "text/event-stream" },
    }));
    await flushPromises();
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.signal.aborted).toBe(false);
    expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 1/4");
    await wrapper.get('[data-testid="cancel-review"]').trigger("click");
    expect(requests[1]!.signal.aborted).toBe(true);
    expect(wrapper.text()).toContain("Analysis stopped.");
    await wrapper.findAll("button").find((button) => button.text() === "Back to board")!.trigger("click");
    expect(layout.vm.moveNumber).toBe(2);
    expect(wrapper.find('[data-testid="try-banner"]').exists()).toBe(false);
    expect(wrapper.get('.shudan-vertex[data-x="5"][data-y="5"]').classes()).toContain("shudan-sign_-1");
    expect(wrapper.get('.shudan-vertex[data-x="2"][data-y="2"]').classes()).toContain("shudan-sign_0");
    wrapper.unmount();
  });
});
