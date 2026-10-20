import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import fixtureText from "../../analysis/__fixtures__/sample-scan-deep.ndjson?raw";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import AnalysisReviewer from "../AnalysisReviewer.vue";

async function drainProgressiveBatches(rounds = 350) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await flushPromises();
  }
}

describe("AnalysisReviewer", () => {
  // Progressive NDJSON (~400+ events @ 4/frame) needs headroom under CI load.
  const timeout = 45_000;

  it(
    "loads 19×19 SGF and streams fixture NDJSON into the reviewer chrome",
    async () => {
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

      expect(wrapper.get('[data-testid="opening-badge"]').text()).toMatch(
        /Coming in #27/,
      );
      wrapper.get('[data-testid="move-inspector"]');

      for (const [tab, issue] of [
        ["why", "#24"],
        ["ledger", "#23"],
        ["sacrifice", "#25"],
        ["notes", "#28"],
      ] as const) {
        await wrapper.get(`[data-testid="perspective-${tab}"]`).trigger("click");
        expect(wrapper.get(`#yagoo-panel-${tab}`).text()).toContain(
          `Coming in ${issue}`,
        );
      }

      await wrapper.get('[data-testid="perspective-ai"]').trigger("click");
      await wrapper.get('[data-testid="next-key-move"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toMatch(/Key 1/);

      await wrapper.get('[data-testid="report-toggle"]').trigger("click");
      expect(wrapper.get('[data-testid="review-report"]').text()).toMatch(
        /Coming in #29/,
      );
      expect(wrapper.get('[data-testid="review-report"]').text()).toMatch(
        /Move 50/,
      );
      await wrapper.get('[data-testid="report-toggle"]').trigger("click");

      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const source = wrapper.get('[data-testid="engine-source"]');
      expect(source.text()).toMatch(/Coming in #19/);
      expect(source.text()).not.toMatch(/Coming in #20/);
      expect(source.get('[data-testid="model-island-slot"]').text()).toMatch(
        /Load local model/,
      );
      expect(source.get('[data-testid="model-island-slot"]').text()).toMatch(
        /does not host/i,
      );
      expect(source.get('[data-testid="use-browser-engine"]').attributes("disabled")).toBeDefined();

      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(wrapper.get('[data-testid="variation-tree"]').text()).toMatch(
        /Coming in #26/,
      );

      wrapper.unmount();
    },
    timeout,
  );

  it(
    "previews numbered PV stones on candidate hover and restores on leave",
    async () => {
      const wrapper = mount(AnalysisReviewer, {
        props: {
          initialSgf: sampleSgf,
          initialNdjson: fixtureText,
          vertexSize: 16,
        },
        attachTo: document.body,
      });

      await drainProgressiveBatches();

      // Navigate to a deep ply that has candidates (ply 50 in the real fixture).
      const layout = wrapper.findComponent({ name: "ReviewerLayout" });
      expect(layout.exists()).toBe(true);
      layout.vm.goToPly(50);
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
    },
    timeout,
  );

  it(
    "shows Groups/块 panel and highlights on group hover",
    async () => {
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
      layout.vm.goToPly(50);
      await flushPromises();
      await drainProgressiveBatches(8);

      const panel = wrapper.find('[data-testid="groups-panel"]');
      expect(panel.exists()).toBe(true);
      expect(panel.text()).toMatch(/Groups|块/);
      expect(panel.text()).not.toMatch(/fixture/i);
      const rows = panel.findAll("[data-group-id]");
      expect(rows.length).toBeGreaterThanOrEqual(3);
      // Labels are member-stone GTP coords (not empty-point ids like A13).
      for (const row of rows) {
        const id = row.attributes("data-group-id") ?? "";
        expect(id).toMatch(/^[A-HJ-T]\d{1,2}$/);
      }

      // Outlines present before hover.
      expect(
        document.querySelectorAll(".yagoo-group-outline").length,
      ).toBeGreaterThan(0);

      await rows[0]!.trigger("mouseenter");
      await flushPromises();
      expect(rows[0]!.classes()).toContain("yagoo-groups__row--preview");
      // Dimmed vertices appear while a group is focused.
      expect(wrapper.findAll(".shudan-dimmed").length).toBeGreaterThan(0);

      await rows[0]!.trigger("mouseleave");
      await flushPromises();

      wrapper.unmount();
    },
    timeout,
  );

  it(
    "tap-toggles PV preview from the candidates panel",
    async () => {
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
      layout.vm.goToPly(50);
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
    },
    timeout,
  );
});
