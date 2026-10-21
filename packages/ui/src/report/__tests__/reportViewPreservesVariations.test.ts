import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { PositionAnalysisRequest } from "../../analysis";
import AnalysisReviewer from "../../layout/AnalysisReviewer.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import VariationTree from "../../reviewer/VariationTree.vue";

const sgf = "(;SZ[9];B[dd](;W[ff];B[ee])(;W[cc];B[bb]))";

// Controlled transport result; this test does not run an engine or model.
function positionResult(request: PositionAnalysisRequest) {
  return JSON.stringify({
    type: "positionCompleted", v: 1, phase: "deep", snapshot: {
      schemaVersion: 1, ply: request.ply + (request.moves?.length ?? 0), toPlay: "B",
      ownershipConvention: "black_positive", board: { size: 9, black: [], white: [] },
      chains: [], root: { visits: 999 }, candidates: [{ move: "H8", visits: 999 }],
    },
  });
}

describe("passive report view preserves variation work", () => {
  it.each(["try", "sgf"] as const)("retains the selected %s branch while stopping hidden position work", async branch => {
    const releases: Array<() => void> = [];
    const analyzePosition = vi.fn(async function* (request: PositionAnalysisRequest) {
      await new Promise<void>(resolve => { releases.push(resolve); });
      yield positionResult(request);
    });
    const analyzeSgf = vi.fn(async function* () {});
    const stop = vi.fn();
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sgf, vertexSize: 12, browserEngine: { analyzeSgf, analyzePosition, stop } },
    });
    try {
      await flushPromises();
      const layout = wrapper.getComponent(ReviewerLayout);
      layout.vm.goToPly(1);
      await flushPromises();
      if (branch === "try") {
        await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
        await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
        await wrapper.get('.shudan-vertex[data-x="1"][data-y="0"]').trigger("click");
        // A sibling is also local work that must survive opening the report.
        wrapper.getComponent(VariationTree).vm.$emit("select-try", null);
        await flushPromises();
        await wrapper.get('.shudan-vertex[data-x="2"][data-y="0"]').trigger("click");
      } else {
        wrapper.getComponent(VariationTree).vm.$emit("select-variation", 1);
      }
      await flushPromises();
      const tree = wrapper.getComponent(VariationTree);
      const savedNodes = JSON.parse(JSON.stringify(tree.props("nodes")));
      const savedCursor = tree.props("cursorId");
      const savedPly = layout.vm.moveNumber;
      const savedRequest = analyzePosition.mock.calls.at(-1)![0];
      const callsBeforeReport = analyzePosition.mock.calls.length;
      const stopsBeforeReport = stop.mock.calls.length;

      await wrapper.get('[data-testid="report-toggle"]').trigger("click");
      await flushPromises();
      expect(layout.vm.tryMode).toBe(branch === "try");
      expect(layout.vm.moveNumber).toBe(savedPly);
      expect(wrapper.find('[data-testid="review-report"]').exists()).toBe(true);
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeReport);
      expect(analyzePosition).toHaveBeenCalledTimes(callsBeforeReport);
      expect(analyzeSgf).not.toHaveBeenCalled();

      // Navigation can queue variation-key watchers while the board is hidden.
      await layout.trigger("keydown", { key: branch === "try" ? "ArrowLeft" : "ArrowRight" });
      await layout.trigger("keydown", { key: branch === "try" ? "ArrowRight" : "ArrowLeft" });
      await flushPromises();
      expect(analyzePosition).toHaveBeenCalledTimes(callsBeforeReport);
      releases.forEach(release => release());
      await flushPromises();
      await wrapper.get('[data-testid="report-toggle"]').trigger("click");
      await flushPromises();
      expect(layout.vm.tryMode).toBe(branch === "try");
      expect(layout.vm.moveNumber).toBe(savedPly);
      expect(wrapper.getComponent(VariationTree).props("nodes")).toEqual(savedNodes);
      expect(wrapper.getComponent(VariationTree).props("cursorId")).toBe(savedCursor);
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("H8");
      expect(analyzePosition).toHaveBeenCalledTimes(callsBeforeReport);

      // Adapter changes must not start hidden requests or discard the tree.
      await wrapper.get('[data-testid="report-toggle"]').trigger("click");
      const nextPosition = vi.fn(async function* (request: PositionAnalysisRequest) {
        yield positionResult(request);
      });
      await wrapper.setProps({ browserEngine: { analyzeSgf, analyzePosition: nextPosition, stop } });
      await flushPromises();
      expect(nextPosition).not.toHaveBeenCalled();
      await wrapper.findAll("button").find(button => button.text() === "Back to board")!.trigger("click");
      await flushPromises();
      expect(wrapper.getComponent(VariationTree).props("nodes")).toEqual(savedNodes);
      expect(wrapper.getComponent(VariationTree).props("cursorId")).toBe(savedCursor);
      expect(nextPosition).not.toHaveBeenCalled();
      expect(analyzeSgf).not.toHaveBeenCalled();
      if (branch === "sgf") {
        expect(wrapper.get('.shudan-vertex[data-x="2"][data-y="2"]').classes()).toContain("shudan-sign_-1");
        expect(wrapper.get('.shudan-vertex[data-x="5"][data-y="5"]').classes()).toContain("shudan-sign_0");
      }

      // The preserved position remains available for an explicit fresh request.
      await wrapper.get('[data-testid="analyze-variation"]').trigger("click");
      await flushPromises();
      expect(nextPosition).toHaveBeenCalledExactlyOnceWith(savedRequest);
      expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("H8");
    } finally {
      wrapper.unmount();
      releases.forEach(release => release());
    }
  });
});
