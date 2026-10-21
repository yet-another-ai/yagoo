import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PositionAnalysisRequest } from "../../analysis";
import type { PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../../layout/AnalysisReviewer.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import VariationTree from "../../reviewer/VariationTree.vue";

const sgf = "(;SZ[9];B[dd](;W[ff];B[ee])(;W[cc];B[bb]))";
type Branch = "try" | "sgf";
const start: PipelineEvent = {
  type: "gameStarted", v: 1, size: 9, komi: 7.5,
  moveCount: 3, positionCount: 4, strategy: "deep_only",
};
const finished: PipelineEvent = { type: "gameCompleted", v: 1 };
// Controlled protocol events, not model-generated fixtures.
function position(ply: number, visits: number): PipelineEvent {
  return {
    type: "positionCompleted", v: 1, phase: "deep", snapshot: {
      schemaVersion: 1, ply, toPlay: "B", ownershipConvention: "black_positive",
      board: { size: 9, black: [], white: [] }, chains: [], root: { visits },
      candidates: [{ move: "H8", visits }],
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function backToBoard(wrapper: VueWrapper) {
  await wrapper.findAll("button").find(button => button.text() === "Back to board")!.trigger("click");
  await flushPromises();
}

async function selectBranch(wrapper: VueWrapper, branch: Branch) {
  const layout = wrapper.getComponent(ReviewerLayout);
  layout.vm.goToPly(1);
  await flushPromises();
  if (branch === "try") {
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="1"][data-y="0"]').trigger("click");
  } else {
    wrapper.getComponent(VariationTree).vm.$emit("select-variation", 1);
  }
  await flushPromises();
  const tree = wrapper.getComponent(VariationTree);
  const nodes = JSON.parse(JSON.stringify(tree.props("nodes")));
  const cursor = tree.props("cursorId");
  const ply = layout.vm.moveNumber;
  return () => {
    expect(layout.vm.tryMode).toBe(branch === "try");
    expect(layout.vm.moveNumber).toBe(ply);
    expect(wrapper.getComponent(VariationTree).props("nodes")).toEqual(nodes);
    expect(wrapper.getComponent(VariationTree).props("cursorId")).toBe(cursor);
    if (branch === "sgf") {
      expect(wrapper.get('.shudan-vertex[data-x="2"][data-y="2"]').classes()).toContain("shudan-sign_-1");
      expect(wrapper.get('.shudan-vertex[data-x="5"][data-y="5"]').classes()).toContain("shudan-sign_0");
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Review reuses an existing report without discarding variation work", () => {
  it.each(["completed", "pending"] as const)("does not stop a browser full-game run through its previous %s position handle", async positionState => {
    const oldPosition = deferred();
    const fullGame = deferred();
    const analyzePosition = vi.fn(async function* (request: PositionAnalysisRequest) {
      if (positionState === "pending") await oldPosition.promise;
      yield JSON.stringify(position(request.ply + (request.moves?.length ?? 0), 999));
    });
    const analyzeSgf = vi.fn(async function* () {
      yield JSON.stringify(start);
      yield JSON.stringify(position(0, 100));
      await fullGame.promise;
      yield JSON.stringify(position(1, 200));
      yield JSON.stringify(finished);
    });
    const stop = vi.fn();
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sgf, vertexSize: 12, browserEngine: { analyzeSgf, analyzePosition, stop } },
    });
    try {
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      await flushPromises();
      expect(analyzePosition).toHaveBeenCalledOnce();
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      await flushPromises();
      expect(wrapper.getComponent(ReviewerLayout).vm.tryMode).toBe(false);
      const expectedStops = positionState === "pending" ? 1 : 0;
      expect(stop).toHaveBeenCalledTimes(expectedStops);
      for (let repeat = 0; repeat < 2; repeat++) {
        await wrapper.get('[data-testid="review-game"]').trigger("click");
        await flushPromises();
        expect(analyzeSgf).toHaveBeenCalledExactlyOnceWith(sgf);
        expect(analyzePosition).toHaveBeenCalledOnce();
        expect(stop).toHaveBeenCalledTimes(expectedStops);
      }
      oldPosition.resolve();
      await flushPromises();
      expect(wrapper.getComponent(ReviewerLayout).props("rootAnalysis")?.visits).toBe(100);
      expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 1/4");
      fullGame.resolve();
      await flushPromises();
      expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 2/4");
      expect(wrapper.find('[data-testid="cancel-review"]').exists()).toBe(false);
      expect(stop).toHaveBeenCalledTimes(expectedStops);
    } finally {
      wrapper.unmount();
      oldPosition.resolve();
      fullGame.resolve();
    }
  });

  it.each(["try", "sgf"] as const)("keeps a browser full-game stream running while reopening its report from %s", async branch => {
    const advance = deferred();
    const finish = deferred();
    const analyzeSgf = vi.fn(async function* () {
      yield JSON.stringify(start);
      yield JSON.stringify(position(0, 100));
      await advance.promise;
      yield JSON.stringify(position(1, 200));
      await finish.promise;
      yield JSON.stringify(position(2, 999));
      yield JSON.stringify(finished);
    });
    const stop = vi.fn();
    // Without a single-position API, local exploration can coexist with the
    // full-game stream; opening its report must not stop that shared adapter.
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sgf, vertexSize: 12, browserEngine: { analyzeSgf, stop } },
    });
    try {
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      await flushPromises();
      await backToBoard(wrapper);
      const assertBranchPreserved = await selectBranch(wrapper, branch);
      for (let repeat = 0; repeat < 2; repeat++) {
        await wrapper.get('[data-testid="review-game"]').trigger("click");
        await flushPromises();
        expect(wrapper.find('[data-testid="review-report"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="cancel-review"]').exists()).toBe(true);
        expect(analyzeSgf).toHaveBeenCalledExactlyOnceWith(sgf);
        expect(stop).not.toHaveBeenCalled();
      }
      await backToBoard(wrapper);
      assertBranchPreserved();
      await wrapper.get('[data-testid="review-game"]').trigger("click");
      advance.resolve();
      await flushPromises();
      expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 2/4");
      expect(stop).not.toHaveBeenCalled();

      await wrapper.get('[data-testid="cancel-review"]').trigger("click");
      expect(stop).toHaveBeenCalledOnce();
      finish.resolve();
      await flushPromises();
      expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 2/4");
      expect(wrapper.find('[data-testid="cancel-review"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("Analysis stopped.");
      await backToBoard(wrapper);
      assertBranchPreserved();
    } finally {
      wrapper.unmount();
      advance.resolve();
      finish.resolve();
    }
  });

  it.each(["try", "sgf"] as const)("reopens recorded evidence from %s and ignores canceled position responses", async branch => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const releases: Array<() => void> = [];
    const analyzePosition = vi.fn(async function* (request: PositionAnalysisRequest) {
      await new Promise<void>(resolve => { releases.push(resolve); });
      yield JSON.stringify(position(request.ply + (request.moves?.length ?? 0), 999));
    });
    const analyzeSgf = vi.fn(async function* () {});
    const stop = vi.fn();
    const recording = [start, ...[0, 1, 2, 3].map(ply => position(ply, 120)), finished];
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sgf, vertexSize: 12, browserEngine: { analyzeSgf, analyzePosition, stop },
        initialNdjson: recording.map(event => JSON.stringify(event)).join("\n"),
      },
    });
    try {
      for (let frame = 0; frame < 3; frame++) {
        frames.splice(0).forEach(callback => callback(0));
        await flushPromises();
      }
      const assertBranchPreserved = await selectBranch(wrapper, branch);
      const stopsBeforeReview = stop.mock.calls.length;
      const positionsBeforeReview = analyzePosition.mock.calls.length;
      for (let repeat = 0; repeat < 2; repeat++) {
        await wrapper.get('[data-testid="review-game"]').trigger("click");
        await flushPromises();
        expect(wrapper.find('[data-testid="review-report"]').exists()).toBe(true);
        expect(wrapper.get('[data-testid="report-coverage"]').text()).toContain("Completed positions 4/4");
        expect(analyzeSgf).not.toHaveBeenCalled();
        expect(analyzePosition).toHaveBeenCalledTimes(positionsBeforeReview);
        expect(stop).toHaveBeenCalledTimes(stopsBeforeReview + 1);
      }
      releases.forEach(release => release());
      await flushPromises();
      await backToBoard(wrapper);
      assertBranchPreserved();
      expect(wrapper.getComponent(ReviewerLayout).props("rootAnalysis")?.visits).toBe(120);
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("H8");
      expect(analyzePosition).toHaveBeenCalledTimes(positionsBeforeReview);
      expect(wrapper.find('[data-testid="analyze-variation"]').exists()).toBe(true);
    } finally {
      wrapper.unmount();
      releases.forEach(release => release());
    }
  });
});
