import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { constructedSacrifice, constructedSgf } from "../../analysis/__tests__/constructedSacrifice";
import { parseGtpVertex } from "../../analysis/coords";
import type { PositionSnapshot } from "../../analysis/types";
import type { GroundedCommentary } from "../../commentary/facts";
import type { CommentaryRequest } from "../../commentary/session";
import Goban from "../../goban/Goban.vue";
import AnalysisReviewer from "../AnalysisReviewer.vue";
import ReviewerLayout from "../ReviewerLayout.vue";

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    await flushPromises();
  }
}

describe("commentary citation overlays", () => {
  it.each(["group-0-status", "sacrifice-0"])("replaces a ledger zone with the %s citation and clears on blur/branch entry", async (fact) => {
    // Constructed legal rendering contract, not engine evidence. The current
    // group includes B3, unlike the before-move comparison's B2/C2 group.
    const comparison = constructedSacrifice();
    const zone = ["A5", "B5", "C5", "D5", "A4"];
    const groupStones = ["B2", "C2", "B3"];
    const snapshot: PositionSnapshot = {
      schemaVersion: 1, ply: 1, toPlay: "W", lastMove: "B3", ownershipConvention: "black_positive",
      board: { ...comparison.context!.board, black: groupStones }, chains: [],
      groups: [{
        groupId: "B2", kind: "simple", status: "weak",
        members: { blackStones: groupStones, whiteStones: [], empty: [] },
      }],
      root: { visits: 64 }, comparison,
      ledger: {
        rootPly: 1, mover: "W", move: "E1", vs: "pass", referenceMove: "pass",
        value: 1, consistent: true, scaling: "score", bookTotal: 1,
        ledger: [{ kind: "own_territory", points: 1, bookValue: 1, proportion: 1, intersections: zone }],
      },
    };
    const wrapper = mount(AnalysisReviewer, { props: {
      initialSgf: constructedSgf, vertexSize: 16, initialPerspective: "notes",
      initialNdjson: JSON.stringify({ type: "positionCompleted", v: 1, phase: "deep", snapshot }),
    } });
    try {
      await settle();
      const layout = wrapper.getComponent(ReviewerLayout);
      layout.vm.goToPly(1);
      await settle();
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      await wrapper.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
      const packet = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
      const zoneFact = packet.facts.find((entry) => entry.id.endsWith("/ledger-line-0"))!;
      const groupFact = packet.facts.find((entry) => entry.id.endsWith(`/${fact}`))!;
      expect(groupFact).toBeDefined();
      await wrapper.get('[data-testid="commentary-response"]').setValue(JSON.stringify({
        version: 1, requestId: packet.requestId,
        selections: [zoneFact, groupFact].map((entry) => ({ factId: entry.id, variant: 0 })),
      }));
      await wrapper.get('[data-testid="commentary-import"]').trigger("click");
      const saved = structuredClone(layout.props("commentary")) as GroundedCommentary;
      const goban = wrapper.getComponent(Goban);
      const zoneButton = wrapper.get(`[data-fact-id="${zoneFact.id}"]`);
      const groupButton = wrapper.get(`[data-fact-id="${groupFact.id}"]`);
      await zoneButton.trigger("click");
      expect(goban.props("selectedVertices")).toEqual(zone.map((point) => parseGtpVertex(point, 5)));

      // No intermediate blur: the next citation must replace the old zone.
      await groupButton.trigger("focus");
      const selected = groupStones.map((point) => parseGtpVertex(point, 5)!);
      expect(goban.props("selectedVertices")).toEqual(selected);
      expect(goban.props("dimmedVertices")).toEqual(Array.from({ length: 25 }, (_, i) => [i % 5, Math.floor(i / 5)])
        .filter(([x, y]) => !selected.some(([sx, sy]) => sx === x && sy === y)));
      expect(goban.props("signMap")![2]![1]).toBe(1); // Current board, including actual B3.
      expect(layout.props("commentary")).toEqual(saved);
      await groupButton.trigger("blur");
      expect(goban.props("selectedVertices")).toEqual([]);
      expect(goban.props("dimmedVertices")).toEqual([]);

      await zoneButton.trigger("click");
      await groupButton.trigger("click");
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(goban.props("selectedVertices")).toEqual([]);
      expect(goban.props("dimmedVertices")).toEqual([]);
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(goban.props("selectedVertices")).toEqual([]);
      expect(goban.props("dimmedVertices")).toEqual([]);
      expect(layout.props("commentary")).toEqual(saved);
    } finally {
      wrapper.unmount();
    }
  });
});
