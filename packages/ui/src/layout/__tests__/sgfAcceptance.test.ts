import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../AnalysisReviewer.vue";
import ReviewerLayout from "../ReviewerLayout.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";

const accepted = "(;SZ[9];B[dd];W[ff])";
const rejected = "(;SZ[5]AB[aa]B[aa])";
const replacement = "(;SZ[5];B[cc])";
const sgfFile = (text: string) => ({ name: "replacement.sgf", text: async () => text }) as File;
function result(visits: number, ply = 0): PipelineEvent {
  return {
    type: "stageCompleted", v: 1, phase: "scan", stage: "root", ply,
    analysis: { visits, winrate: 0.6 },
  };
}
const recording = [result(65), result(65, 1), { type: "gameCompleted", v: 1 }]
  .map(event => JSON.stringify(event)).join("\n");

afterEach(() => vi.unstubAllGlobals());

describe("accepted SGF replacement", () => {
  it.each(["sgf", "ndjson"] as const)("a rejected latest SGF supersedes an older pending %s import", async (kind) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let finishOld!: (text: string) => void;
    const oldFile = {
      name: `older.${kind}`,
      text: vi.fn(() => new Promise<string>(resolve => { finishOld = resolve; })),
    } as unknown as File;
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: accepted, initialNdjson: recording, vertexSize: 16 },
    });
    try {
      frames.splice(0).forEach(callback => callback(0));
      await flushPromises();
      const layout = wrapper.getComponent(ReviewerLayout);
      layout.vm.goToPly(1);
      await flushPromises();
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const panel = wrapper.getComponent(EngineSourcePanel);
      if (kind === "sgf") panel.vm.$emit("sgf-file", oldFile);
      else panel.vm.$emit("ndjson-file", oldFile);
      expect(oldFile.text).toHaveBeenCalledOnce();
      panel.vm.$emit("sgf-file", sgfFile(rejected));
      await flushPromises();
      const rejection = wrapper.get('[role="alert"]').text();
      expect(rejection).toContain("Illegal SGF move 1");
      expect(layout.props("sgf")).toBe(accepted);
      expect(layout.props("rootAnalysis")?.visits).toBe(65);

      // The latest selection supersedes old import intent even when it fails.
      // An already accepted game/analysis remains; an old read must not attach later.
      finishOld(kind === "sgf" ? replacement : [result(999, 1), { type: "gameCompleted", v: 1 }]
        .map(event => JSON.stringify(event)).join("\n"));
      await flushPromises();
      frames.splice(0).forEach(callback => callback(0));
      await flushPromises();
      expect(layout.props("sgf")).toBe(accepted);
      expect(layout.vm.boardSize).toBe(9);
      expect(layout.vm.moveNumber).toBe(1);
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      expect(wrapper.get('[role="alert"]').text()).toBe(rejection);
      expect(wrapper.get(".yagoo-analysis-app__meta").text()).toContain("bundled sample analysis");
      expect(wrapper.text()).toContain("Loaded bundled sample analysis");
      expect(wrapper.text()).not.toContain(`older.${kind}`);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(["upload", "drop", "prop"] as const)("retains the accepted game, results and pending Try after a rejected %s", async (route) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const cancelTry = vi.fn();
    const analyzePosition = vi.fn(() => new ReadableStream<string>({ cancel: cancelTry }));
    const analyzeSgf = vi.fn((..._args: unknown[]) => new ReadableStream<string>());
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(
      new ReadableStream(), { headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetch);
    const pairedRecordingRead = vi.fn(async () => JSON.stringify(result(999)));
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: accepted, initialNdjson: recording, vertexSize: 16, browserEngine: { analyzeSgf, analyzePosition } },
    });
    try {
      frames.splice(0).forEach(callback => callback(0));
      await flushPromises();
      const layout = wrapper.getComponent(ReviewerLayout);
      layout.vm.goToPly(1);
      await flushPromises();
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(analyzePosition).toHaveBeenCalledOnce();
      async function replace(text: string) {
        if (route === "prop") await wrapper.setProps({ initialSgf: text });
        else if (route === "drop") {
          await wrapper.trigger("drop", { dataTransfer: { files: [
            sgfFile(text), ...(text === rejected ? [{ name: "rejected.ndjson", text: pairedRecordingRead }] : []),
          ] } });
        } else {
          const input = wrapper.get<HTMLInputElement>('.yagoo-analysis-app__controls input[type="file"]');
          Object.defineProperty(input.element, "files", { configurable: true, value: [sgfFile(text)] });
          await input.trigger("change");
        }
        await flushPromises();
      }
      await replace(rejected);
      // Local paired files may be read concurrently, but rejected evidence must
      // never attach to the retained game, even after queued recording frames.
      frames.splice(0).forEach(callback => callback(0));
      await flushPromises();
      expect(layout.props("sgf")).toBe(accepted);
      expect(layout.vm.boardSize).toBe(9);
      expect(layout.vm.moveNumber).toBe(1);
      expect(layout.vm.tryMode).toBe(true);
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      expect(cancelTry).not.toHaveBeenCalled();

      expect(wrapper.text()).toContain("bundled sample analysis");
      expect(wrapper.get('[role="alert"]').text()).toContain("Illegal SGF move 1");
      layout.vm.leaveVariation();
      await flushPromises();
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const panel = wrapper.getComponent(EngineSourcePanel);
      panel.vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
      await flushPromises();
      expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).sgf).toBe(accepted);
      panel.vm.$emit("connect-browser");
      await flushPromises();
      expect(JSON.stringify(analyzeSgf.mock.calls.at(-1))).toContain(accepted);
      expect(JSON.stringify(analyzeSgf.mock.calls)).not.toContain(rejected);
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      await flushPromises();
      expect(layout.vm.tryMode).toBe(true);
      expect(cancelTry).toHaveBeenCalledOnce();
      await replace(replacement);
      expect(layout.vm.tryMode).toBe(false);
      expect(cancelTry).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(layout.props("sgf")).toBe(replacement);
      expect(layout.vm.boardSize).toBe(5);
      panel.vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
      await flushPromises();
      expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).sgf).toBe(replacement);
    } finally {
      wrapper.unmount();
    }
  });

  it("keeps a live mainline request running when a replacement is rejected", async () => {
    let stream!: ReadableStreamDefaultController<string>;
    const cancel = vi.fn();
    const analyzeSgf = vi.fn(() => new ReadableStream<string>({
      start(controller) { stream = controller; controller.enqueue(JSON.stringify(result(65))); }, cancel,
    }));
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: accepted, vertexSize: 16, browserEngine: { analyzeSgf } } });
    try {
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const panel = wrapper.getComponent(EngineSourcePanel);
      panel.vm.$emit("connect-browser");
      await flushPromises();
      panel.vm.$emit("sgf-file", sgfFile(rejected));
      await flushPromises();
      const layout = wrapper.getComponent(ReviewerLayout);
      expect(layout.props("sgf")).toBe(accepted);
      expect(layout.props("rootAnalysis")?.visits).toBe(65);
      expect(cancel).not.toHaveBeenCalled();
      stream.enqueue(JSON.stringify(result(75)));
      await flushPromises();
      expect(layout.props("rootAnalysis")?.visits).toBe(75);
      panel.vm.$emit("sgf-file", sgfFile(replacement));
      await flushPromises();
      expect(cancel).toHaveBeenCalledOnce();
      expect(layout.props("sgf")).toBe(replacement);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it("blocks engine requests for an invalid initial SGF until a valid game arrives", async () => {
    const analyzeSgf = vi.fn(async function* () {});
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      new ReadableStream(), { headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: rejected, vertexSize: 16, browserEngine: { analyzeSgf } } });
    try {
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const panel = wrapper.getComponent(EngineSourcePanel);
      panel.vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
      panel.vm.$emit("connect-browser");
      await flushPromises();
      expect(fetch).not.toHaveBeenCalled();
      expect(analyzeSgf).not.toHaveBeenCalled();
      expect(wrapper.get('[role="alert"]').text()).toContain("Illegal SGF move 1");
      await wrapper.setProps({ initialSgf: replacement });
      panel.vm.$emit("connect-native", "http://127.0.0.1:9999/analyze");
      await flushPromises();
      expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).sgf).toBe(replacement);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
