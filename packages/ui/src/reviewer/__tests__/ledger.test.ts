import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import recorded from "../../analysis/__fixtures__/ledger-position.json";
import comparisons from "../../analysis/__fixtures__/comparison-positions.json";
import type { GainLossLedger } from "../../analysis/modules";
import type { PositionSnapshot } from "../../analysis/types";
import { parseGtpVertex } from "../../analysis/coords";
import Goban from "../../goban/Goban.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import LedgerPanel from "../LedgerPanel.vue";

const ledger = recorded.ledger as GainLossLedger;

describe("recorded ledger UI", () => {
  it("labels played-move status changes as before/after evidence on the ledger line", () => {
    const comparison = (comparisons as PositionSnapshot[]).find((item) => item.ply === 44)!.comparison!;
    const wrapper = mount(LedgerPanel, {
      props: { ledger: comparison.playedLedger!, tempoEvidenceAvailable: true, tempoComparison: "played" },
    });
    const changes = wrapper.findAll('[data-testid="ledger-played-tempo"]').map((entry) => entry.text());
    expect(changes).toEqual([
      "Black status: before settled → after weak (separate pass probes before and after the move).",
      "White status: before weak → after settled (separate pass probes before and after the move).",
    ]);
    expect(wrapper.text()).toContain("same root stones before and after the played move");
    expect(wrapper.text()).not.toContain("branch status");
    expect(wrapper.find('[data-testid="ledger-tempo-limitation"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("labels the baseline and refuses line point claims for inconsistent books", () => {
    const inconsistent: GainLossLedger = {
      ...ledger,
      consistent: false,
      scaling: "proportions",
      inconsistency: "book_search_mismatch",
      ledger: ledger.ledger.map((line) => ({ ...line, points: null })),
    };
    const wrapper = mount(LedgerPanel, { props: { ledger: inconsistent } });
    expect(wrapper.text()).toContain("vs pass");
    expect(wrapper.get('[data-testid="ledger-inconsistent"]').text()).toContain("exceeds 3 points");
    expect(wrapper.findAll("button").every((button) => button.text().includes("%"))).toBe(true);
    expect(wrapper.findAll("button").some((button) => button.text().includes(" pt"))).toBe(false);
    expect(wrapper.get('[data-testid="ledger-tempo-limitation"]').text()).toContain("unassessed");
  });

  it("highlights exact recorded group and territory intersections, and clears on leave or blur", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: {
        sgf: "(;SZ[19])",
        vertexSize: 12,
        initialPerspective: "ledger",
        ledger,
      },
    });
    await flushPromises();
    const goban = wrapper.getComponent(Goban);
    for (const kind of ["group", "own_territory"] as const) {
      const line = ledger.ledger.find((item) => item.kind === kind);
      expect(line).toBeDefined();
      const button = wrapper.get(`[data-ledger-kind="${kind}"]`);
      const expected = line!.intersections.map((coordinate) => parseGtpVertex(coordinate, 19));
      await button.trigger("mouseenter");
      expect(goban.props("selectedVertices")).toEqual(expected);
      expect(goban.props("dimmedVertices")).toHaveLength(361 - expected.length);
      await button.trigger("mouseleave");
      expect(goban.props("selectedVertices")).toEqual([]);
      await button.trigger("focus");
      expect(goban.props("selectedVertices")).toEqual(expected);
      await button.trigger("blur");
      expect(goban.props("selectedVertices")).toEqual([]);
    }
    wrapper.unmount();
  });

  it("clears hovered regions when changing inspector tab or authoritative ledger", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: "(;SZ[19])", vertexSize: 12, initialPerspective: "ledger", ledger },
    });
    await flushPromises();
    await wrapper.get("[data-ledger-kind]").trigger("mouseenter");
    await wrapper.get('[data-testid="perspective-ai"]').trigger("click");
    expect(wrapper.getComponent(Goban).props("selectedVertices")).toEqual([]);
    await wrapper.get('[data-testid="perspective-ledger"]').trigger("click");
    await wrapper.get("[data-ledger-kind]").trigger("mouseenter");
    await wrapper.setProps({ ledger: null });
    expect(wrapper.getComponent(Goban).props("selectedVertices")).toEqual([]);
    wrapper.unmount();
  });
});
