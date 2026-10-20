import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import fixtureText from "../../analysis/__fixtures__/sample-scan-deep.ndjson?raw";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import type { PipelineEvent } from "../../analysis/types";
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
  it("keeps the SGF file confirmation after the new game has rendered", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: "(;SZ[9])", vertexSize: 16 },
    });
    try {
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const input = wrapper.get('[data-testid="source-sgf-input"]');
      for (const [name, text, rules] of [
        ["first.sgf", "(;SZ[9];B[cc])", "chinese"],
        ["second.sgf", "(;SZ[9]RU[Japanese];B[dd])", "Japanese"],
      ]) {
        Object.defineProperty(input.element, "files", {
          configurable: true,
          value: [new File([text!], name!, { type: "text/plain" })],
        });
        await input.trigger("change");
        await flushPromises();
        expect(wrapper.find(".yagoo-analysis-app__status").exists()).toBe(true);
        expect(wrapper.get(".yagoo-analysis-app__status").text())
          .toBe(`Loaded SGF ${name} (rules: ${rules})`);
      }
      expect(wrapper.text()).not.toContain("Loaded SGF first.sgf");
    } finally {
      wrapper.unmount();
    }
  });

  it("does not replace recorded analysis when a model bundle is dropped on the engine panel", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: "(;SZ[9])",
        initialNdjson: '{"type":"gameStarted"}\n',
      },
    });
    await flushPromises();
    await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
    const file = new File(["{}"], "manifest.json", { type: "application/json" });
    await wrapper.get('[data-testid="model-island-slot"]').trigger("drop", {
      dataTransfer: { files: [file] },
    });
    await flushPromises();
    const emitted = wrapper.emitted("local-model-files");
    expect(emitted?.[0]?.[0]).toEqual([file]);
    expect(wrapper.text()).toMatch(/bundled sample analysis/);
    expect(wrapper.text()).not.toMatch(/Streaming from manifest\.json|Loading manifest\.json/);
    wrapper.unmount();
  });

  it("recognizes SGF without an engine and clears the label on another loaded game", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: "(;SZ[19];B[dd];W[cc];B[dc];W[ce])",
        vertexSize: 16,
      },
    });
    const badge = () => wrapper.get('[data-testid="opening-badge"]');
    expect(badge().text()).toContain("3-3 invasion: block and extend");
    expect(badge().text()).toContain("outside the stored line at move 4");
    await wrapper.setProps({ initialSgf: "(;SZ[19];B[jj])" });
    expect(badge().text()).toContain("No unique match");
    expect(badge().text()).not.toContain("3-3 invasion");
    expect(badge().text()).not.toContain("move 4");
    await wrapper.setProps({ initialSgf: "(;SZ[19];B[pd];W[dd];B[pp];W[dp];B[pj])" });
    expect(badge().text()).toContain("Sanrensei");
    await wrapper.setProps({ initialSgf: "" });
    expect(badge().text()).toContain("No unique match");
    wrapper.unmount();
  });

  it("does not show an unrelated NDJSON opening over the loaded SGF", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: "(;SZ[19];B[jj])",
        initialNdjson: JSON.stringify({
          type: "openingMatched", v: 1,
          match: { name: "Unrelated game", joseki: null, deviationPly: 9, source: "test" },
        }),
        vertexSize: 16,
      },
    });
    await drainProgressiveBatches(3);
    expect(wrapper.get('[data-testid="opening-badge"]').text()).not.toContain("Unrelated game");
    wrapper.unmount();
  });

  // Progressive NDJSON (~400+ events @ 4/frame) needs headroom under CI load.
  const timeout = 45_000;

  it.each([false, true])("posts the loaded SGF and shows Stop correctly (received events: %s)", async (receivedEvents) => {
    const cancel = vi.fn();
    const events: PipelineEvent[] = [
      { type: "gameStarted", v: 1, size: 9, komi: 7.5, moveCount: 1, positionCount: 2, strategy: "scan_then_deep" },
      { type: "phaseStarted", v: 1, phase: "scan", visits: 200 },
      { type: "positionStarted", v: 1, ply: 0, toPlay: "B", phase: "scan" },
      { type: "stagePartial", v: 1, ply: 0, phase: "scan", stage: "root", root: { visits: 25, winrate: 0.6 } },
    ];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(
      new ReadableStream({
        start(controller) {
          if (receivedEvents) {
            controller.enqueue(new TextEncoder().encode(
              events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
            ));
          }
        },
        cancel,
      }),
      { headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetch);
    const sgf = "(;SZ[9];B[cc])";
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: sgf, vertexSize: 16 } });
    try {
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      await wrapper.get('[data-testid="native-url"]').setValue("http://127.0.0.1:9000/analyze");
      await wrapper.get('[data-source="live-native"] button').trigger("click");
      await flushPromises();
      expect(fetch.mock.calls[0]![0]).toBe("http://127.0.0.1:9000/analyze");
      expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ sgf });
      if (receivedEvents) {
        expect(wrapper.get(".yagoo-analysis-app__meta").text()).toContain("scan @ ply 0");
      }
      await wrapper.get('[data-testid="stop-analysis"]').trigger("click");
      await flushPromises();
      expect(fetch.mock.calls[0]![1]!.signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      expect(wrapper.find('[data-testid="stop-analysis"]').exists()).toBe(false);
      expect(wrapper.get(".yagoo-analysis-app__status").text()).toBe("Analysis stopped.");
      expect(wrapper.get(".yagoo-analysis-app__meta").text()).toContain(`stopped · ${receivedEvents ? 4 : 0} events`);
      expect(wrapper.get(".yagoo-analysis-app__meta").text()).not.toContain("scan @ ply");
      expect(wrapper.text()).not.toContain("Connecting");
      if (receivedEvents) {
        expect(wrapper.findComponent({ name: "ReviewerLayout" }).props("rootAnalysis"))
          .toEqual({ visits: 25, winrate: 0.6 });
      }

      // Starting another source clears the explicit Stop display state.
      await wrapper.get('[data-source="live-native"] button').trigger("click");
      await flushPromises();
      expect(wrapper.text()).not.toContain("stopped");
      expect(wrapper.find('[data-testid="stop-analysis"]').exists()).toBe(true);
      await wrapper.get('[data-testid="stop-analysis"]').trigger("click");
      // Loading a new game must not label an internal reset as a user Stop.
      await wrapper.setProps({ initialSgf: "(;SZ[9];B[dd])" });
      expect(wrapper.get(".yagoo-analysis-app__meta").text()).toContain("idle");
      expect(wrapper.text()).not.toContain("stopped");
    } finally {
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

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

      expect(wrapper.get('[data-testid="opening-badge"]').text()).not.toMatch(/Coming in #27/);
      wrapper.get('[data-testid="move-inspector"]');

      for (const [tab, issue] of [
        ["why", "#24"],
        ["ledger", "#23"],
      ] as const) {
        await wrapper.get(`[data-testid="perspective-${tab}"]`).trigger("click");
        expect(wrapper.get(`#yagoo-panel-${tab}`).text()).toContain(
          `Coming in ${issue}`,
        );
      }
      await wrapper.get('[data-testid="perspective-sacrifice"]').trigger("click");
      expect(wrapper.get("#yagoo-panel-sacrifice").text()).toContain(
        "Sacrifice assessment is unavailable",
      );
      await wrapper.get('[data-testid="perspective-notes"]').trigger("click");
      expect(wrapper.get("#yagoo-panel-notes").text()).toContain("Show grounded notes");
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);

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
      expect(source.text()).not.toMatch(/Coming in #20/);
      expect(source.text()).toMatch(/yagoo analyze --serve/);
      expect(source.get<HTMLInputElement>('[data-testid="native-url"]').element.value)
        .toBe("http://127.0.0.1:8710/analyze");
      expect(source.get('[data-testid="model-island-slot"]').text()).toMatch(
        /Load local model/,
      );
      expect(source.get('[data-testid="model-island-slot"]').text()).toMatch(
        /does not host/i,
      );
      expect(source.get('[data-testid="use-browser-engine"]').attributes("disabled")).toBeDefined();

      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(wrapper.get('[data-testid="variation-tree"]').text()).toMatch(
        /Load a browser model or connect a native engine/,
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
