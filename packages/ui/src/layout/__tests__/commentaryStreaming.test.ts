import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { constructedSacrifice, constructedSgf } from "../../analysis/__tests__/constructedSacrifice";
import { parseGtpVertex } from "../../analysis/coords";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import type { GroundedCommentary } from "../../commentary/facts";
import type { CommentaryRequest } from "../../commentary/session";
import Goban from "../../goban/Goban.vue";
import ReviewerLayout from "../ReviewerLayout.vue";

describe("streaming group previews", () => {
  it.each(["notes", "why"].flatMap((perspective) => ["copy", "unrelated ply"].map((update) => ({ perspective, update }))))(
    "preserves $perspective preview through a same-evidence $update update", async ({ perspective, update }) => {
    // Constructed legal UI contract, not engine evidence. Current-ply members
    // include actual B3; the Why comparison remains on root-ply-0 B2/C2.
    const comparison = constructedSacrifice();
    const snapshot: PositionSnapshot = {
      schemaVersion: 1, ply: 1, toPlay: "W", ownershipConvention: "black_positive",
      board: { ...comparison.context!.board, black: ["B2", "C2", "B3"] }, chains: [],
      groups: [{ groupId: "B2", kind: "simple", status: "weak", members: {
        blackStones: ["B2", "C2", "B3"], whiteStones: [], empty: [],
      } }], comparison,
      ledger: {
        rootPly: 1, mover: "W", move: "E1", vs: "pass", referenceMove: "pass",
        value: 1, consistent: true, scaling: "score", bookTotal: 1, ledger: [],
      },
    };
    const before = reducePipelineEvent(createInitialAnalysisState(), {
      type: "positionCompleted", v: 1, phase: "deep", snapshot,
    });
    const initial = before.plies[1]!;
    const wrapper = mount(ReviewerLayout, { props: {
      sgf: constructedSgf, vertexSize: 16, initialPerspective: perspective as "notes" | "why",
      groups: initial.groups, comparison: initial.comparison, ledger: initial.ledger,
      commentaryInput: initial, commentaryContextKey: "same-source",
    } });
    try {
      await flushPromises();
      wrapper.vm.goToPly(1);
      await flushPromises();
      const goban = wrapper.getComponent(Goban);
      if (perspective === "notes") {
        await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
        await wrapper.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
        const packet = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
        await wrapper.get('[data-testid="commentary-response"]').setValue(JSON.stringify({
          version: 1, requestId: packet.requestId, selections: [{ factId: "ply-1/group-0-status", variant: 0 }],
        }));
        await wrapper.get('[data-testid="commentary-import"]').trigger("click");
        // Echo the saved selection as AnalysisReviewer's saveCommentary does,
        // so a later input update cannot hydrate an absent parent record.
        initial.commentary = wrapper.emitted("commentary")!.at(-1)![0] as GroundedCommentary;
        await wrapper.setProps({ commentary: initial.commentary });
        await wrapper.get('[data-fact-id="ply-1/group-0-status"]').trigger("focus");
      } else {
        await wrapper.get('.yagoo-groups__row[data-group-id="B2"]').trigger("mouseenter");
      }
      const selected = (perspective === "notes" ? ["B2", "C2", "B3"] : ["B2", "C2"])
        .map((point) => parseGtpVertex(point, 5));
      expect(goban.props("selectedVertices")).toEqual(selected);
      const dimmed = structuredClone(goban.props("dimmedVertices"));

      const next = update === "copy" ? { ...initial, groups: structuredClone(initial.groups) }
        : reducePipelineEvent(before, {
          type: "stagePartial", v: 1, phase: "scan", ply: 2, stage: "root", root: { visits: 32 },
        }).plies[1]!;
      // Reach the reported groups-identity path without retriggering the
      // independent ledger/comparison invalidation guards.
      expect(next.groups).not.toBe(initial.groups);
      expect(next.groups).toEqual(initial.groups);
      expect(next.ledger).toBe(initial.ledger);
      expect(next.comparison).toBe(initial.comparison);
      expect(next.commentary).toBe(initial.commentary);
      await wrapper.setProps({
        groups: next.groups, ledger: next.ledger, comparison: next.comparison, commentaryInput: next,
      });
      expect(goban.props("selectedVertices")).toEqual(selected);
      expect(goban.props("dimmedVertices")).toEqual(dimmed);
      expect(goban.props("signMap")![2]![1]).toBe(perspective === "notes" ? 1 : 0);

      const changedGroup = { ...next.groups[0]!, members: {
        ...next.groups[0]!.members, blackStones: ["B2"],
      } };
      await wrapper.setProps({ groups: [changedGroup] });
      // Keep the existing conservative invalidation for changed evidence.
      expect(goban.props("selectedVertices")).toEqual([]);
    } finally {
      wrapper.unmount();
    }
  });
});
