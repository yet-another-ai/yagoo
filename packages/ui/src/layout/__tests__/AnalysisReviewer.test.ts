import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import fixtureText from "../../analysis/__fixtures__/sample-scan-deep.ndjson?raw";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import AnalysisReviewer from "../AnalysisReviewer.vue";

describe("AnalysisReviewer", () => {
  it("loads 19×19 SGF and streams fixture NDJSON into the reviewer chrome", async () => {
    expect(sampleSgf).toMatch(/SZ\[19\]/);

    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sampleSgf,
        initialNdjson: fixtureText,
        vertexSize: 16,
      },
      attachTo: document.body,
    });

    // Progressive rAF batches — fixture has ~200 events @ batchSize 3.
    for (let i = 0; i < 120; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      await flushPromises();
    }

    expect(wrapper.find(".yagoo-reviewer").exists()).toBe(true);
    expect(wrapper.find(".yagoo-winrate").exists()).toBe(true);
    expect(wrapper.find(".yagoo-bottom-bar").exists()).toBe(true);
    expect(wrapper.text()).toMatch(/chinese/i);
    expect(wrapper.text()).toMatch(/complete|streaming|deep|Loaded/i);

    // Goban should be sized for 19×19.
    expect(wrapper.findAll(".shudan-vertex")).toHaveLength(19 * 19);

    wrapper.unmount();
  });
});
