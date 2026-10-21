import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { constructedSacrifice, constructedSgf } from "../../analysis/__tests__/constructedSacrifice";
import { parseGtpVertex } from "../../analysis/coords";
import { buildGroupOutlines } from "../../analysis/groups";
import type { GroupSnapshot, PositionSnapshot } from "../../analysis/types";
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
  it.each(["group-0-status", "sacrifice-0"].flatMap((fact) => [false, true].map((pinned) => ({ fact, pinned }))))(
    "replaces a ledger zone with $fact and restores the prior pin (pinned=$pinned)", async ({ fact, pinned }) => {
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
      }, {
        groupId: "A2", kind: "simple", status: "settled",
        members: { blackStones: [], whiteStones: ["A2"], empty: [] },
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
      const goban = wrapper.getComponent(Goban);
      const priorSelection = pinned ? [parseGtpVertex("A2", 5)!] : [];
      const dimmedExcept = (selected: number[][]) => selected.length
        ? Array.from({ length: 25 }, (_, i) => [i % 5, Math.floor(i / 5)])
          .filter(([x, y]) => !selected.some(([sx, sy]) => sx === x && sy === y))
        : [];
      if (pinned) await wrapper.get('.yagoo-groups__row[data-group-id="A2"]').trigger("click");
      expect(goban.props("selectedVertices")).toEqual(priorSelection);
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
      const zoneButton = wrapper.get(`[data-fact-id="${zoneFact.id}"]`);
      const groupButton = wrapper.get(`[data-fact-id="${groupFact.id}"]`);
      await zoneButton.trigger("click");
      expect(goban.props("selectedVertices")).toEqual(zone.map((point) => parseGtpVertex(point, 5)));

      // No intermediate blur: the next citation must replace the old zone.
      await groupButton.trigger("focus");
      const selected = groupStones.map((point) => parseGtpVertex(point, 5)!);
      expect(goban.props("selectedVertices")).toEqual(selected);
      expect(goban.props("dimmedVertices")).toEqual(dimmedExcept(selected));
      expect(wrapper.get('svg path[data-group-id="B2"]').attributes("stroke-width")).toBe("3.5");
      expect(wrapper.get('svg path[data-group-id="A2"]').attributes("stroke-width")).toBe("1.25");
      expect(goban.props("signMap")![2]![1]).toBe(1); // Current board, including actual B3.
      expect(layout.props("commentary")).toEqual(saved);
      await groupButton.trigger("blur");
      expect(goban.props("selectedVertices")).toEqual(priorSelection);
      expect(goban.props("dimmedVertices")).toEqual(dimmedExcept(priorSelection));
      expect(wrapper.get('svg path[data-group-id="A2"]').attributes("stroke-width")).toBe(pinned ? "3.5" : "2");

      await zoneButton.trigger("click");
      await groupButton.trigger("click");
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(goban.props("selectedVertices")).toEqual([]);
      expect(goban.props("dimmedVertices")).toEqual([]);
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(goban.props("selectedVertices")).toEqual(priorSelection);
      expect(goban.props("dimmedVertices")).toEqual(dimmedExcept(priorSelection));
      expect(layout.props("commentary")).toEqual(saved);

      await wrapper.get(`[data-fact-id="${groupFact.id}"]`).trigger("click");
      await wrapper.get('[data-testid="commentary-enable"]').setValue(false);
      expect(goban.props("selectedVertices")).toEqual(priorSelection);
      expect(goban.props("dimmedVertices")).toEqual(dimmedExcept(priorSelection));
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      for (const perspective of ["why", "sacrifice"]) {
        await wrapper.get(`[data-fact-id="${groupFact.id}"]`).trigger("click");
        await wrapper.get(`[data-testid="perspective-${perspective}"]`).trigger("click");
        expect(goban.props("signMap")![2]![1]).toBe(0); // Historical root before B3.
        expect(goban.props("selectedVertices")).toEqual([]);
        // Notes stays mounted under v-show: late hidden events must not mix
        // current-position citation members with the historical root board.
        await wrapper.get(`[data-fact-id="${groupFact.id}"]`).trigger("focus");
        await wrapper.get(`[data-fact-id="${groupFact.id}"]`).trigger("click");
        expect(goban.props("selectedVertices")).toEqual([]);
        expect(goban.props("dimmedVertices")).toEqual([]);
        await wrapper.get('[data-testid="perspective-notes"]').trigger("click");
        expect(goban.props("signMap")![2]![1]).toBe(1);
        expect(goban.props("selectedVertices")).toEqual(priorSelection);
      }
      await wrapper.get(`[data-fact-id="${groupFact.id}"]`).trigger("click");
      await wrapper.setProps({ initialSgf: "(;SZ[5];B[aa])" });
      await settle();
      expect(goban.props("selectedVertices")).toEqual([]);
      expect(goban.props("dimmedVertices")).toEqual([]);
      expect(wrapper.find('svg path[data-group-id="B2"]').exists()).toBe(false);
      expect(wrapper.find('svg path[data-group-id="A2"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it("clears the temporary override on group/context changes and ordinary group interactions", async () => {
    const group: GroupSnapshot = {
      groupId: "B2", kind: "simple", status: "weak",
      members: { blackStones: ["B2", "C2", "B3"], whiteStones: [], empty: [] },
    };
    const pinned: GroupSnapshot = {
      groupId: "A2", kind: "simple", status: "settled",
      members: { blackStones: [], whiteStones: ["A2"], empty: [] },
    };
    const selected = [parseGtpVertex("A2", 5)!];
    // Parent-owned pin supplied to the layout; the integration cases above pin
    // through the actual Groups panel. Keep fact ID/status fixed across edits.
    const wrapper = mount(ReviewerLayout, { props: {
      sgf: constructedSgf, vertexSize: 16, initialPerspective: "notes",
      groups: [group, pinned], selectedVertices: selected,
      groupOutlines: buildGroupOutlines([group, pinned], 5, "A2"),
      commentaryInput: { ply: 1, groups: [group] }, commentaryContextKey: "source-a",
    } });
    try {
      await flushPromises();
      wrapper.vm.goToPly(1);
      await flushPromises();
      const goban = wrapper.getComponent(Goban);
      const cite = () => wrapper.get('[data-fact-id="ply-1/group-0-status"]').trigger("click");
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      await cite();
      expect(goban.props("selectedVertices")).toHaveLength(3);
      await wrapper.get('.yagoo-groups__row[data-group-id="A2"]').trigger("mouseenter");
      expect(goban.props("selectedVertices")).toEqual(selected);
      await cite();
      await wrapper.get('.yagoo-groups__row[data-group-id="A2"]').trigger("click");
      expect(goban.props("selectedVertices")).toEqual(selected);

      await cite();
      const changedGroup = { ...group, members: { ...group.members, blackStones: ["B2"] } };
      await wrapper.setProps({ groups: [changedGroup, pinned] });
      expect(goban.props("selectedVertices")).toEqual(selected);
      await cite();
      expect(goban.props("selectedVertices")).toEqual([parseGtpVertex("B2", 5)]);
      await wrapper.setProps({ commentaryContextKey: "source-b" });
      expect(goban.props("selectedVertices")).toEqual(selected);
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);
      expect(wrapper.get('svg path[data-group-id="A2"]').attributes("stroke-width")).toBe("3.5");

      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      await cite();
      await wrapper.setProps({ groups: [pinned], groupOutlines: buildGroupOutlines([pinned], 5, "A2") });
      await cite(); // A missing current group must not fall back to an old root.
      expect(goban.props("selectedVertices")).toEqual(selected);
      expect(wrapper.find('svg path[data-group-id="B2"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
