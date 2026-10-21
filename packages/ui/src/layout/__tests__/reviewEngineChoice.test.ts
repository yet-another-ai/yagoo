import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../AnalysisReviewer.vue";
import ReviewerLayout from "../ReviewerLayout.vue";

const firstSgf = "(;SZ[9];B[dd])";
const secondSgf = "(;SZ[9];B[cc])";
const thirdSgf = "(;SZ[9];B[ee])";
const nativeUrl = "http://127.0.0.1:9999/analyze";
type ImportMethod = "prop" | "upload" | "drop";

async function loadSgf(wrapper: VueWrapper, method: ImportMethod, sgf: string) {
  if (method === "prop") {
    await wrapper.setProps({ initialSgf: sgf });
  } else {
    const file = new File([sgf], "next.sgf", { type: "text/plain" });
    if (method === "upload") {
      const input = wrapper.get('[data-testid="source-sgf-input"]');
      Object.defineProperty(input.element, "files", { configurable: true, value: [file] });
      await input.trigger("change");
    } else {
      await wrapper.trigger("drop", { dataTransfer: { files: [file] } });
    }
  }
  await flushPromises();
}

// Controlled transport events exercise request ownership without running a model.
function result(visits: number): PipelineEvent[] {
  return [
    { type: "gameStarted", v: 1, size: 9, komi: 7.5, moveCount: 1, positionCount: 2, strategy: "deep_only" },
    {
      type: "positionCompleted", v: 1, phase: "deep", snapshot: {
        schemaVersion: 1, ply: 0, toPlay: "B", ownershipConvention: "black_positive",
        board: { size: 9, black: [], white: [] }, chains: [], root: { visits }, candidates: [],
      },
    },
    { type: "gameCompleted", v: 1 },
  ];
}

function response(visits: number) {
  return new Response(result(visits).map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("explicit review engine choice across SGF changes", () => {
  it.each([
    ["prop", false], ["upload", false], ["drop", false],
    ["prop", true], ["upload", true], ["drop", true],
  ] as const)("keeps the native endpoint after %s changes (browser available: %s)", async (method, browserAvailable) => {
    const releases: Array<(response: Response) => void> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => { releases.push(resolve); }));
    vi.stubGlobal("fetch", fetch);
    const analyzeSgf = vi.fn(async function* () {});
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: firstSgf, vertexSize: 12,
        browserEngine: browserAvailable ? { analyzeSgf } : null,
      },
    });
    try {
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      await wrapper.get('[data-testid="native-url"]').setValue(nativeUrl);
      await wrapper.get('[data-source="live-native"] button').trigger("click");
      await flushPromises();
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ sgf: firstSgf });

      await loadSgf(wrapper, method, secondSgf);
      expect(wrapper.getComponent(ReviewerLayout).props("sgf")).toBe(secondSgf);
      expect(fetch.mock.calls[0]![1]!.signal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledOnce(); // Loading never sends the new game.
      expect(analyzeSgf).not.toHaveBeenCalled();
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1]![0]).toBe(nativeUrl);
      expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({ sgf: secondSgf });
      expect(analyzeSgf).not.toHaveBeenCalled();

      await wrapper.get('[data-testid="review-game"]').trigger("click");
      expect(fetch).toHaveBeenCalledTimes(2);
      await wrapper.get('[data-testid="cancel-review"]').trigger("click");
      expect(fetch.mock.calls[1]![1]!.signal?.aborted).toBe(true);
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toEqual({ sgf: secondSgf });

      await loadSgf(wrapper, method, thirdSgf);
      expect(fetch.mock.calls[2]![1]!.signal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch.mock.calls[3]![0]).toBe(nativeUrl);
      expect(JSON.parse(fetch.mock.calls[3]![1]!.body as string)).toEqual({ sgf: thirdSgf });
      releases[3]!(response(77));
      await flushPromises();
      expect(wrapper.getComponent(ReviewerLayout).props("rootAnalysis")?.visits).toBe(77);

      // Superseded and canceled requests may resolve after the newest result.
      releases.slice(0, 3).forEach(release => release(response(999)));
      await flushPromises();
      expect(wrapper.getComponent(ReviewerLayout).props("rootAnalysis")?.visits).toBe(77);
      expect(wrapper.getComponent(ReviewerLayout).props("sgf")).toBe(thirdSgf);
      expect(analyzeSgf).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="cancel-review"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(["prop", "upload", "drop"] as const)("invalidates recorded analysis on %s without starting an engine", async method => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const analyzeSgf = vi.fn(async function* () {});
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: firstSgf, vertexSize: 12, browserEngine: { analyzeSgf },
        initialNdjson: result(120).map(event => JSON.stringify(event)).join("\n"),
      },
    });
    try {
      await flushPromises();
      frames.splice(0).forEach(callback => callback(0));
      await flushPromises();
      expect(wrapper.getComponent(ReviewerLayout).props("rootAnalysis")?.visits).toBe(120);
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      await loadSgf(wrapper, method, secondSgf);
      expect(wrapper.getComponent(ReviewerLayout).props("rootAnalysis")).toBeNull();
      expect(analyzeSgf).not.toHaveBeenCalled();
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      await flushPromises();
      expect(analyzeSgf).toHaveBeenCalledExactlyOnceWith(secondSgf);
    } finally {
      wrapper.unmount();
    }
  });
});
