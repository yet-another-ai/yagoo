import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import fixtureText from "../../analysis/__fixtures__/sample-scan-deep.ndjson?raw";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import AnalysisReviewer from "../AnalysisReviewer.vue";

async function drainProgressiveBatches(rounds = 160) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await flushPromises();
  }
}

describe("AnalysisReviewer", () => {
  it("loads 19×19 SGF and streams fixture NDJSON into the reviewer chrome", async () => {
    expect(sampleSgf).toMatch(/SZ\[19\]/);

    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sampleSgf,
        initialNdjson: fixtureText,
        // Fixed size in jsdom (no real layout); production uses ResizeObserver.
        vertexSize: 16,
      },
      attachTo: document.body,
    });

    await drainProgressiveBatches();

    expect(wrapper.find(".yagoo-reviewer").exists()).toBe(true);
    expect(wrapper.find(".yagoo-winrate").exists()).toBe(true);
    expect(wrapper.find(".yagoo-bottom-bar").exists()).toBe(true);
    expect(wrapper.find('[data-testid="candidates-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toMatch(/chinese/i);
    expect(wrapper.text()).toMatch(/complete|streaming|deep|Loaded/i);

    // Goban should be sized for 19×19.
    expect(wrapper.findAll(".shudan-vertex")).toHaveLength(19 * 19);

    wrapper.unmount();
  });

  it("previews numbered PV stones on candidate hover and restores on leave", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sampleSgf,
        initialNdjson: fixtureText,
        vertexSize: 16,
      },
      attachTo: document.body,
    });

    await drainProgressiveBatches();

    // Navigate to a deep ply that has candidates (ply 48 in the fixture).
    const layout = wrapper.findComponent({ name: "ReviewerLayout" });
    expect(layout.exists()).toBe(true);
    layout.vm.goToPly(48);
    await flushPromises();
    await drainProgressiveBatches(8);

    const panel = wrapper.find('[data-testid="candidates-panel"]');
    expect(panel.exists()).toBe(true);
    const rows = panel.findAll("[data-candidate-index]");
    expect(rows.length).toBeGreaterThan(0);

    // Before hover: candidate ghosts (colored types), no PV number "1" alone as PV.
    const beforeLabels = wrapper
      .findAll(".shudan-marker")
      .map((m) => m.text());
    expect(beforeLabels.some((t) => t.includes("%"))).toBe(true);

    await rows[0]!.trigger("mouseenter");
    await flushPromises();

    const previewLabels = wrapper
      .findAll(".shudan-marker")
      .map((m) => m.text().trim());
    expect(previewLabels).toContain("1");
    expect(previewLabels).toContain("2");
    // Winrate labels should be gone while PV preview is active.
    expect(previewLabels.some((t) => t.includes("%"))).toBe(false);
    // No arrows.
    expect(wrapper.findAll(".shudan-arrow").length).toBe(0);

    await rows[0]!.trigger("mouseleave");
    await flushPromises();

    const afterLabels = wrapper
      .findAll(".shudan-marker")
      .map((m) => m.text());
    expect(afterLabels.some((t) => t.includes("%"))).toBe(true);

    wrapper.unmount();
  });

  it("tap-toggles PV preview from the candidates panel", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sampleSgf,
        initialNdjson: fixtureText,
        vertexSize: 16,
      },
      attachTo: document.body,
    });

    await drainProgressiveBatches();
    const layout = wrapper.findComponent({ name: "ReviewerLayout" });
    layout.vm.goToPly(48);
    await flushPromises();
    await drainProgressiveBatches(8);

    const row = wrapper.find("[data-candidate-index='0']");
    expect(row.exists()).toBe(true);

    await row.trigger("click");
    await flushPromises();
    let labels = wrapper.findAll(".shudan-marker").map((m) => m.text().trim());
    expect(labels).toContain("1");

    // mouseleave should not clear while pinned
    await row.trigger("mouseleave");
    await flushPromises();
    labels = wrapper.findAll(".shudan-marker").map((m) => m.text().trim());
    expect(labels).toContain("1");

    await row.trigger("click");
    await flushPromises();
    labels = wrapper.findAll(".shudan-marker").map((m) => m.text());
    expect(labels.some((t) => t.includes("%"))).toBe(true);

    wrapper.unmount();
  });
});
