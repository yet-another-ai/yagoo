import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CandidatesPanel from "../CandidatesPanel.vue";

describe("CandidatesPanel low-visit winrates", () => {
  it("hides unsettled winrates and drops those rows from the list", () => {
    const wrapper = mount(CandidatesPanel, {
      props: {
        rootVisits: 500,
        candidates: [
          { move: "R1", order: 0, visits: 496, winrate: 0.577 },
          { move: "P9", order: 1, visits: 3, winrate: 0.815 },
          { move: "S7", order: 2, visits: 1, winrate: 0.828 },
        ],
      },
    });

    const rows = wrapper.findAll("[data-candidate-index]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attributes("data-candidate-index")).toBe("0");
    expect(rows[0]!.attributes("data-winrate-authoritative")).toBe("1");
    expect(rows[0]!.text()).toContain("57.7%");
    expect(wrapper.text()).not.toContain("81.5%");
    expect(wrapper.text()).not.toContain("82.8%");
    expect(wrapper.get('[data-testid="low-visit-note"]').text()).toMatch(
      /2 low-visit moves hidden/,
    );
  });
});
