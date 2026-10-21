import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import recorded from "../../analysis/__fixtures__/comparison-positions.json";
import type { PositionSnapshot } from "../../analysis/types";
import { constructedSacrifice, constructedSgf } from "../../analysis/__tests__/constructedSacrifice";
import { parseGtpVertex } from "../../analysis/coords";
import Goban from "../../goban/Goban.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import SacrificePanel from "../SacrificePanel.vue";

const snapshots = recorded as PositionSnapshot[];
describe("sacrifice UI", () => {
  it("explains genuine negative and unassessed evidence without declaring no sacrifice exists", () => {
    for (const ply of [44, 50]) {
      const wrapper = mount(SacrificePanel, { props: { comparison: snapshots.find((item) => item.ply === ply)!.comparison!, ply } });
      expect(wrapper.text()).toContain(`before-move board (ply ${ply - 1})`);
      expect(wrapper.find(ply === 50 ? '[data-testid="sacrifice-unassessed"]' : '[data-testid="sacrifice-none"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="sacrifice-body"]').exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it("highlights the constructed group and exchange on the pre-move board and clears on tab/source/try changes", async () => {
    const comparison = constructedSacrifice();
    const wrapper = mount(ReviewerLayout, { props: {
      sgf: constructedSgf, vertexSize: 20, comparison, initialPerspective: "sacrifice",
      paintMap: [[1]], selectedVertices: [[0, 0]],
    } });
    await flushPromises();
    wrapper.vm.goToPly(1);
    await flushPromises();
    const goban = wrapper.getComponent(Goban);
    expect(goban.props("signMap")![2]![1]).toBe(0); // actual B3 not on root board
    expect(goban.props("paintMap")).toEqual([]); // no actual/AI diff in sacrifice perspective
    expect(wrapper.text()).toContain("The exchange is unpriced in points");
    const group = wrapper.get('[data-sacrifice-group="B2"]');
    await group.trigger("focus");
    expect(goban.props("selectedVertices")).toEqual(["B2", "C2"].map((p) => parseGtpVertex(p, 5)));
    await group.trigger("blur");
    expect(goban.props("selectedVertices")).toEqual([]);
    const exchange = wrapper.get('[data-sacrifice-exchange="0"]');
    await exchange.trigger("mouseenter");
    expect(goban.props("selectedVertices")).toEqual(["A5", "B5", "C5", "D5", "A4"].map((p) => parseGtpVertex(p, 5)));
    await exchange.trigger("mouseleave");
    expect(goban.props("selectedVertices")).toEqual([]);
    await group.trigger("mouseenter");
    await wrapper.get('[data-testid="perspective-ai"]').trigger("click");
    expect(goban.props("signMap")![2]![1]).toBe(1);
    expect(goban.props("selectedVertices")).toEqual([[0, 0]]);
    await wrapper.get('[data-testid="perspective-sacrifice"]').trigger("click");
    await group.trigger("focus");
    await wrapper.setProps({ comparison: null, selectedVertices: [] });
    expect(goban.props("selectedVertices")).toEqual([]);
    expect(wrapper.find('[data-testid="sacrifice-body"]').exists()).toBe(false);
    await wrapper.setProps({ comparison });
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    expect(wrapper.find('[data-testid="sacrifice-body"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
