import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import sgf from "../../analysis/__fixtures__/sample.sgf?raw";
import recorded from "../../analysis/__fixtures__/comparison-positions.json";
import type { PositionSnapshot } from "../../analysis/types";
import { parseGtpVertex } from "../../analysis/coords";
import Goban from "../../goban/Goban.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import ComparisonPanel from "../ComparisonPanel.vue";

const snapshots = recorded as PositionSnapshot[];
const comparison = snapshots.find((item) => item.ply === 44)!.comparison!;

describe("recorded comparison UI", () => {
  it("labels mover winrates, Black scores, equality and low-visit provenance", () => {
    const wrapper = mount(ComparisonPanel, { props: { comparison } });
    expect(wrapper.text()).toContain("before-move board (ply 43)");
    expect(wrapper.text()).toContain("Mover winrate");
    expect(wrapper.text()).toContain("Black score lead");
    expect(wrapper.text()).toContain("Candidate visits");
    expect(wrapper.get('[data-testid="comparison-loss"]').text()).toContain("+2.46");
    expect(wrapper.text()).toContain("do not establish sente or gote");
    wrapper.unmount();
    const equal = mount(ComparisonPanel, {
      props: { comparison: snapshots.find((item) => item.ply === 50)!.comparison! },
    });
    expect(equal.get('[data-testid="comparison-equal"]').text()).toContain("same branch");
    equal.unmount();
  });

  it("renders the true p−1 board and isolates overlays, highlights and the diff toggle", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: { sgf, vertexSize: 12, comparison, initialPerspective: "why",
        // These next-mover overlays must not leak into a comparison root.
        selectedVertices: [[0, 0]], markerMap: [[{ type: "label", label: "NEXT" }]],
      },
    });
    await flushPromises();
    wrapper.vm.goToPly(44);
    await flushPromises();
    const goban = wrapper.getComponent(Goban);
    const [x, y] = parseGtpVertex("S7", 19)!;
    expect(wrapper.get('[data-testid="comparison-board-banner"]').text()).toContain("ply 43");
    expect(goban.props("signMap")![y]![x]).toBe(0); // actual S7 has not been played
    expect(goban.props("markerMap")![y]![x]!.label).toBe("A");
    expect(goban.props("selectedVertices")).toEqual([]);
    expect(goban.props("paintMap")!.flat().some((value) => value !== 0)).toBe(true);
    await wrapper.get('[data-testid="comparison-difference"]').setValue(false);
    expect(goban.props("paintMap")).toEqual([]);
    await wrapper.get('[data-testid="comparison-difference"]').setValue(true);
    const line = comparison.ledgerDiff!.ledger.find((entry) => entry.kind === "group")!;
    const selector = `#yagoo-panel-why [data-ledger-group="${line.id}"]`;
    const expected = line.intersections.map((coordinate) => parseGtpVertex(coordinate, 19));
    await wrapper.get(selector).trigger("focus");
    expect(goban.props("selectedVertices")).toEqual(expected);
    await wrapper.get(selector).trigger("blur");
    expect(goban.props("selectedVertices")).toEqual([]);
    await wrapper.get(selector).trigger("mouseenter");
    await wrapper.get('[data-testid="perspective-ai"]').trigger("click");
    expect(wrapper.find('[data-testid="comparison-board-banner"]').exists()).toBe(false);
    expect(goban.props("signMap")![y]![x]).toBe(-1);
    expect(goban.props("selectedVertices")).toEqual([[0, 0]]);
    await wrapper.get('[data-testid="perspective-why"]').trigger("click");
    await wrapper.get(selector).trigger("mouseenter");
    await wrapper.setProps({ comparison: null, selectedVertices: [] });
    expect(goban.props("selectedVertices")).toEqual([]);
    expect(goban.props("signMap")![y]![x]).toBe(-1);
    wrapper.unmount();
  });

  it("does not display root evidence on a different ply or a local try board", async () => {
    const wrapper = mount(ReviewerLayout, { props: { sgf, vertexSize: 12, comparison, initialPerspective: "why" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="comparison-body"]').exists()).toBe(false);
    wrapper.vm.goToPly(44);
    await flushPromises();
    expect(wrapper.find('[data-testid="comparison-body"]').exists()).toBe(true);
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    expect(wrapper.find('[data-testid="comparison-body"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="comparison-board-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
