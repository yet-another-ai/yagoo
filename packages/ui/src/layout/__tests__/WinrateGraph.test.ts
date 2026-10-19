import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WinrateGraph from "../WinrateGraph.vue";

describe("WinrateGraph", () => {
  it("renders winrate path, score-lead path, and deep ply markers", () => {
    const wrapper = mount(WinrateGraph, {
      props: {
        data: [
          { winrate: 50, change: 0, scoreLead: 0, deepSelected: false },
          { winrate: 52, change: 2, scoreLead: 0.5, deepSelected: false },
          { winrate: 71, change: 19, scoreLead: 4.8, deepSelected: true },
        ],
        currentIndex: 2,
        showScoreLead: true,
      },
    });
    expect(wrapper.find(".yagoo-winrate__line").exists()).toBe(true);
    expect(wrapper.find(".yagoo-winrate__score").exists()).toBe(true);
    expect(wrapper.findAll(".yagoo-winrate__deep")).toHaveLength(1);
  });

  it("emits select when the graph is clicked", async () => {
    const wrapper = mount(WinrateGraph, {
      props: {
        data: [
          { winrate: 50, scoreLead: 0 },
          { winrate: 60, scoreLead: 2 },
          { winrate: 55, scoreLead: 1 },
        ],
      },
    });
    const svg = wrapper.find("svg");
    // jsdom/happy-dom: stub geometry for click math
    Object.defineProperty(svg.element, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 280, top: 0, height: 96 }),
    });
    await svg.trigger("click", { clientX: 280, clientY: 40 });
    expect(wrapper.emitted("select")?.[0]).toEqual([2]);
  });
});
